export const CATEGORY_COLOR_MAP: Record<string, string> = {
  food: "#FF6B6B",
  transport: "#4ECDC4",
  shopping: "#DDA0DD",
  utilities: "#FFEAA7",
  health: "#96CEB4",
  education: "#7BDFF2",
  entertainment: "#45B7D1",
  other: "#98D8C8",
};

export const getCategoryColor = (category: string): string => {
  const key = category.trim().toLowerCase();
  return CATEGORY_COLOR_MAP[key] ?? CATEGORY_COLOR_MAP.other;
};
