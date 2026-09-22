// The numbers themselves on the map: one text layer per place, linked to it like a label, saying
// what the colour or the circle is worth. They are built by the same host builder as the auto
// labels, under a kind of their own, so running Auto labels never touches them and the other way
// round.

import { anchoredPositionExpression } from "../../core/ae/labelExpressions.ts";
import { scriptOf, SCRIPT_FONTS } from "../../core/labels/language.ts";
import { resolveLabelTemplate, templateFonts, type LabelTemplate } from "../../core/labels/labelTemplate.ts";
import { bubbleSet, type BubbleOptions, type BubblePlace } from "../../core/style/bubbles.ts";
import type { DataFill } from "../../core/style/dataFill.ts";
import { hexToRgb, themeById } from "../../core/style/themes.ts";
import { formatValue } from "../../core/style/valueScale.ts";
import { callHost, callHostWithJobFile } from "../cep.ts";

type Info = { width: number; height: number; frameRate: number };

export const VALUE_KIND = "value";
/** Built in the same small batches as the auto labels, so After Effects is never blocked for long. */
const BATCH = 8;

export type ValueLabelOptions = BubbleOptions & {
  theme?: string | null;
  template?: LabelTemplate | null;
  /** Put the name of the place above the number. */
  withNames?: boolean;
  /** Push the text below a bubble of the same value, instead of sitting on the place. */
  belowBubbles?: boolean;
  /** Most labels to write (largest values first). */
  limit?: number;
};

export type ValueLabelResult = { labels: number; layers: number; removed: number; expressionErrors: string[]; dropped: number };

/** Writes the value of every place onto the map. */
export async function addValueLabels(mapId: string, fill: DataFill, places: BubblePlace[], options: ValueLabelOptions = {}): Promise<ValueLabelResult> {
  const info = await callHost<Info>("renderInfo", { mapId });
  const scale = info.height / 1080;
  const theme = themeById(options.theme);
  const template = options.template ?? resolveLabelTemplate(theme);
  const set = bubbleSet(places, { ...options, height: info.height, limit: options.limit ?? 60 });
  const radius = new Map(set.bubbles.map((bubble) => [bubble.id, bubble.radius]));
  const size = Math.round(template.size * scale);
  const specs = set.bubbles.map((place) => {
    const text = formatValue(place.value);
    const script = scriptOf(options.withNames ? place.name : text);
    const style = {
      size,
      color: hexToRgb(template.color),
      haloColor: hexToRgb(template.haloColor),
      haloWidth: template.halo > 0 ? Math.max(1, Math.round(template.halo * scale)) : 0,
      fonts: templateFonts(template, SCRIPT_FONTS[script].bold, script),
      tracking: 0,
      rtl: false
    };
    // Under the circle when there is one, so the number never sits on top of what it measures.
    const dy = (options.belowBubbles === false ? 0 : (radius.get(place.id) ?? 0) + size * 0.9) + size * 0.35;
    return {
      id: `${VALUE_KIND}:${place.id}`,
      name: `${place.name} ${text}`,
      text: options.withNames ? `${place.name}\n${text}` : text,
      subtitle: null,
      keys: [[0, 100]],
      dot: false,
      main: style,
      expressions: { main: anchoredPositionExpression(place.lat, place.lng, 0, dy) }
    };
  });

  const total: ValueLabelResult = { labels: 0, layers: 0, removed: 0, expressionErrors: [], dropped: set.dropped };
  const batches = Math.max(1, Math.ceil(specs.length / BATCH));
  for (let batch = 0; batch < batches; batch++) {
    const part = await callHostWithJobFile<{ labels: number; layers: number; removed: number; expressionErrors: string[] }>("addLabels", {
      mapId,
      kind: VALUE_KIND,
      prefix: "Value",
      labels: specs.slice(batch * BATCH, (batch + 1) * BATCH),
      first: batch === 0,
      last: batch === batches - 1,
      undoName: batches > 1 ? `Values on the map (${batch + 1} of ${batches})` : "Values on the map"
    });
    total.labels += part.labels;
    total.layers += part.layers;
    total.removed += part.removed;
    total.expressionErrors.push(...part.expressionErrors);
  }
  if (!specs.length) await callHost("removeValueLabels", { mapId });
  return total;
}

export const removeValueLabels = (mapId: string) => callHost<{ removed: number }>("removeValueLabels", { mapId });
