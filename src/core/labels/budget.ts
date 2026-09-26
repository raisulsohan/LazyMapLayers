// How many names of each kind a frame may hold. Names are chosen by priority, but a city has more
// streets and more sights than any map has room for, and a single queue fills every place with
// whichever kind happens to rank first. Kinds with a share may take at most that share of the
// names; the names of the world (countries, cities, seas, mountains) take what they need.

export type Budgeted = { id: string; priority: number; share: string | null };

/** The share of all the names each kind of city name may take. */
export const CITY_SHARES: Record<string, number> = {
  district: 0.3,
  street: 0.3,
  landmark: 0.22,
  station: 0.12,
  park: 0.12,
  campus: 0.08,
  cityWater: 0.1,
  airport: 0.06
};

/**
 * The ids to keep, best first, at most `max`: each kind within its share first, so every kind is
 * there; then, if room is left because some kinds have too few names, the best of the rest.
 */
export function chooseWithShares(items: Budgeted[], max: number, shares: Record<string, number> = CITY_SHARES): string[] {
  const ordered = [...items].sort((a, b) => a.priority - b.priority);
  const taken = new Map<string, number>();
  const out: string[] = [];
  for (const item of ordered) {
    if (out.length >= max) break;
    if (item.share && shares[item.share] !== undefined) {
      const cap = Math.max(1, Math.ceil(max * shares[item.share]));
      const already = taken.get(item.share) ?? 0;
      if (already >= cap) continue;
      taken.set(item.share, already + 1);
    }
    out.push(item.id);
  }
  if (out.length < max) {
    const chosen = new Set(out);
    for (const item of ordered) {
      if (out.length >= max) break;
      if (!chosen.has(item.id)) out.push(item.id);
    }
  }
  return out;
}
