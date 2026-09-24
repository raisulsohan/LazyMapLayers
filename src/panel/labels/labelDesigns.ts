// Labels designed by the user: any comp in the project whose text layers carry {fields} can be put
// on every place instead of a plain name. The panel lists the comps, works out what each place is
// worth filling in, and Auto labels asks the host for a copy per place.

import { formatShort } from "../../core/style/valueScale.ts";
import type { PlaceRecord } from "../../core/search/placeSearch.ts";
import { callHost } from "../cep.ts";
import { countryCodeRows } from "../data/countries.ts";

export type LabelDesign = {
  compId: number;
  name: string;
  width: number;
  height: number;
  /** Where the place sits inside the comp: the "Anchor" layer, or the comp's centre. */
  anchorX: number;
  anchorY: number;
  /** The fields its text layers ask for, as written between braces. */
  fields: string[];
};

/** Every comp of the user's own that a label can be made from. */
export const labelDesigns = () => callHost<LabelDesign[]>("listLabelDesigns");

/** What a design's fields are filled with for one place. */
export function designValues(record: PlaceRecord, text: string, subtitle: string | null): Record<string, string> {
  const country = countryCodeRows().find((row) => row.code === record.country);
  return {
    name: text,
    english: record.names.en ?? text,
    subtitle: subtitle ?? "",
    country: record.country,
    countryName: country?.names[0] ?? record.country,
    region: record.region ?? "",
    population: record.population ? record.population.toLocaleString("en-US") : "",
    populationShort: record.population ? formatShort(record.population) : "",
    capital: record.capital ? "Capital" : "",
    kind: record.kind,
    lat: record.lat.toFixed(4),
    lng: record.lng.toFixed(4)
  };
}

/** The fields the panel can fill, for the sheet to show. */
export const DESIGN_FIELDS = ["name", "english", "subtitle", "country", "countryName", "region", "population", "populationShort", "capital", "kind", "lat", "lng"];
