// A map whose camera follows another map in the same comp: its camera controls read the leader's,
// through a Layer Control named "Follows" (hard rule 4: no layer names in expressions). The zoom
// can sit a set number of steps out or in, for an overview beside a close-up; the turn and the tilt
// follow only when asked, so a flat overview can stay flat under a tilted leader.
//
// ES3, like every generated expression (DECISIONS D14).

export const FOLLOW_MARKER = "// LazyMapLayers follow";
export const FOLLOWS_EFFECT = "Follows";
export const FOLLOW_ZOOM_EFFECT = "Follow Zoom Offset";

/** The camera controls a follower can take from its leader (the names of LML.map.CONTROLS). */
export type FollowedControl = "Latitude" | "Longitude" | "Zoom" | "Bearing" | "Pitch";

export type FollowOptions = { zoomOffset: number; bearing: boolean; pitch: boolean };

export const DEFAULT_FOLLOW: FollowOptions = { zoomOffset: 0, bearing: true, pitch: true };

/** The expression a follower's control gets, or null for a control it keeps to itself. */
export function followExpression(control: FollowedControl, options: FollowOptions): string | null {
  if (control === "Bearing" && !options.bearing) return null;
  if (control === "Pitch" && !options.pitch) return null;
  const read = `effect("${FOLLOWS_EFFECT}")(1).effect("${control}")(1).value`;
  if (control === "Zoom") return `${FOLLOW_MARKER} (generated)\n${read} + effect("${FOLLOW_ZOOM_EFFECT}")(1).value;`;
  return `${FOLLOW_MARKER} (generated)\n${read};`;
}

/** Every control's expression, in the order of LML.map.CONTROLS; null where the follower keeps its own. */
export function followExpressions(options: FollowOptions): Record<FollowedControl, string | null> {
  const controls: FollowedControl[] = ["Latitude", "Longitude", "Zoom", "Bearing", "Pitch"];
  return Object.fromEntries(controls.map((c) => [c, followExpression(c, options)])) as Record<FollowedControl, string | null>;
}

/** A follow setting as it is kept on the map layer, with anything missing or out of range put right. */
export function normaliseFollow(value: unknown): (FollowOptions & { mapId: string }) | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.mapId !== "string" || !v.mapId) return null;
  const offset = Number(v.zoomOffset);
  return {
    mapId: v.mapId,
    zoomOffset: Number.isFinite(offset) ? Math.max(-12, Math.min(12, Math.round(offset * 100) / 100)) : 0,
    bearing: v.bearing !== false,
    pitch: v.pitch !== false
  };
}
