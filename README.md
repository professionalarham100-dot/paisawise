# PaisaWise

AI-powered budget planner built for Pakistanis. Track expenses, set saving goals, get personalised financial advice, and roast your spending habits — all in one dark-themed mobile app.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React Native + Expo 54 (file-based routing via expo-router) |
| Auth | Firebase Authentication (email/password) |
| Database | Firebase Firestore (cloud sync for signed-in users) |
| Local storage | AsyncStorage |
| AI advice | Anthropic Claude API (primary) + Groq API (fallback) |
| Notifications | Expo Notifications |
| Language | TypeScript |

---

## Prerequisites

- Node.js 18+
- Expo CLI (`npm install -g expo-cli`)
- A Firebase project with Authentication and Firestore enabled
- An Anthropic API key (for AI advice)
- A Groq API key (for AI fallback)

---

## Setup

```bash
# 1. Clone the repo
git clone <repo-url>
cd PaisaWise

# 2. Install dependencies
npm install

# 3. Create environment file
cp .env.example .env   # or create .env manually
```

All API calls route through a secure proxy. Do not add keys to this app.

```bash
# 4. Start the dev server
npx expo start
```

Then press `a` for Android emulator, `i` for iOS simulator, or scan the QR code with Expo Go.

---

## Project Structure

```
PaisaWise/
├── app/                    # Screens (expo-router file-based routes)
│   ├── _layout.tsx         # Root layout, auth guard, network banner
│   ├── index.tsx           # Home dashboard
│   ├── welcome.tsx         # Landing screen (unauthenticated)
│   ├── login.tsx           # Sign in / sign up
│   ├── onboarding.tsx      # First-run onboarding
│   ├── profile.tsx         # Profile setup and settings
│   ├── add-expense.tsx     # Add / edit expense
│   ├── history.tsx         # Expense history
│   ├── goals.tsx           # Saving goals
│   ├── roast.tsx           # AI spending roast
│   └── privacy-policy.tsx  # In-app privacy policy
├── storage/                # Data access layer
│   ├── expenses.ts         # Expense CRUD + AsyncStorage
│   ├── userProfile.ts      # Profile read/write + Firestore sync
│   ├── firestoreRestore.ts # Cloud restore on sign-in
│   └── guestMode.ts        # Guest mode flag
├── utils/                  # Utilities
│   ├── aiService.ts        # Claude + Groq API calls
│   ├── aiText.ts           # Prompt builders
│   ├── notifications.ts    # Daily reminder scheduling
│   ├── currency.ts         # PKR formatting helpers
│   └── categoryColors.ts   # Expense category colour map
├── lib/
│   └── firebase.ts         # Firebase app, auth, and Firestore init
├── assets/                 # Images and icons
└── app.json                # Expo config
```

---

## Features

- **Guest mode** — use the app without creating an account; all data stays on-device
- **Cloud sync** — sign in to back up and restore data across devices via Firestore
- **Expense tracking** — add, edit, and delete expenses with categories and dates
- **Expense history** — filterable list of past expenses by month
- **Budget dashboard** — monthly income vs. spending overview with visual progress
- **Saving goals** — create goals with target amounts and track progress
- **AI financial advice** — personalised tips based on your spending patterns (Claude API)
- **Spending roast** — savage Roman Urdu roast of your worst spending habits (Claude/Groq)
- **Daily reminder** — optional 9 PM push notification to log expenses
- **Account deletion** — full data wipe from Firestore + AsyncStorage + Firebase Auth (Play Store compliant)
- **Privacy policy** — in-app privacy policy screen (Play Store requirement)

---

## Firebase Setup

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Email/Password** authentication
3. Create a **Firestore** database in production mode
4. Copy your Firebase config into `lib/firebase.ts`

Firestore data is structured as:

```
users/{uid}/data/expenses   — expense array document
users/{uid}/data/profile    — user profile document
users/{uid}/data/goals      — saving goals document
users/{uid}/data/meta       — sync metadata
```

---

## Environment Variables

All API calls route through a secure proxy. Do not add keys to this app.
