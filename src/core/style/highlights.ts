// Highlighted countries of a map. They are drawn as their own render pass (fill, outline and a soft
// glow with alpha), so in After Effects the highlight is a layer of its own above the clean basemap.

/** Polygons of a custom area, as GeoJSON MultiPolygon coordinates: [polygon][ring][point][lng, lat]. */
export type AreaGeometry = number[][][][];

/** Geometry of the custom areas a map highlights, by area id (the part after "area:" in a highlight's code). */
export type Areas = Record<string, AreaGeometry>;

export const AREA_PREFIX = "area:";

export type Highlight = {
  /**
   * What is highlighted: Natural Earth's three-letter code of a country (adm0_a3, which the world
   * tiles carry), or "area:<id>" for a custom area whose polygons live in the map's areas.
   */
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
    if (typeof h.code !== "string" || !/^(area:[a-z0-9]{4,24}|[A-Z0-9_-]{2,8})$/i.test(h.code) || seen.has(h.code)) continue;
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

export const isAreaCode = (code: string) => code.startsWith(AREA_PREFIX);
export const areaIdOf = (code: string) => code.slice(AREA_PREFIX.length);

/** Points an area may keep (all rings together), and areas a map may hold: the project stores them. */
export const AREA_MAX_POINTS = 600;
export const MAX_AREAS = 40;

/** Stored areas, repaired: only the geometry of areas that are still highlighted is kept. */
export function normaliseAreas(raw: unknown, highlights: Highlight[]): Areas {
  const out: Areas = {};
  if (!raw || typeof raw !== "object") return out;
  const wanted = new Set(highlights.filter((h) => isAreaCode(h.code)).map((h) => areaIdOf(h.code)));
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!wanted.has(id) || !Array.isArray(value) || Object.keys(out).length >= MAX_AREAS) continue;
    const polygons: AreaGeometry = [];
    for (const polygon of value) {
      if (!Array.isArray(polygon)) continue;
      const rings: number[][][] = [];
      for (const ring of polygon) {
        if (!Array.isArray(ring)) continue;
        const points = ring.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[1]) <= 90).map((p) => [p[0], p[1]]);
        if (points.length >= 4) rings.push(points);
      }
      if (rings.length) polygons.push(rings);
    }
    if (polygons.length) out[id] = polygons;
  }
  return out;
}

/** Adds the country, or removes it when it is highlighted already. New ones take the next colour. */
export function toggleHighlight(list: Highlight[], code: string, name: string): Highlight[] {
  if (list.some((h) => h.code === code)) return list.filter((h) => h.code !== code);
  const style = list[list.length - 1] ?? DEFAULT_HIGHLIGHT;
  const color = HIGHLIGHT_COLORS.find((c) => !list.some((h) => h.color === c)) ?? HIGHLIGHT_COLORS[list.length % HIGHLIGHT_COLORS.length];
  return [...list, { code, name, color, fill: style.fill, outline: style.outline }];
}
