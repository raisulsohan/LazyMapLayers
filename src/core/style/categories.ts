// A map coloured by what a place is, not by how much: a party, an alliance, a region, a yes or a no.
// Every category gets a colour of its own from a palette whose colours stay apart for the common
// kinds of colour blindness, the most common category first, and the legend names each one.

import type { LegendStep } from "./valueScale.ts";

export type CategoryPaletteId = "safe" | "bold" | "soft";

export type CategoryPalette = { id: CategoryPaletteId; name: string; colours: string[] };

/**
 * "Safe" is Okabe and Ito's set for colour-blind readers (its black swapped for a grey that sits on
 * any map). "Bold" and "Soft" are brighter and paler sets for when the categories matter less than
 * the look.
 */
export const CATEGORY_PALETTES: CategoryPalette[] = [
  { id: "safe", name: "Colour-blind safe", colours: ["#e69f00", "#56b4e9", "#009e73", "#f0e442", "#0072b2", "#d55e00", "#cc79a7", "#8c8c8c"] },
  { id: "bold", name: "Bold", colours: ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#46c7c7", "#f032e6", "#bcf60c", "#fabebe", "#008080", "#9a6324", "#800000"] },
  { id: "soft", name: "Soft", colours: ["#8dd3c7", "#bebada", "#fb8072", "#80b1d3", "#fdb462", "#b3de69", "#fccde5", "#d9d9d9", "#bc80bd", "#ccebc5"] }
];

export const categoryPaletteById = (id: unknown): CategoryPalette => CATEGORY_PALETTES.find((p) => p.id === id) ?? CATEGORY_PALETTES[0];

/** What is left once every colour of the palette is taken: one quiet colour for all the rest. */
export const OTHER_COLOUR = "#b8b8b8";
export const OTHER_LABEL = "Other";

export type CategoryColours = {
  /** The colour of every place that has a category. */
  colors: Record<string, string>;
  /** The categories in the order they are coloured and listed: the most places first. */
  order: string[];
  /** One row per category (and one for the rest, when there are more categories than colours). */
  legend: LegendStep[];
};

/**
 * The colour of each place from its category. Categories are compared as written, spaces trimmed;
 * `overrides` gives a category a colour of the user's choosing.
 */
export function categoryColours(categories: Record<string, string>, paletteId: CategoryPaletteId, overrides: Record<string, string> = {}): CategoryColours {
  const palette = categoryPaletteById(paletteId).colours;
  const counts = new Map<string, number>();
  for (const value of Object.values(categories)) {
    const category = value.trim();
    if (category) counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const order = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([category]) => category);
  const colourOf = new Map<string, string>();
  order.forEach((category, index) => colourOf.set(category, /^#[0-9a-f]{6}$/i.test(overrides[category] ?? "") ? overrides[category].toLowerCase() : index < palette.length ? palette[index] : OTHER_COLOUR));
  const colors: Record<string, string> = {};
  for (const [code, value] of Object.entries(categories)) {
    const colour = colourOf.get(value.trim());
    if (colour) colors[code] = colour;
  }
  const named = order.filter((category) => colourOf.get(category) !== OTHER_COLOUR || overrides[category]);
  const rest = order.length - named.length;
  const legend: LegendStep[] = named.map((category) => ({ color: colourOf.get(category)!, from: counts.get(category)!, to: counts.get(category)!, label: category }));
  if (rest > 0) legend.push({ color: OTHER_COLOUR, from: rest, to: rest, label: `${OTHER_LABEL} (${rest})` });
  return { colors, order, legend };
}
