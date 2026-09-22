// The user's own layer copied onto every place of a table, each copy sized by its number and wired
// to its place like an attached layer: an icon per city, a flag per country, a photo per stop. Core
// works out the sizes (core/style/copies.ts); the host duplicates the selected layer and wires the
// copies; the original is left as it is.

import { pinExpressions } from "../../core/ae/pinExpressions.ts";
import { copyFactors, type CopyOptions, type CopyPlace, type CopySet } from "../../core/style/copies.ts";
import type { TerrainSetting } from "../../core/style/terrain.ts";
import { callHostWithJobFile } from "../cep.ts";
import { samplerFor } from "../elevation.ts";

export type CopyStyle = {
  terrain?: TerrainSetting | null;
  scaleWithMap?: boolean;
  rotateWithMap?: boolean;
};

export type CopyResult = { template: string; layers: string[]; expressionErrors: string[]; set: CopySet };

/** Copies the layer selected in After Effects onto every place. `places` says where each value sits. */
export async function copyToPlaces(mapId: string, places: CopyPlace[], options: CopyOptions & CopyStyle = {}): Promise<CopyResult> {
  const set = copyFactors(places, options);
  const sampler = samplerFor(options.terrain ?? null);
  let ground: number[];
  try {
    ground = sampler ? await sampler.elevations(set.copies) : set.copies.map(() => 0);
  } finally {
    sampler?.close();
  }
  const made = await callHostWithJobFile<Omit<CopyResult, "set">>("copyToPlaces", {
    mapId,
    scaleWithMap: options.scaleWithMap ?? false,
    rotateWithMap: options.rotateWithMap ?? false,
    places: set.copies.map((copy, i) => ({
      name: copy.name,
      lat: copy.lat,
      lng: copy.lng,
      elevation: options.terrain ? ground[i] : 0,
      factor: copy.factor,
      expressions: pinExpressions(copy.lat, copy.lng)
    }))
  });
  return { ...made, set };
}
