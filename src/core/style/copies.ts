// The user's own layer copied onto every place of a table: an icon per city, a flag per country, a
// photo per stop. Each copy may be sized by its number, and the honest way to size artwork by a
// value is by area (twice the value, twice the area), so the scale follows the square root, as a
// bubble's radius does. Core works out the factors; the panel places the copies.

export const MAX_COPIES = 200;
/** The smallest a copy may shrink to, as a share of the layer's own size, so a tiny value still shows. */
export const MIN_COPY_FACTOR = 0.2;

export type CopyPlace = { id: string; name: string; lat: number; lng: number; value: number };
export type Copy = CopyPlace & { factor: number };

export type CopyOptions = {
  /** Size each copy by its value (default); off, every copy keeps the layer's own size. */
  byValue?: boolean;
  minFactor?: number;
  /** Copies beyond this many are left out, largest first. */
  limit?: number;
};

export type CopySet = {
  copies: Copy[];
  /** The value the full-size copy stands for (0 when the copies are not sized). */
  top: number;
  dropped: number;
};

const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * The copies of a set of places. Sized by value, places with no value (or none) get no copy, since
 * a copy of no size would only be noise; not sized, every place with a position gets one.
 */
export function copyFactors(places: CopyPlace[], options: CopyOptions = {}): CopySet {
  const byValue = options.byValue ?? true;
  const min = Math.max(0.01, Math.min(1, options.minFactor ?? MIN_COPY_FACTOR));
  const limit = Math.max(1, Math.round(options.limit ?? MAX_COPIES));
  const usable = places
    .filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng) && (!byValue || (Number.isFinite(place.value) && place.value > 0)))
    .sort((a, b) => (b.value || 0) - (a.value || 0));
  const top = byValue ? (usable[0]?.value ?? 0) : 0;
  const kept = usable.slice(0, limit);
  const copies = kept.map((place) => ({ ...place, factor: byValue && top > 0 ? round(Math.max(min, Math.sqrt(place.value / top))) : 1 }));
  return { copies, top, dropped: usable.length - kept.length };
}
