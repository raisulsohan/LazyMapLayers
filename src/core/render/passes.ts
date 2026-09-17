// Render passes and mattes for compositing in After Effects.
//
// Every style layer belongs to a group (style metadata "lml:group"). A frame is drawn once per
// needed group set ("render"), always with the same tiles and camera, and the passes are composed
// from those renders in premultiplied RGBA:
//
//   base         everything (the normal basemap)
//   land         land fills, minus inland water, held out by buildings
//   water        background and water fills, masked to water, held out by buildings
//   boundaries   boundary and coastline lines, held out by buildings
//   roads        roads and rail, held out by buildings
//   buildings    3D buildings
//   landMatte    white where land (inland water excluded), no holdout
//   waterMatte   white where water; landMatte + waterMatte cover every pixel exactly once
//   highlight    highlighted countries alone, with alpha; never part of the base pass, and added by
//                the render job itself whenever a map has highlights (it is not a user setting)
//
// Holdouts: buildings stand in front of everything on the ground, so a ground pass loses the pixels a
// building covers. Laying a roads pass with a glow over the base pass then never glows through a
// building.

export type LayerGroup = "background" | "imagery" | "land" | "water" | "boundaries" | "roads" | "buildings" | "highlight" | "labels" | "overlay";

export const PASS_IDS = ["base", "land", "water", "boundaries", "roads", "buildings", "landMatte", "waterMatte"] as const;
/** Passes the user can switch on, plus the highlight pass that follows the map's highlights. */
export type PassId = (typeof PASS_IDS)[number] | "highlight";
export const HIGHLIGHT_PASS: PassId = "highlight";

export type RenderId = "base" | "land" | "landShapes" | "waterFill" | "waterShapes" | "boundaries" | "roads" | "buildings" | "highlight";

export const PASS_INFO: Record<PassId, { label: string; kind: "color" | "matte" }> = {
  base: { label: "Base", kind: "color" },
  land: { label: "Land", kind: "color" },
  water: { label: "Water", kind: "color" },
  boundaries: { label: "Boundaries", kind: "color" },
  roads: { label: "Roads", kind: "color" },
  buildings: { label: "Buildings", kind: "color" },
  landMatte: { label: "Land Matte", kind: "matte" },
  waterMatte: { label: "Water Matte", kind: "matte" },
  highlight: { label: "Highlight", kind: "color" }
};

/** Groups drawn by each render. The base render draws every group except labels unless asked. */
// Imagery (satellite pictures, shaded relief) covers land and sea alike, so it colours the land and
// water passes, while "landShapes" (the land polygons alone) says where the land is.
const RENDER_GROUPS: Record<Exclude<RenderId, "base">, LayerGroup[]> = {
  land: ["land", "imagery"],
  landShapes: ["land"],
  waterFill: ["background", "imagery", "water"],
  waterShapes: ["water"],
  boundaries: ["boundaries"],
  roads: ["roads"],
  buildings: ["buildings"],
  highlight: ["highlight"]
};

export function isPassId(value: string): value is PassId {
  return (PASS_IDS as readonly string[]).includes(value);
}

/** Whether a layer of `group` is drawn in `render`. */
export function groupVisibleIn(render: RenderId, group: LayerGroup, options: { labels: boolean }): boolean {
  // Highlights are their own layer in After Effects, so the basemap stays clean under them.
  if (render === "base") return group !== "highlight" && (group !== "labels" || options.labels);
  return RENDER_GROUPS[render].includes(group);
}

/**
 * Renders needed to compose the given passes. `hasBuildings` adds the holdout render, `hasImagery`
 * the land shapes (without imagery the land render itself has the land's shape).
 */
export function rendersFor(passes: readonly PassId[], hasBuildings: boolean, hasImagery = false): RenderId[] {
  const needed = new Set<RenderId>();
  const holdout = hasBuildings;
  for (const pass of passes) {
    switch (pass) {
      case "base":
        needed.add("base");
        break;
      case "land":
        needed.add("land").add("waterShapes");
        if (holdout) needed.add("buildings");
        break;
      case "water":
        needed.add("waterFill").add("land").add("waterShapes");
        if (holdout) needed.add("buildings");
        break;
      case "boundaries":
      case "roads":
      case "highlight":
        needed.add(pass);
        if (holdout) needed.add("buildings");
        break;
      case "buildings":
        if (hasBuildings) needed.add("buildings");
        break;
      case "landMatte":
      case "waterMatte":
        needed.add("land").add("waterShapes");
        break;
    }
  }
  if (hasImagery && (needed.has("land") || needed.has("waterFill"))) needed.add("landShapes");
  const order: RenderId[] = ["base", "land", "landShapes", "waterFill", "waterShapes", "boundaries", "roads", "buildings", "highlight"];
  return order.filter((r) => needed.has(r));
}

const mul = (a: number, b: number) => ((a * b + 127) / 255) | 0;

/** Scales every channel of a premultiplied buffer by a per-pixel 0..255 factor. */
function scaled(src: Uint8Array, factorAt: (pixel: number) => number): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let p = 0, i = 0; i < src.length; p++, i += 4) {
    const f = factorAt(p);
    if (f === 255) {
      out[i] = src[i];
      out[i + 1] = src[i + 1];
      out[i + 2] = src[i + 2];
      out[i + 3] = src[i + 3];
    } else if (f !== 0) {
      out[i] = mul(src[i], f);
      out[i + 1] = mul(src[i + 1], f);
      out[i + 2] = mul(src[i + 2], f);
      out[i + 3] = mul(src[i + 3], f);
    }
  }
  return out;
}

function whiteMatte(coverage: Uint8Array): Uint8Array {
  const out = new Uint8Array(coverage.length * 4);
  for (let p = 0; p < coverage.length; p++) out.fill(coverage[p], p * 4, p * 4 + 4);
  return out;
}

/**
 * Composes passes from renders (premultiplied RGBA8, all the same size and row order). Returns
 * premultiplied RGBA8 per pass. A missing buildings render means no buildings: no holdout, and an
 * empty buildings pass.
 */
export function composePasses(renders: Partial<Record<RenderId, Uint8Array>>, passes: readonly PassId[], pixelCount: number): Partial<Record<PassId, Uint8Array>> {
  const need = (id: RenderId) => {
    const r = renders[id];
    if (!r) throw new Error(`render "${id}" is missing`);
    if (r.length !== pixelCount * 4) throw new Error(`render "${id}" has ${r.length} bytes, expected ${pixelCount * 4}`);
    return r;
  };
  const buildings = renders.buildings;
  const holdoutAt = buildings ? (p: number) => 255 - buildings[p * 4 + 3] : () => 255;

  let landCoverage: Uint8Array | null = null;
  const landCoverageOf = () => {
    if (!landCoverage) {
      const land = renders.landShapes ?? need("land");
      const water = need("waterShapes");
      landCoverage = new Uint8Array(pixelCount);
      for (let p = 0; p < pixelCount; p++) landCoverage[p] = mul(land[p * 4 + 3], 255 - water[p * 4 + 3]);
    }
    return landCoverage;
  };

  const out: Partial<Record<PassId, Uint8Array>> = {};
  for (const pass of passes) {
    switch (pass) {
      case "base":
        out.base = need("base");
        break;
      case "land": {
        const water = need("waterShapes");
        const shapes = renders.landShapes;
        // With imagery in the land render, the land polygons cut it to the land's shape.
        out.land = shapes ? scaled(need("land"), (p) => mul(mul(shapes[p * 4 + 3], 255 - water[p * 4 + 3]), holdoutAt(p))) : scaled(need("land"), (p) => mul(255 - water[p * 4 + 3], holdoutAt(p)));
        break;
      }
      case "water": {
        const coverage = landCoverageOf();
        out.water = scaled(need("waterFill"), (p) => mul(255 - coverage[p], holdoutAt(p)));
        break;
      }
      case "boundaries":
      case "roads":
      case "highlight":
        out[pass] = scaled(need(pass), holdoutAt);
        break;
      case "buildings":
        out.buildings = buildings ? buildings : new Uint8Array(pixelCount * 4);
        break;
      case "landMatte":
        out.landMatte = whiteMatte(landCoverageOf());
        break;
      case "waterMatte": {
        const coverage = landCoverageOf();
        const water = new Uint8Array(pixelCount);
        for (let p = 0; p < pixelCount; p++) water[p] = 255 - coverage[p];
        out.waterMatte = whiteMatte(water);
        break;
      }
    }
  }
  return out;
}
