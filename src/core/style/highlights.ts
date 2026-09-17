// Highlighted countries of a map. They are drawn as their own render pass (fill, outline and a soft
// glow with alpha), so in After Effects the highlight is a layer of its own above the clean basemap.

export type Highlight = {
  /** Natural Earth's three-letter code of the country (adm0_a3), which the world tiles carry. */
  code: string;
  name: string;
  color: string;
  /** Fill opacity, 0 to 1. */
  fill: number;
  /** Outline width in comp pixels (0 for none). */
  outline: number;
};

export const DEFAULT_HIGHLIGHT = { color: "#ff9d2e", fill: 0.4, outline: 3 } as const;

/** Colours offered for new highlights, in turn, so neighbours differ. */
export const HIGHLIGHT_COLORS = ["#ff9d2e", "#36b3ff", "#ff5d73", "#5fd38d", "#c792ea", "#ffd84d"];

const HEX = /^#[0-9a-fA-F]{6}$/;

export function normaliseHighlights(raw: unknown): Highlight[] {
  if (!Array.isArray(raw)) return [];
  const out: Highlight[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const h = (entry ?? {}) as Partial<Highlight>;
    if (typeof h.code !== "string" || !/^[A-Z0-9_-]{2,8}$/i.test(h.code) || seen.has(h.code)) continue;
    seen.add(h.code);
    out.push({
      code: h.code,
      name: typeof h.name === "string" && h.name ? h.name.slice(0, 80) : h.code,
      color: typeof h.color === "string" && HEX.test(h.color) ? h.color.toLowerCase() : DEFAULT_HIGHLIGHT.color,
      fill: Number.isFinite(h.fill) ? Math.max(0, Math.min(1, h.fill as number)) : DEFAULT_HIGHLIGHT.fill,
      outline: Number.isFinite(h.outline) ? Math.max(0, Math.min(40, h.outline as number)) : DEFAULT_HIGHLIGHT.outline
    });
  }
  return out.slice(0, 60);
}

/** Adds the country, or removes it when it is highlighted already. New ones take the next colour. */
export function toggleHighlight(list: Highlight[], code: string, name: string): Highlight[] {
  if (list.some((h) => h.code === code)) return list.filter((h) => h.code !== code);
  const style = list[list.length - 1] ?? DEFAULT_HIGHLIGHT;
  const color = HIGHLIGHT_COLORS.find((c) => !list.some((h) => h.color === c)) ?? HIGHLIGHT_COLORS[list.length % HIGHLIGHT_COLORS.length];
  return [...list, { code, name, color, fill: style.fill, outline: style.outline }];
}
