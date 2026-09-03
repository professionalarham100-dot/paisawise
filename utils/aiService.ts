import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";

import { auth } from "../lib/firebase";
import type { Expense } from "../storage/expenses";
import { getAgeFromDob, type UserProfile } from "../storage/userProfile";
import { formatDatePK, formatPKR } from "./currency";
import { findOfflineScenario } from "./offlineScenarios";

type AIResult = {
  text: string;
  source: "claude" | "groq" | "offline";
};

type GoalInput = {
  name: string;
  targetAmount: number;
  savedAmount: number;
  achieved?: boolean;
  deadlineMonth?: string;
};

const TIMEOUT_MS = 18_000;
const ROAST_TIMEOUT_MS = 25_000;
const AI_PROXY_URL =
  process.env.EXPO_PUBLIC_AI_PROXY_URL ||
  "https://paisawise-ai-proxy-production.up.railway.app";

type ProxyEndpoint = "expense-advice" | "roast" | "monthly-analysis";

const CLIENT_RATE_LIMIT_NOTE =
  "AI advice limit reached \u2014 showing saved tips.";

const AI_CALL_TIMESTAMPS_KEY = "paisawise.aiCallTimestamps.v1";
const MAX_AI_CALLS_PER_DAY = 30;
const MIN_AI_CALL_INTERVAL_MS = 5000; // 5 seconds between calls

const loadAICallTimestamps = async (): Promise<number[]> => {
  try {
    const raw = await AsyncStorage.getItem(AI_CALL_TIMESTAMPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  } catch {
    return [];
  }
};

const saveAICallTimestamps = async (timestamps: number[]): Promise<void> => {
  try {
    await AsyncStorage.setItem(AI_CALL_TIMESTAMPS_KEY, JSON.stringify(timestamps));
  } catch {
    // best-effort: ignore write failures
  }
};

const canMakeAICall = async (): Promise<boolean> => {
  const now = Date.now();
  const stored = await loadAICallTimestamps();
  // Remove timestamps older than 24 hours
  const recent = stored.filter((t) => t >= now - 86400000);
  // Persist the cleaned list back so storage doesn't grow unbounded
  if (recent.length !== stored.length) {
    await saveAICallTimestamps(recent);
  }
  // Check daily cap
  if (recent.length >= MAX_AI_CALLS_PER_DAY) {
    return false;
  }
  // Check minimum interval
  const last = recent[recent.length - 1];
  if (last && now - last < MIN_AI_CALL_INTERVAL_MS) {
    return false;
  }
  return true;
};

const recordAICall = async (): Promise<void> => {
  const stored = await loadAICallTimestamps();
  stored.push(Date.now());
  await saveAICallTimestamps(stored);
};

const sanitizeAIInput = (text: string, maxLength: number = 500): string => {
  return text
    .replace(/[\x00-\x1F\x7F]/g, "")
    .trim()
    .slice(0, maxLength);
};

const getIdToken = async (): Promise<string | null> => {
  try {
    const user = auth.currentUser;
    if (!user) return null;
    return await user.getIdToken();
  } catch {
    return null;
  }
};

class RateLimitedError extends Error {
  constructor() {
    super("Rate limit exceeded");
    this.name = "RateLimitedError";
  }
}

const callAIProxy = async (
  endpoint: ProxyEndpoint,
  system: string,
  user: string,
  timeoutMs: number = TIMEOUT_MS
): Promise<{ text: string; source: string }> => {
  const idToken = await getIdToken();
  const uid = auth.currentUser?.uid || "guest";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${AI_PROXY_URL}/api/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system, user, uid, idToken }),
      signal: controller.signal,
    });

    const data = (await response.json().catch(() => ({}))) as {
      text?: string;
      source?: string;
      error?: string;
      rateLimited?: boolean;
    };

    if (data.rateLimited) {
      throw new RateLimitedError();
    }
    if (data.error || !response.ok) {
      throw new Error(data.error || `Proxy request failed: ${response.status}`);
    }
    if (!data.text) {
      throw new Error("Proxy returned empty text.");
    }
    return { text: data.text, source: data.source || "claude" };
  } finally {
    clearTimeout(timer);
  }
};

const EXPENSE_SYSTEM_PROMPT =
  "You are PaisaWise, a smart Pakistani budget advisor in 2026. You are a Pakistani finance advisor. You ONLY mention real, verified locations. If unsure about a specific location, use general terms like 'your local bazaar' or 'wholesale market in your area'. Never invent street names or markets. Never invent street names, markets, or locations. Only mention real, well-known places that actually exist in the user's city. If you are not 100% certain a place exists in that city, do not mention it; use 'local bazaar' or 'main market' instead. For ALL Pakistani cities without exception — never mention specific street names, road names, bazaar names, or market names unless they are nationally famous landmarks (examples of allowed: Lahore's Liberty Market, Karachi's Saddar, Islamabad's F-7 Markaz, Lahore's Anarkali). For any other location reference, only use generic terms like 'apne local kiryana store se', 'nearby wholesale market', 'Sunday bazaar', 'apne sheher ke wholesale market mein'. This rule applies to Lahore, Karachi, Islamabad, Rawalpindi, Gujrat, Gujranwala, Sialkot, Faisalabad, Multan, Peshawar, Quetta, and every other city. Never invent or assume specific market names, road names, or shop locations for any city. General rule for all cities: stick to well-known landmarks only — main bazaar, Sunday bazaar, wholesale market, local kiryana store, nearest city's wholesale market. Use accurate 2026 Pakistan context (Airlift is closed, Pandamart is usually premium-priced, and inDrive/Careem typically cost around PKR 2500-3000 per 15 days for moderate use, not per month). Always tailor advice to the user's city from profile without fabricating local details. Include practical local options: neighborhood kiryana stores, Sunday bazaar, sabzi mandi, and wholesale markets. Prefer practical local substitutes, bulk-buy tips, and transport-aware suggestions relevant to that city. Be concise, honest, and never give generic or obviously wrong advice. For the 💰 Cheaper Option or 💡 Local Tip section, you must suggest the most relevant and accurate Pakistani online platform or resource based on what the expense actually is. Use your own knowledge to determine the best platform — do not default to Daraz unless it genuinely sells that product. Rules: Think: does this product actually sell on Daraz? If no, find the right platform. For niche products (vaping, hobby items, specialized equipment), use Pakistan-specific communities, Facebook groups, or specialized websites from your knowledge. For services (internet, electricity, gas), suggest bill payment apps like EasyPaisa, JazzCash, SadaPay. For skills/education, suggest free resources like YouTube, Coursera, local academies. For food, suggest local wholesale options or grocery apps. Always verify in your reasoning: 'Would a Pakistani actually buy this on the platform I'm suggesting?' If no specific platform exists, say 'check Facebook Marketplace or OLX for second-hand alternatives'. Never make up website URLs or platform names that don't exist in Pakistan. Additional rule: if expense category is 'Other' and expense name includes smoking/vaping/cigarettes/tobacco style habits, append exactly one short final line: 'Note: This is also a health expense — cutting it saves both money and health. 💪' Keep this line brief and non-preachy. LANGUAGE RULE: Always respond in Hinglish — a natural mix of Urdu and English in Roman script (not Urdu script). The ratio must be 70% Urdu words and 30% English words in every response. Never use pure English sentences or paragraphs. Never use Urdu script (Arabic letters). Always write Urdu words in Roman letters. Example style: 'Bhai, tera poora mahina ka paisa sirf bahar khaane pe ud gaya — 60% income ek hi category mein! Yeh toh serious masla hai, emergency fund ka toh koi plan hi nahi tera.' Keep this 70/30 Urdu/English ratio consistent in every single response without exception. TONE RULE: You are a supportive, caring financial friend — NOT a roaster. Never mock, shame, or lecture the user about their choices. Never say their spending is wasteful or unproductive. Give practical tips warmly, like a helpful older brother (bhai) who wants you to succeed. Save all judgment and roasting strictly for the Roast Me feature. Expense advice must always feel encouraging and helpful, never critical. STRICT FORMAT RULE: You must always respond in exactly this structure and headings:\n✅/⚠️/❌ Verdict: [Reasonable / High / Very High]\n\n[2-3 lines of honest analysis based on user's income and city]\n\n💡 Local Tip:\n[One specific, verified money-saving tip for their city. No invented locations.]\n\n💰 Cheaper Option:\n[One concrete alternative with estimated PKR savings]\nDo not add extra headings. Do not output markdown tables. Do not skip any section. Keep the total response under 100 words maximum (count all words across the verdict, analysis, local tip, and cheaper option combined). Never exceed 100 words under any circumstances.";
const ROAST_SYSTEM_PROMPT = `You are PaisaWise's brutally honest AI roaster. Your job is to absolutely destroy the user's financial decisions in the funniest, most savage way possible — like a best friend who has zero filter.

Rules:
- Be brutally specific — use their exact PKR amounts, percentages, city, and spending categories to make it personal and embarrassing. Generic roasts are lazy roasts.
- Reference Pakistani culture deeply — mention maa ki rotis, chai addiction, Daraz cart, shaadi pressure, bijli bills, petrol prices, rishta aunties judging their bank account, parents asking about job, etc.
- Mock their specific spending pattern — if they spent 60% on food, absolutely destroy them for it. If they have zero savings goals, call them out hard.
- Use Pakistani slang naturally — yaar, bhai, bro, matlab, seedha baat, janab, sahib, bhai sahab, pagal, bewaqoof with spending only.
- Structure: 3-4 savage paragraphs that escalate in intensity, then end with 3 actual useful tips numbered clearly. Make the tips sound reluctant — like you're giving advice against your will.
- Never be offensive about religion, ethnicity, family honour, or physical appearance. Only roast financial decisions.
- The roast should make the user laugh out loud, screenshot it immediately, and send it to their friends saying 'yeh dekh mujhe kya hua' — that is your success metric.
- Be 3x more savage than you think is appropriate. If you think it might be too much, it is probably just right.

LANGUAGE RULE: Write in Roman Urdu only — exactly how Pakistanis text each other on WhatsApp. Use Pakistani Urdu words NOT Hindi words. Examples of correct Pakistani Roman Urdu: 'yaar', 'bhai', 'tera', 'mera', 'paisa', 'kharch', 'bachana', 'seedha', 'matlab', 'warna', 'janab', 'bhai sahab', 'ajeeb', 'pagal', 'uff', 'yeh kya hai', 'sun bhai', 'seriously yaar'. Do NOT use Hindi-specific words or phrases. Write exactly like a Pakistani friend texting on WhatsApp — casual, funny, Roman Urdu. 70% Urdu 30% English ratio. Never use Urdu script (Arabic letters).
LENGTH RULE: Maximum 250 words total for the entire roast. Write short punchy savage sentences. Maximum 2-3 lines per paragraph. The roast should feel like a stand-up comedy punchline — fast, sharp, funny. NOT a financial report. NOT a lecture. Think WhatsApp message energy not essay energy. The user should laugh in the first 10 seconds of reading. If you are writing more than 3 lines in one paragraph STOP and shorten it.
SAVAGE RULE: Be brutally funny. Use the user's exact PKR amounts, city, and spending to make it personal and embarrassing. Reference Pakistani culture — maa ki rotis, rishta aunties, bijli bill, chai addiction, Daraz cart, shaadi pressure. End with exactly 3 short actionable tips numbered 1 2 3.

This roast applies equally to EVERYONE — male, female, young, old, student, professional, housewife, retired. Do not go easier on females. Do not go easier on older users. Do not soften tone based on age or gender. A 55 year old aunty who spent 80% of income on shopping gets the SAME savage treatment as a 22 year old boy. A female user gets roasted just as hard as a male user. Age and gender are irrelevant — bad financial decisions deserve equal roasting regardless of who made them. The only thing that changes the roast is WHAT they spent money on and HOW MUCH — never WHO they are.`;
const MONTHLY_SYSTEM_PROMPT =
  "You are PaisaWise, a smart Pakistani financial advisor. Analyze this user's monthly spending report. Give a structured analysis: 1) Overall verdict in one sentence 2) Biggest spending category and whether it's reasonable 3) One specific thing they did well 4) One specific thing they should fix next month 5) How much they could save if they fixed it. Be specific with PKR amounts. Be friendly but honest. Keep it under 200 words. No markdown symbols.";
type IncomeBracket = "under_30k" | "30k_80k" | "80k_200k" | "over_200k";

const hasInternetConnection = async (): Promise<boolean> => {
  try {
    const state = await NetInfo.fetch();
    if (state.isConnected === false || state.isInternetReachable === false) {
      return false;
    }
    return true;
  } catch {
    // If network state cannot be read, try cloud path.
    return true;
  }
};

const getContext = (profile: UserProfile | null) => {
  const name = profile?.fullName?.trim() || "User";
  const derivedAge = profile ? getAgeFromDob(profile.dob) ?? profile.age : null;
  const age = derivedAge != null && Number.isFinite(derivedAge) ? String(derivedAge) : "not set";
  const gender = profile?.gender ?? "male";
  const city = profile?.city?.trim() || "not set";
  const income = profile?.monthlySalary ?? 0;
  return { name, age, gender, city, income };
};

const topCategoryStats = (expenses: Expense[]) => {
  const byCat = new Map<string, number>();
  for (const e of expenses) {
    const k = e.category?.trim() || "Other";
    byCat.set(k, (byCat.get(k) ?? 0) + e.amount);
  }
  const sorted = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const [topCat, topAmount] = sorted[0] ?? ["Other", 0];
  return { topCat, topAmount, topCatPercent: sorted.length ? (topAmount / Math.max(1, expenses.reduce((s, e) => s + e.amount, 0))) * 100 : 0 };
};

const getIncomeBracket = (income: number): IncomeBracket => {
  if (income < 30_000) return "under_30k";
  if (income < 80_000) return "30k_80k";
  if (income <= 200_000) return "80k_200k";
  return "over_200k";
};

/** Verdict emoji aligned with Claude-style offline headers: ✅ Low, ⚠️ Medium/High, ❌ Very High. */
const offlineExpenseVerdict = (sharePct: number): { emoji: string; label: string } => {
  if (sharePct < 5) return { emoji: "✅", label: "Low" };
  if (sharePct < 15) return { emoji: "⚠️", label: "Medium" };
  if (sharePct < 30) return { emoji: "⚠️", label: "High" };
  return { emoji: "❌", label: "Very High" };
};

const incomeBracketHint = (bracket: IncomeBracket) => {
  if (bracket === "under_30k") {
    return "Income bracket PKR 30,000 se neeche — yaar yahan har rupee ka game plan chahiye; pehle roti, bijli, transport lock karo phir 'wants' pe aaana.";
  }
  if (bracket === "30k_80k") {
    return "Income PKR 30k–80k range — middle class wali sweet spot hai; needs tight rakho, wants ko throttle karo warna month end pe panic mode on ho jata hai.";
  }
  if (bracket === "80k_200k") {
    return "Income PKR 80k–200k — upper middle vibe; optimization + sinking funds best combo, random upgrades se cashflow leak mat hone do.";
  }
  return "Income PKR 200k+ — bhai high earning hai, lekin discipline na ho toh tax bracket upar, savings neeche reh jati hai; lifestyle creep ko politely block karo.";
};


const getOfflineExpenseAdvice = (
  expenseName: string,
  amount: number,
  category: string,
  income: number
): string => {
  const safeIncome = Math.max(income, 1);
  const sharePct = (amount / safeIncome) * 100;
  const { emoji, label } = offlineExpenseVerdict(sharePct);
  const bracket = getIncomeBracket(Math.max(0, income));
  const scenario = findOfflineScenario(expenseName, category);
  const yearly = formatPKR(amount * 12);

  if (!scenario) {
    return `${emoji} Verdict: ${label}

Yeh line item ${formatPKR(amount)} ban rahi hai — income ka ${sharePct.toFixed(1)}% lock ho raha hai. ${incomeBracketHint(bracket)}
Har mahina is category ko note karo; yearly roll-up ${yearly} lagta hai — 2026 Pakistan inflation context mein realistic band compare karna best hai.

💡 Local Tip:
Weekly mini-budget banao; month-end pe app ka total vs plan dekh ke next month ki cap adjust karo — boring lagta hai lekin stress kam karta hai.

💰 Cheaper Option:
OLX / Facebook Marketplace pe verified seller se second-hand ya open-box option check karo; urgent na ho toh 48-hour wait rule lagao — impulse tax bachta hai.`;
  }

  const rangeLine =
    amount < scenario.typicalMin
      ? `Amount typical band (${formatPKR(scenario.typicalMin)}–${formatPKR(scenario.typicalMax)}) se neeche — control acha lag raha hai, isi rhythm ko maintain karo.`
      : amount > scenario.typicalMax
      ? `Amount typical band (${formatPKR(scenario.typicalMin)}–${formatPKR(scenario.typicalMax)}) se upar ja raha hai — thori planning + price compare wala review banta hai.`
      : `Amount expected band (${formatPKR(scenario.typicalMin)}–${formatPKR(scenario.typicalMax)}) ke andar — average zone, frequency dekh ke decide karo ke yeh healthy recurring hai ya creep.`;

  return `${emoji} Verdict: ${label}

${scenario.analysis}
${rangeLine} Share abhi ${sharePct.toFixed(1)}% hai; yearly vibe ${yearly}. ${incomeBracketHint(bracket)}

💡 Local Tip:
${scenario.localTip}

💰 Cheaper Option:
${scenario.cheaperOption}`;
};

const getOfflineRoast = (
  profile: UserProfile | null,
  expenses: Expense[],
  goals: GoalInput[]
): string => {
  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const { topCat, topAmount } = topCategoryStats(expenses);
  const topExpense = [...expenses].sort((a, b) => b.amount - a.amount)[0]?.name ?? "random expense";
  const name = profile?.fullName?.trim() || "Boss";
  const income = formatPKR(profile?.monthlySalary ?? 0);
  const totalStr = formatPKR(total);
  const topAmountStr = formatPKR(topAmount);
  const city = profile?.city?.trim() || "Pakistan";
  const bracket = getIncomeBracket(profile?.monthlySalary ?? 0);
  const bracketTone =
    bracket === "under_30k"
      ? "Yaar yahan survival mode chalna chahiye tha — tumne hero mode on kar diya, wallet ne notice kar liya."
      : bracket === "30k_80k"
      ? "Middle class discipline ki zarurat thi — tumne 'mehman nawazi' wala flex maar diya, month end ro raha hai."
      : bracket === "80k_200k"
      ? "Income decent hai, planning weak ho toh cash bhi 'hawa mein udti' rehti hai — boring budget hi sexy hai."
      : "High earning ka matlab high-speed spending nahi — responsibility wala flex karo, card swipe wala nahi.";
  const dailyCap = formatPKR((profile?.monthlySalary ?? 0) / 30 || 1000);
  const qurbaniHint = formatPKR(
    profile?.monthlySalary ? Math.max(profile.monthlySalary * 0.4, 25000) : 50000
  );
  const templates = [
    `${name}, ${city} mein tumhari spending dekh ke lagta hai wallet ne union bana li hai — ${totalStr} uda diye, top damage ${topCat} (${topAmountStr}). ${bracketTone} Savage line: "${topExpense}" ne budget ko quietly finish kar diya. Fix pack: 7-day no-spend mini challenge, ${topCat} pe hard cap, salary day pe pehle auto-save — simple, boring, effective.`,
    `${name} bhai, income ${income} aur kharcha ${totalStr} — yeh planning nahi, stunt show hai. ${topCat} ka ${topAmountStr} dekh ke calculator bhi trauma mein hai. ${bracketTone} 3 moves: payment apps se extra cards hatao, top category ke liye cash envelope, raat ko 2-minute expense log — consistency > drama.`,
    `Breaking: ${name} (${city}) ne "Finance Fast & Furious" trophy utha li — ${totalStr} spend, sab se zyada dent ${topCat} (${topAmountStr}). ${bracketTone} Rescue: daily soft limit ${dailyCap}, weekend-only treats, goal fund ko non-negotiable transfer — boring routine hi win hai.`,
    `${name} sahab, spreadsheet nahi crime scene lag raha hai — ${topCat} ne ${topAmountStr} "loot liye" aur tum pose mode mein thay. ${bracketTone} Practical savage: PKR 1,000+ har buy pe price compare, 48-hour wait rule, monthly audit ek dost ke saath — accountability sweet poison hai.`,
    `${name}, Jazz/Zong/Telenor — har network tumhari salary pe zinda hai; ${topCat} (${topAmountStr}) aur status: "bachat karunga". ${bracketTone} Thappar tips: ek SIM + ek monthly bundle, auto-renew SMS check, WiFi primary mobile data emergency — seedha paisa bachta hai.`,
    `${name} bhai, rider tumhare gate ka GPS memorize kar chuka — ${topCat} (${topAmountStr}), total vibe food delivery tax. ${bracketTone} Weekend-only outside food, pickup = delivery fee bachao, Sunday batch cook — 4 din ka peace cheap nahi, priceless hai.`,
    `${name}, ${city} mein har weekend cousin shaadi aur tum gift ATM ban gaye — ${topCat} (${topAmountStr}) ke baad wrapping paper ke paise bhi tight. ${bracketTone} Gift cap per event, joint pool seekho, poora saal ka "shaadi envelope" abhi banao — savage but sane.`,
    `${name}, petrol moon pe ja raha hai aur bike Tour de ${city} record set kar rahi — ${topCat} (${topAmountStr}), total ${totalStr}. ${bracketTone} Trip batch karo, tyre pressure weekly, 1 colleague carpool — ~30% relief realistic zone mein hai.`,
    `${name}, bijli bill + UPS + battery + generator — double damage aesthetic; ${topCat} (${topAmountStr}) survival kit ban gaya. ${bracketTone} LED full house, raat ko standby unplug, AC 26°C lock — thanda dimag, garam wallet nahi.`,
    `${name}, match night = biryani + drinks + jersey + snacks — ${topCat} (${topAmountStr}); Babar bhi itne mein 50 nahi. ${bracketTone} Pre-set snack budget, highlights free tier enough, jersey 2 saal mein 1 — flex calm rakho, wallet zinda rakho.`,
    `${name}, dhaba chai/paan "chota kharcha" — month end ${topAmountStr} ka plot twist. ${topCat} ne quietly savings kha li. ${bracketTone} Flask culture, chai max 2/day, smoke/paan weekly envelope — short savage sentences, long relief.`,
    `${name}, Eid se pehle hi 4 lawn + 3 shoes + gifts — ${topCat} (${topAmountStr}) self-treat mode. ${bracketTone} Per-person cap, pre-Ramzan sales, quality > quantity — ek solid outfit > poora mall.`,
    `${name}, raat 2 baje Daraz = random gadgets — ${topCat} (${topAmountStr}); neend bhi gayi, paisa bhi. ${bracketTone} Cart 48h wait, notifications off, wishlist monthly audit — impulse ko politely block karo.`,
    `${name}, Qurbani last-minute ${qurbaniHint} wala panic, baqi mahine survival — ${topCat} (${topAmountStr}), planning zero. ${bracketTone} 12-month sinking fund, share model valid, early booking — pressure kam, savage kam, peace zyada.`,
    `${name}, pack + chai rounds = ${topAmountStr}/month; lungs ka "rent" alag bill mein aayega. ${topCat} short-term cute, long-term expensive. ${bracketTone} Count down weekly, vape trap avoid, health envelope alag — roast yahi, truth bhi yahi.`,
    `${name}, har Friday cinema + popcorn upgrade — effective ticket ~${formatPKR(2500)}; ${topCat} (${topAmountStr}) season pass energy. ${bracketTone} Tuesday off-peak, combo skip, mahine 1 movie — savage savings, same dopamine (thori si).`,
    `${name}, shaadi season = har event naya joda — ${topCat} (${topAmountStr}) tailor tax. ${bracketTone} 2 suits se 4 looks, alterations smart, rent/borrow valid — log kya kahenge? Wallet already bol raha hai.`,
    `${name}, Netflix+Spotify+Premium+Tapmad — subscribe sab, use kuch nahi; ${topCat} (${topAmountStr}) scroll tax. ${bracketTone} 2 apps max, family plans, free tier squeeze — boring audit, spicy savings.`,
    `${name}, "sale" ke chakkar mein 4 stores + extra petrol — grocery phir bhi ${topAmountStr}. ${topCat} ne hasi di, savings nahi. ${bracketTone} Single monthly run strict list, bulk basics, per-unit compare — savage simplicity.`,
    `${name}, late-night pizza/burger/broast — ${topCat} (${topAmountStr}) + gym fee side plot comedy. ${bracketTone} Weekday fast food zero, bank discounts, ghar ka simple — wallet aur health dono thank you bolengay.`,
    `${name}, generator summer mode = petrol burn aesthetic; ${topCat} (${topAmountStr}) — bijli bill ko inferiority complex de diya. ${bracketTone} selective rooms backup, inverter think, 2-3 solar quotes — payback real hai, drama kam.`,
    `${name}, VPN + streaming + snacks har match — ${topCat} (${topAmountStr}); wallet IPL support bhi de raha hai. ${bracketTone} ek VPN ek app, match-night cap, highlights mood — cost 20% mood 80%.`,
    `${name}, 3 committees "bachat" naam se, har month ${topAmountStr}+, emergency fund still zero — ${topCat} alag leak. ${bracketTone} bank primary committee secondary, liquid fund pehle, verified circle only — trust issue roast, fix bhi yahi.`,
    `${name}, dost ki birthday = cake + dinner + gift solo — ${topCat} (${topAmountStr}); apni birthday kab? ${bracketTone} group split norm, homemade flex, annual celebration budget — savage sentences end, peace start.`,
  ];
  const idx = Math.abs((name + city + String(goals.length)).length) % templates.length;
  return templates[idx] ?? templates[0];
};

const getOfflineMonthlyAnalysis = (
  profile: UserProfile | null,
  expenses: Expense[],
  monthName: string
): string => {
  const name = profile?.fullName?.trim() || "User";
  const incomeNum = profile?.monthlySalary ?? 0;
  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const pct = incomeNum > 0 ? (total / incomeNum) * 100 : 0;
  const { topCat, topAmount, topCatPercent } = topCategoryStats(expenses);
  const mood =
    pct > 80
      ? "Red flag zone — almost sab kuch spend ho raha hai, savings + emergency cushion kam ho jata hai; abhi thora strict mode on karna padega."
      : pct >= 50
      ? "Okay-ish band hai lekin margin tight hai — 50% se neeche lane ki koshish realistic win hai, small cuts compound hotay hain."
      : "Solid discipline vibe — healthy portion save ho rahi hai, isi consistency ko boring routine bana lo (boring = good yahan pe).";

  return `${name}, ${monthName} ka offline monthly snapshot: total spend ${formatPKR(
    total
  )}, income ${formatPKR(incomeNum)} — yani ${pct.toFixed(
    0
  )}% earnings flow out ho gayi. Sab se bara bucket ${topCat} tha (${formatPKR(
    topAmount
  )}), overall ka ${topCatPercent.toFixed(0)}% hissa. ${mood} Agla month ${topCat} ko ~20% squeeze kar lo toh roughly ${formatPKR(
    topAmount * 0.2
  )}/month relief mil sakta hai — baby steps, no drama.`;
};

const tryCloud = async (
  endpoint: ProxyEndpoint,
  system: string,
  user: string,
  timeoutMs: number = TIMEOUT_MS
): Promise<AIResult> => {
  const online = await hasInternetConnection();
  if (!online) {
    throw new Error("Device is offline.");
  }

  const { text, source } = await callAIProxy(endpoint, system, user, timeoutMs);
  await recordAICall();
  const normalizedSource: AIResult["source"] =
    source === "claude" || source === "groq" ? source : "claude";
  return { text, source: normalizedSource };
};

export const getExpenseAdvice = async (
  userProfile: UserProfile | null,
  expenseName: string,
  amount: number,
  category: string,
  frequency: "one_time" | "monthly",
  existingExpenses: Expense[] = []
): Promise<AIResult> => {
  const ctx = getContext(userProfile);
  const categoryMonthlyTotal =
    existingExpenses
      .filter((e) => e.category.trim().toLowerCase() === category.trim().toLowerCase())
      .reduce((sum, e) => sum + e.amount, 0) + amount;
  const income = Math.max(0, ctx.income);
  const categoryShare = income > 0 ? (categoryMonthlyTotal / income) * 100 : 0;
  const frequencyContext =
    frequency === "monthly"
      ? "This is a MONTHLY recurring expense. Analyze sustainability for monthly budget and recurring burden."
      : "This is a ONE-TIME purchase. Analyze value-for-money and whether it was worth it vs cheaper alternatives.";
  const toneHint =
    frequency === "monthly"
      ? `Use recurring-tone examples like: "Monthly ${formatPKR(amount)} ${category} budget — for ${ctx.city} that's reasonable at your income."`
      : `Use one-time-tone examples like: "Aaj ${formatPKR(amount)} ${category}? Shaadi thi kya? 😂"`;
  const categoryWarningHint =
    categoryShare > 30
      ? `Also include this warning in your response: ⚠️ Tera ${category} budget barh raha hai is mahine! (category total is ${formatPKR(
          categoryMonthlyTotal
        )}, ${categoryShare.toFixed(0)}% of income).`
      : "";
  const safeName = sanitizeAIInput(ctx.name, 80);
  const safeCity = sanitizeAIInput(ctx.city, 80);
  const safeExpenseName = sanitizeAIInput(expenseName, 120);
  const safeCategory = sanitizeAIInput(category, 60);
  const userMessage = `User: ${safeName}, Age: ${ctx.age}, Gender: ${ctx.gender}, City: ${safeCity}, Income: ${formatPKR(
    ctx.income
  )} — Expense: ${safeExpenseName}, Amount: ${formatPKR(amount)}, Category: ${safeCategory}, Frequency: ${frequency}.
${frequencyContext}
${toneHint}
Current month total in category "${safeCategory}": ${formatPKR(categoryMonthlyTotal)} (${categoryShare.toFixed(0)}% of income).
${categoryWarningHint}`;

  if (!(await canMakeAICall())) {
    const base = getOfflineExpenseAdvice(expenseName, amount, category, ctx.income);
    return { text: `${CLIENT_RATE_LIMIT_NOTE}\n${base}`, source: "offline" };
  }

  try {
    return await tryCloud("expense-advice", EXPENSE_SYSTEM_PROMPT, userMessage);
  } catch (err) {
    if (err instanceof RateLimitedError) {
      return {
        text: "Aaj ke liye AI advice limit ho gayi hai. Kal phir try karo! 🔒",
        source: "offline",
      };
    }
    const base = getOfflineExpenseAdvice(expenseName, amount, category, ctx.income);
    const frequencyLine =
      frequency === "monthly"
        ? `Monthly lens: ${formatPKR(amount)} recurring ${category} — income ke hisaab se sustainable rakhna, warna creep silent killer ban jati hai.`
        : `One-time lens: ${formatPKR(amount)} single shot spend — value-for-money aur cheaper alt dono honestly weigh karo.`;
    const warn =
      categoryShare > 30
        ? `\n⚠️ Tera ${category} budget barh raha hai is mahine!`
        : "";
    return { text: `${frequencyLine}\n${base}${warn}`, source: "offline" };
  }
};

export const getRoast = async (
  userProfile: UserProfile | null,
  expenses: Expense[],
  goals: GoalInput[]
): Promise<AIResult> => {
  const ctx = getContext(userProfile);
  const safeName = sanitizeAIInput(ctx.name, 80);
  const safeCity = sanitizeAIInput(ctx.city, 80);
  const expenseLines =
    expenses.length === 0
      ? "(none)"
      : expenses
          .map(
            (e, i) =>
              `${i + 1}. ${sanitizeAIInput(e.name, 120)} — ${formatPKR(e.amount)} (${sanitizeAIInput(
                e.category,
                60
              )}) · ${formatDatePK(e.date)}`
          )
          .join("\n");
  const goalLines =
    goals.length === 0
      ? "(none)"
      : goals
          .map(
            (g, i) =>
              `${i + 1}. ${sanitizeAIInput(g.name, 120)} — target ${formatPKR(g.targetAmount)}, saved ${formatPKR(
                g.savedAmount
              )}${g.deadlineMonth ? `, deadline ${sanitizeAIInput(g.deadlineMonth, 30)}` : ""}`
          )
          .join("\n");

  const userMessage = `About user: ${safeName}, age ${ctx.age}, gender ${ctx.gender}, city ${safeCity}, income ${formatPKR(
    ctx.income
  )}.

Expenses:
${expenseLines}

Goals:
${goalLines}

Roast this user based on spending vs income and realistic goal progress.`;

  if (!(await canMakeAICall())) {
    return {
      text: `${CLIENT_RATE_LIMIT_NOTE}\n${getOfflineRoast(userProfile, expenses, goals)}`,
      source: "offline",
    };
  }

  try {
    return await tryCloud("roast", ROAST_SYSTEM_PROMPT, userMessage, ROAST_TIMEOUT_MS);
  } catch (err) {
    if (err instanceof RateLimitedError) {
      return {
        text: "Aaj ke liye AI roast limit ho gayi hai. Kal phir try karo! 🔒",
        source: "offline",
      };
    }
    return { text: getOfflineRoast(userProfile, expenses, goals), source: "offline" };
  }
};

export const getMonthlyAnalysis = async (
  userProfile: UserProfile | null,
  monthExpenses: Expense[],
  monthName: string
): Promise<AIResult> => {
  const ctx = getContext(userProfile);
  const total = monthExpenses.reduce((s, e) => s + e.amount, 0);
  const safeName = sanitizeAIInput(ctx.name, 80);
  const safeCity = sanitizeAIInput(ctx.city, 80);
  const safeMonthName = sanitizeAIInput(monthName, 40);
  const details = monthExpenses
    .map(
      (e, i) =>
        `${i + 1}. ${sanitizeAIInput(e.name, 120)} | ${sanitizeAIInput(e.category, 60)} | ${formatPKR(e.amount)}`
    )
    .join("\n");

  const userMessage = `Monthly period: ${safeMonthName}
User: ${safeName}, age ${ctx.age}, gender ${ctx.gender}, city ${safeCity}
Monthly income: ${formatPKR(ctx.income)}
Total spent: ${formatPKR(total)}

Expenses:
${details}`;

  if (!(await canMakeAICall())) {
    return {
      text: `${CLIENT_RATE_LIMIT_NOTE}\n${getOfflineMonthlyAnalysis(userProfile, monthExpenses, monthName)}`,
      source: "offline",
    };
  }

  try {
    return await tryCloud("monthly-analysis", MONTHLY_SYSTEM_PROMPT, userMessage, ROAST_TIMEOUT_MS);
  } catch (err) {
    if (err instanceof RateLimitedError) {
      return {
        text: "Aaj ke liye AI analysis limit ho gayi hai. Kal phir try karo! 🔒",
        source: "offline",
      };
    }
    return { text: getOfflineMonthlyAnalysis(userProfile, monthExpenses, monthName), source: "offline" };
  }
};

export type { AIResult, GoalInput };

