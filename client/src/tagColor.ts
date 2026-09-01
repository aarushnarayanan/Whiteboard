const TAG_COLORS = [
  "oklch(60% 0.19 25)",
  "oklch(60% 0.17 145)",
  "oklch(58% 0.19 280)",
  "oklch(65% 0.18 60)",
  "oklch(60% 0.19 330)",
  "oklch(60% 0.15 200)",
];

export function tagColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length];
}
