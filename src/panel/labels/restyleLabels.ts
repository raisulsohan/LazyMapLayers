// The names already on a map take a changed template: core works out what every label layer should
// look like (core/labels/restyle.ts), and the host restyles them in small batches, so After Effects
// never blocks for long and the scene stays out of the viewer while the text documents change.

import type { LabelTemplate } from "../../core/labels/labelTemplate.ts";
import { restylePlan, type PlacedLabel } from "../../core/labels/restyle.ts";
import { callHost, callHostWithJobFile } from "../cep.ts";

type Info = { width: number; height: number; frameRate: number };

/** Text layers per call into After Effects: a text style takes a few milliseconds each. */
export const RESTYLE_BATCH = 40;

export type RestyleResult = {
  /** Names on the map (a name may be two or three layers). */
  labels: number;
  texts: number;
  dots: number;
  removed: number;
  /** Place names the template wants a dot for that have none: only placing again makes them. */
  dotsMissing: number;
  longestCallMs: number;
};

export type RestyleOptions = {
  template: LabelTemplate;
  /** "label" (Auto labels, the default) or "value" (the numbers of a data map). */
  kind?: string;
  onProgress?: (done: number, total: number) => void;
};

export async function restyleLabels(mapId: string, options: RestyleOptions): Promise<RestyleResult> {
  const kind = options.kind ?? "label";
  const result: RestyleResult = { labels: 0, texts: 0, dots: 0, removed: 0, dotsMissing: 0, longestCallMs: 0 };
  const placed = await callHost<PlacedLabel[]>("listLabels", { mapId, kind });
  if (!placed.length) return result;
  const info = await callHost<Info>("renderInfo", { mapId });
  const plan = restylePlan(placed, options.template, info.height / 1080);
  result.labels = new Set(placed.map((label) => label.labelId)).size;
  // Values are not places: they never get dots, so none are missing.
  result.dotsMissing = kind === "label" ? plan.dotsMissing : 0;
  const batches = Math.max(1, Math.ceil(plan.texts.length / RESTYLE_BATCH));
  for (let b = 0; b < batches; b++) {
    const last = b === batches - 1;
    const started = Date.now();
    const made = await callHostWithJobFile<{ texts: number; dots: number; removed: number }>("restyleLabels", {
      mapId,
      kind,
      first: b === 0,
      last,
      texts: plan.texts.slice(b * RESTYLE_BATCH, (b + 1) * RESTYLE_BATCH),
      dots: last ? plan.dots : [],
      remove: last ? plan.remove : []
    });
    result.longestCallMs = Math.max(result.longestCallMs, Date.now() - started);
    result.texts += made.texts;
    result.dots += made.dots;
    result.removed += made.removed;
    options.onProgress?.(b + 1, batches);
  }
  return result;
}
