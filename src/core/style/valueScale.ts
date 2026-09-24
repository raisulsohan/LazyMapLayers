// Numbers turned into colours: the ramps a map may use, the breaks between them, and the legend
// that says what each step means. Used by the data fill (a choropleth) and by anything later that
// colours by a value.

export type RampId = "blues" | "warm" | "teal" | "purple" | "divergent";

export type Ramp = { id: RampId; name: string; stops: string[]; diverging?: boolean };

/**
 * Three stops each, interpolated to as many steps as the map asks for. Chosen to stay readable when
 * printed in grey and to keep their order for the common kinds of colour blindness.
 */
export const RAMPS: Ramp[] = [
  { id: "blues", name: "Blues", stops: ["#e7f0fa", "#5b9bd5", "#0b2f5e"] },
  { id: "warm", name: "Warm", stops: ["#fff1d0", "#f0902f", "#7a2503"] },
  { id: "teal", name: "Teal", stops: ["#e6f5f1", "#3aa793", "#0a4238"] },
  { id: "purple", name: "Purple", stops: ["#f2eafa", "#8d62c9", "#35145e"] },
  { id: "divergent", name: "Red to blue", stops: ["#a72b35", "#f3f0ea", "#1f5fa6"], diverging: true }
];

export const rampById = (id: RampId | string | null | undefined): Ramp => RAMPS.find((ramp) => ramp.id === id) ?? RAMPS[0];

export const MIN_STEPS = 3;
export const MAX_STEPS = 9;

export type ScaleMethod = "equal" | "quantile";

export type Scale = {
  /** The value each step starts at; the first is the smallest value in the data. */
  breaks: number[];
  colors: string[];
  min: number;
  max: number;
  method: ScaleMethod;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const hexToRgb = (hex: string): number[] => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
const rgbToHex = (rgb: number[]) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;

/** A colour along a ramp, 0 at its first stop and 1 at its last. */
export function rampColor(ramp: Ramp, at: number): string {
  const stops = ramp.stops.map(hexToRgb);
  const position = clamp01(at) * (stops.length - 1);
  const first = Math.min(stops.length - 2, Math.floor(position));
  const mix = position - first;
  return rgbToHex(stops[first].map((value, channel) => value + (stops[first + 1][channel] - value) * mix));
}

/** The colours of a ramp in `steps` even steps. */
export const rampColors = (ramp: Ramp, steps: number): string[] => Array.from({ length: Math.max(1, steps) }, (_, i) => rampColor(ramp, steps === 1 ? 0.5 : i / (steps - 1)));

/**
 * Where the steps begin. "equal" splits the range into even slices, which keeps the picture honest
 * about distance; "quantile" gives every step about as many countries, which shows the order when a
 * few large values would otherwise flatten everything else.
 */
export function buildScale(values: number[], options: { ramp?: RampId; steps?: number; method?: ScaleMethod } = {}): Scale {
  const usable = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const ramp = rampById(options.ramp);
  const method: ScaleMethod = options.method === "quantile" ? "quantile" : "equal";
  const steps = Math.max(MIN_STEPS, Math.min(MAX_STEPS, Math.round(options.steps ?? 5)));
  if (!usable.length) return { breaks: [], colors: [], min: 0, max: 0, method };
  const min = usable[0];
  const max = usable[usable.length - 1];
  const colors = rampColors(ramp, steps);
  if (min === max) return { breaks: [min], colors: [colors[colors.length - 1]], min, max, method };
  const breaks: number[] = [min];
  for (let step = 1; step < steps; step++) {
    if (method === "quantile") {
      const at = (step / steps) * (usable.length - 1);
      const below = Math.floor(at);
      const value = usable[below] + (usable[Math.min(usable.length - 1, below + 1)] - usable[below]) * (at - below);
      breaks.push(value);
    } else {
      breaks.push(min + ((max - min) * step) / steps);
    }
  }
  // Steps that fall on the same value carry no meaning of their own.
  const unique: number[] = [];
  const kept: string[] = [];
  breaks.forEach((value, index) => {
    if (!unique.length || value > unique[unique.length - 1]) {
      unique.push(value);
      kept.push(colors[index]);
    } else {
      kept[kept.length - 1] = colors[index];
    }
  });
  return { breaks: unique, colors: kept, min, max, method };
}

/** The colour of one value: the step it falls in. */
export function colorForValue(value: number, scale: Scale): string | null {
  if (!Number.isFinite(value) || !scale.breaks.length) return null;
  let at = 0;
  for (let step = 1; step < scale.breaks.length; step++) if (value >= scale.breaks[step]) at = step;
  return scale.colors[at] ?? null;
}

/** A number as a designer would write it: thousands apart, and only the decimals that matter. */
export function formatValue(value: number): string {
  if (!Number.isFinite(value)) return "";
  const size = Math.abs(value);
  const decimals = size >= 100 ? 0 : size >= 10 ? 1 : size >= 1 ? 2 : 3;
  const rounded = Number(value.toFixed(decimals));
  const [whole, fraction] = Math.abs(rounded).toFixed(decimals).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${rounded < 0 ? "-" : ""}${grouped}${fraction ? `.${fraction.replace(/0+$/, "")}`.replace(/\.$/, "") : ""}`;
}

export type LegendStep = { color: string; from: number; to: number; label: string };

/** What the legend shows: one row per step, with the range it stands for. */
export function legendSteps(scale: Scale): LegendStep[] {
  return scale.breaks.map((from, index) => {
    const to = index + 1 < scale.breaks.length ? scale.breaks[index + 1] : scale.max;
    return { color: scale.colors[index], from, to, label: `${formatValue(from)} - ${formatValue(to)}` };
  });
}

/**
 * A number in as few characters as a label can spare: 940, 8.9K, 14.8M, 1.4B. Whole thousands keep
 * no decimal ("2M", not "2.0M"), so a label never carries a digit that says nothing.
 */
export function formatShort(value: number): string {
  if (!Number.isFinite(value)) return "";
  const size = Math.abs(value);
  const units: [number, string][] = [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"]
  ];
  for (const [scale, suffix] of units) {
    if (size < scale) continue;
    const short = value / scale;
    const decimals = Math.abs(short) >= 100 ? 0 : 1;
    return `${Number(short.toFixed(decimals))}${suffix}`;
  }
  return String(Math.round(value));
}
