// Scales the sizes of a MapLibre style (text, icons, line widths, circles) by a factor.
//
// The preview draws the comp's frame scaled down to the panel, which would shrink labels and lines to
// a fraction of their size. Scaling the style's sizes up by the inverse keeps them readable while the
// framing stays exact. Works on plain values, zoom functions and expressions: zoom expressions must
// stay at the top of an interpolate or step, so their outputs are scaled instead of wrapping them.

type Value = unknown;

const SIZE_PROPERTIES: Record<string, { layout?: string[]; paint?: string[] }> = {
  symbol: { layout: ["text-size", "icon-size"], paint: ["text-halo-width", "text-halo-blur", "icon-halo-width"] },
  line: { paint: ["line-width", "line-gap-width", "line-offset", "line-blur"] },
  circle: { paint: ["circle-radius", "circle-stroke-width", "circle-blur"] }
};

function usesZoom(value: Value): boolean {
  if (!Array.isArray(value)) return false;
  if (value[0] === "zoom") return true;
  return value.some((item) => usesZoom(item));
}

/** A numeric style value multiplied by k, whatever form it has. */
export function scaleValue(value: Value, k: number): Value {
  if (typeof value === "number") return value * k;
  if (Array.isArray(value)) {
    const op = value[0];
    if (op === "interpolate" || op === "interpolate-hcl" || op === "interpolate-lab") {
      // ["interpolate", curve, input, stop, output, stop, output, ...]
      return value.map((item, i) => (i >= 4 && i % 2 === 0 ? scaleValue(item, k) : item));
    }
    if (op === "step") {
      // ["step", input, output, stop, output, ...]
      return value.map((item, i) => (i >= 2 && i % 2 === 0 ? scaleValue(item, k) : item));
    }
    if (op === "case") {
      // ["case", condition, output, ..., fallback]
      return value.map((item, i) => (i >= 1 && (i % 2 === 0 || i === value.length - 1) ? scaleValue(item, k) : item));
    }
    if (op === "match") {
      // ["match", input, label, output, ..., fallback]
      return value.map((item, i) => (i >= 2 && (i % 2 === 1 || i === value.length - 1) ? scaleValue(item, k) : item));
    }
    if (op === "coalesce") return value.map((item, i) => (i >= 1 ? scaleValue(item, k) : item));
    if (op === "literal") return value;
    // Any other numeric expression: multiply it, unless it reads the zoom (which may not be wrapped).
    return usesZoom(value) ? value : ["*", k, value];
  }
  if (value && typeof value === "object") {
    // Legacy zoom or property function: { stops: [[input, output], ...] }.
    const fn = value as { stops?: [unknown, unknown][] };
    if (Array.isArray(fn.stops)) return { ...fn, stops: fn.stops.map(([input, output]) => [input, scaleValue(output, k)]) };
  }
  return value;
}

type Layer = { type: string; layout?: Record<string, Value>; paint?: Record<string, Value> };

/** A copy of the style with every size multiplied by k (k = 1 returns the style itself). */
export function scaleStyleSizes<T extends { layers: unknown[] }>(style: T, k: number): T {
  if (!(k > 0) || Math.abs(k - 1) < 1e-3) return style;
  const layers = (style.layers as Layer[]).map((layer) => {
    const spec = SIZE_PROPERTIES[layer.type];
    if (!spec) return layer;
    const next: Layer = { ...layer };
    for (const bag of ["layout", "paint"] as const) {
      const names = spec[bag];
      const values = layer[bag];
      if (!names || !values) continue;
      const scaled: Record<string, Value> = { ...values };
      for (const name of names) if (name in values) scaled[name] = scaleValue(values[name], k);
      next[bag] = scaled;
    }
    // A line without a width is 1 pixel wide; a symbol without a size is 16.
    if (layer.type === "line" && !(layer.paint && "line-width" in layer.paint)) next.paint = { ...(next.paint ?? {}), "line-width": k };
    if (layer.type === "symbol" && layer.layout && "text-field" in layer.layout && !("text-size" in layer.layout)) next.layout = { ...(next.layout ?? {}), "text-size": 16 * k };
    return next;
  });
  return { ...style, layers };
}
