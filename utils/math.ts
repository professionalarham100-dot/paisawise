/** Constrain `value` to the inclusive range `[min, max]`. */
export const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};
