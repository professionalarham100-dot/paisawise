/**
 * Removes markdown, table artifacts, repeated emojis, and noisy spacing from AI output.
 * Keeps plain readable paragraphs for mobile UI.
 */
export const cleanAIText = (input: string): string => {
  let text = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Remove fenced code blocks while keeping inner text.
  text = text.replace(/```[\s\S]*?```/g, (block) =>
    block.replace(/```[a-zA-Z]*\n?/g, "").replace(/```/g, "")
  );

  // Strip common markdown symbols and separators.
  text = text.replace(/^\s{0,3}#{1,6}\s*/gm, "");
  text = text.replace(/\*\*(.*?)\*\*/g, "$1");
  text = text.replace(/\*(.*?)\*/g, "$1");
  text = text.replace(/^>\s?/gm, "");
  text = text.replace(/^\s*[-_]{3,}\s*$/gm, "");
  text = text.replace(/`([^`]+)`/g, "$1");

  // Convert markdown table lines to "A: B | C: D" style simple text.
  const lines = text.split("\n");
  const normalizedLines: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      normalizedLines.push("");
      continue;
    }
    const isTableSep = /^\|?[\s:-]+\|[\s|:-]*$/.test(line);
    if (isTableSep) {
      continue;
    }
    if (line.includes("|")) {
      const cells = line
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);
      if (cells.length >= 2) {
        if (cells.length % 2 === 0) {
          const parts: string[] = [];
          for (let i = 0; i < cells.length; i += 2) {
            parts.push(`${cells[i]}: ${cells[i + 1]}`);
          }
          normalizedLines.push(parts.join(" | "));
          continue;
        }
        normalizedLines.push(cells.join(" - "));
        continue;
      }
    }
    normalizedLines.push(line);
  }

  text = normalizedLines.join("\n");

  // Collapse repeated emoji runs e.g. 🔥🔥🔥 -> 🔥
  text = text.replace(/([\p{Extended_Pictographic}])\1{1,}/gu, "$1");
  // Normalize bullets.
  text = text.replace(/^\s*[\-\u2022]\s+/gm, "• ");
  // Remove extra spaces and excessive empty lines.
  text = text.replace(/[ \t]{2,}/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
};
