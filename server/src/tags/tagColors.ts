// 10 evenly-spaced hues so MAX_TAGS_PER_USER (10) never has to repeat a color.
export const TAG_COLORS = [
  "oklch(60% 0.18 0)",
  "oklch(60% 0.18 36)",
  "oklch(60% 0.18 72)",
  "oklch(60% 0.18 108)",
  "oklch(60% 0.18 144)",
  "oklch(60% 0.18 180)",
  "oklch(60% 0.18 216)",
  "oklch(60% 0.18 252)",
  "oklch(60% 0.18 288)",
  "oklch(60% 0.18 324)",
];

export function pickTagColor(usedColors: string[]): string {
  const used = new Set(usedColors);
  return TAG_COLORS.find((c) => !used.has(c)) ?? TAG_COLORS[usedColors.length % TAG_COLORS.length];
}
