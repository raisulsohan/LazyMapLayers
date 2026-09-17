// The recorded pace of a GPS track as animation keys: a route that draws on (and a traveller that
// moves) fast where the recording was fast and slow where it was slow, squeezed into the chosen
// frames. Long stops are shortened, so a lunch break does not freeze the animation.

import { lngLatToWorld, type LngLat, type Point } from "./mercator.ts";
import type { PreparedLine } from "./routeLine.ts";
import { cumulativeKm, simplifyCurveIndices } from "./simplify.ts";

export type TimedLine = {
  points: LngLat[];
  /** Seconds from the start at which each point was reached; never decreases. */
  times: number[];
  /** Seconds from the start at which each point was left, where the recording stood still there. */
  leaves?: number[];
};

export type PaceOptions = {
  startFrame: number;
  endFrame: number;
  /** The most keys to make (default 80): the pace curve is thinned to its turning points. */
  maxKeys?: number;
  /** A stop lasts at most this share of the time spent moving (default 0.02). Infinity keeps stops whole. */
  maxPauseShare?: number;
};

/** Below this share of the moving speed the recording counts as standing still. */
const STOPPED_SPEED_SHARE = 0.15;

/**
 * Keys as [frame, percent] for Trim Paths End and the traveller's Progress. Percent counts along the
 * prepared line as a flat map draws it, which is how Trim Paths counts in a view from straight above;
 * in tilted views the pace shifts a little, and the traveller still rides the tip of the line.
 */
export function paceKeys(line: TimedLine, prepared: PreparedLine, options: PaceOptions): [number, number][] {
  const start = options.startFrame;
  const end = Math.max(start + 1, options.endFrame);
  const even: [number, number][] = [
    [start, 0],
    [end, 100]
  ];
  const count = line.points.length;
  if (count < 2 || line.times.length !== count || prepared.points.length < 2) return even;

  // What was recorded: kilometres along the line against seconds, with a second sample where it waited.
  const along = cumulativeKm(line.points);
  const km: number[] = [];
  const seconds: number[] = [];
  for (let i = 0; i < count; i++) {
    km.push(along[i]);
    seconds.push(line.times[i]);
    const left = line.leaves?.[i];
    if (left !== undefined && left > line.times[i]) {
      km.push(along[i]);
      seconds.push(left);
    }
  }
  const totalKm = along[count - 1];
  const totalSeconds = seconds[seconds.length - 1] - seconds[0];
  if (!(totalKm > 0) || !(totalSeconds > 0)) return even;

  // Stops: stretches far slower than the pace while moving. Long ones are shortened.
  const dt: number[] = [];
  const dk: number[] = [];
  for (let i = 1; i < km.length; i++) {
    dt.push(Math.max(0, seconds[i] - seconds[i - 1]));
    dk.push(km[i] - km[i - 1]);
  }
  const overall = totalKm / totalSeconds;
  let movingKm = 0;
  let movingSeconds = 0;
  for (let i = 0; i < dt.length; i++) {
    if (dt[i] > 0 && dk[i] / dt[i] >= overall * 0.1) {
      movingKm += dk[i];
      movingSeconds += dt[i];
    }
  }
  const movingSpeed = movingSeconds > 0 ? movingKm / movingSeconds : overall;
  const stopped = dt.map((t, i) => t > 0 && dk[i] / t < movingSpeed * STOPPED_SPEED_SHARE);
  let timeMoving = 0;
  for (let i = 0; i < dt.length; i++) if (!stopped[i]) timeMoving += dt[i];
  const longest = (options.maxPauseShare ?? 0.02) * (timeMoving > 0 ? timeMoving : totalSeconds);
  for (let i = 0; i < dt.length; ) {
    if (!stopped[i]) {
      i++;
      continue;
    }
    let j = i;
    let pause = 0;
    while (j < dt.length && stopped[j]) pause += dt[j++];
    if (pause > longest) for (let k = i; k < j; k++) dt[k] *= longest / pause;
    i = j;
  }
  let playSeconds = 0;
  for (const t of dt) playSeconds += t;
  if (!(playSeconds > 0)) return even;

  // Percent along the prepared line, measured on the flat map.
  const world = prepared.points.map((p) => lngLatToWorld(p, 0));
  const run: number[] = [0];
  for (let i = 1; i < world.length; i++) run.push(run[i - 1] + Math.hypot(world[i].x - world[i - 1].x, world[i].y - world[i - 1].y));
  const length = run[run.length - 1];
  if (!(length > 0)) return even;
  const curve: Point[] = [];
  let at = 0;
  let clock = 0;
  for (let i = 0; i < km.length; i++) {
    if (i > 0) clock += dt[i - 1];
    while (at < prepared.km.length - 2 && prepared.km[at + 1] < km[i]) at++;
    const span = prepared.km[at + 1] - prepared.km[at];
    const t = span > 0 ? Math.max(0, Math.min(1, (km[i] - prepared.km[at]) / span)) : km[i] > prepared.km[at] ? 1 : 0;
    curve.push({ x: (clock / playSeconds) * 100, y: ((run[at] + (run[at + 1] - run[at]) * t) / length) * 100 });
  }
  curve[0] = { x: 0, y: 0 };
  curve[curve.length - 1] = { x: 100, y: 100 };

  // Only the turning points of the curve become keys.
  const maxKeys = Math.max(2, options.maxKeys ?? 80);
  let tolerance = 0.3;
  let kept = simplifyCurveIndices(curve, tolerance);
  for (let round = 0; round < 30 && kept.length > maxKeys; round++) {
    tolerance *= 1.5;
    kept = simplifyCurveIndices(curve, tolerance);
  }

  // Whole frames, one key per frame, never running backwards.
  const keys: [number, number][] = [];
  for (const index of kept) {
    const frame = start + Math.round((curve[index].x / 100) * (end - start));
    const value = Math.round(Math.max(keys.length ? keys[keys.length - 1][1] : 0, curve[index].y) * 1000) / 1000;
    if (keys.length && keys[keys.length - 1][0] === frame) keys[keys.length - 1][1] = value;
    else keys.push([frame, value]);
  }
  keys[0] = [start, 0];
  if (keys[keys.length - 1][0] !== end) keys.push([end, 100]);
  else keys[keys.length - 1][1] = 100;
  return keys;
}
