// Which roads a route between two places needs, as the areas Overpass is asked about (DECISIONS D102).
//
// Every road near both ends, only the major roads in between: a drive across a country never asks for
// every lane of every village on the way. Ends are snapped to a grid before anything is planned, so
// two clicks a few hundred metres apart ask the same questions and find the answers already on disk.

import { distanceMeters, greatCircle } from "../geo/greatCircle.ts";
import type { LngLat } from "../geo/mercator.ts";
import { MODE_LIMIT_KM, roadModeInfo, tierClasses, type RoadMode, type RoadTier } from "./profiles.ts";

/** South, west, north, east. */
export type RoadBox = [number, number, number, number];

export type RoadAreaPart = { tier: RoadTier; classes: string[]; box?: RoadBox; polygon?: LngLat[] };

export type RoadArea = {
  /** What the area is, for the progress line: "around both ends", "around the start", "on the way", "around the end". */
  label: string;
  parts: RoadAreaPart[];
  /** The Overpass QL that asks for it. */
  query: string;
};

export type RoadPlan = { mode: RoadMode; km: number; areas: RoadArea[] };

/** Ends closer than this (km) are one area holding every road, a band along the way between them. */
export const SINGLE_AREA_KM = 5;
/** Every road this far round each end of a longer route (km, half the side of a box). */
export const END_KM = 1.5;

const KM_PER_DEGREE = 111.32;
/** The memory an area's query asks Overpass for (256 MiB). */
const MAX_QUERY_BYTES = 268435456;
/** The grid the ends are snapped to before planning: about half a kilometre. */
const END_CELL = 0.005;

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
/** Shapes are written to a thousandth of a degree (about 100 m): the ends are snapped already, so they read the same every time. */
const round3 = (value: number) => Math.round(value * 1000) / 1000;
/** How far a place may lie from the middle of its grid cell, in km. */
const slackOf = (cell: number) => (cell / 2) * KM_PER_DEGREE * 1.5;

/** The middle of the grid cell a place falls in. */
export const snapToGrid = (p: LngLat, cell: number): LngLat => ({ lat: (Math.floor(p.lat / cell) + 0.5) * cell, lng: (Math.floor(p.lng / cell) + 0.5) * cell });

/** A box round a place, `km` to each side, widened to whole thousandths of a degree. */
export function boxAround(p: LngLat, km: number): RoadBox {
  const dLat = km / KM_PER_DEGREE;
  const dLng = km / (KM_PER_DEGREE * Math.max(0.05, Math.cos((p.lat * Math.PI) / 180)));
  const down = (value: number) => Math.floor(value * 1000) / 1000;
  const up = (value: number) => Math.ceil(value * 1000) / 1000;
  return [Math.max(-85, down(p.lat - dLat)), Math.max(-180, down(p.lng - dLng)), Math.min(85, up(p.lat + dLat)), Math.min(180, up(p.lng + dLng))];
}

/** A place moved by kilometres east and north (flat over the short distances a band is wide). */
function offset(p: LngLat, east: number, north: number): LngLat {
  const lat = clamp(p.lat + north / KM_PER_DEGREE, -85, 85);
  return { lat, lng: p.lng + east / (KM_PER_DEGREE * Math.max(0.05, Math.cos((p.lat * Math.PI) / 180))) };
}

/**
 * A band `halfKm` to each side of the great circle from a to b, reaching `halfKm` past both ends, as a
 * polygon. Its corners are pushed out by half the rounding, so rounding them never narrows it.
 */
export function bandAlong(a: LngLat, b: LngLat, halfKm: number): LngLat[] {
  const km = distanceMeters(a, b) / 1000;
  const count = clamp(Math.ceil(km / 50), 2, 24) + 1;
  const line = greatCircle(a, b, count);
  const left: LngLat[] = [];
  const right: LngLat[] = [];
  for (let i = 0; i < line.length; i++) {
    const before = line[Math.max(0, i - 1)];
    const after = line[Math.min(line.length - 1, i + 1)];
    const cos = Math.cos((line[i].lat * Math.PI) / 180);
    let east = (after.lng - before.lng) * KM_PER_DEGREE * cos;
    let north = (after.lat - before.lat) * KM_PER_DEGREE;
    const length = Math.hypot(east, north) || 1;
    east /= length;
    north /= length;
    // Past the ends by as much as the band is wide.
    const reach = i === 0 ? -halfKm : i === line.length - 1 ? halfKm : 0;
    const centre = offset(line[i], east * reach, north * reach);
    const wide = halfKm + 0.08;
    left.push(offset(centre, -north * wide, east * wide));
    right.push(offset(centre, north * wide, -east * wide));
  }
  return [...left, ...right.reverse()].map((p) => ({ lat: round3(p.lat), lng: round3(p.lng) }));
}

const boxText = (box: RoadBox) => box.map((value) => String(round3(value))).join(",");
const polygonText = (polygon: LngLat[]) => `poly:"${polygon.map((p) => `${round3(p.lat)} ${round3(p.lng)}`).join(" ")}"`;

/** The Overpass QL for an area: the ways of its classes in each part, and the ferries in all of them. */
export function roadQuery(parts: RoadAreaPart[], timeout: number): string {
  const lines: string[] = [];
  const shapes = new Set<string>();
  for (const part of parts) {
    const shape = part.polygon ? polygonText(part.polygon) : boxText(part.box!);
    lines.push(`  way["highway"~"^(${part.classes.join("|")})$"](${shape});`);
    shapes.add(shape);
  }
  for (const shape of shapes) lines.push(`  way["route"="ferry"](${shape});`);
  // Half the memory Overpass grants by default, which is still several times what these answers take:
  // a busy server admits a query sooner the less it asks for.
  return [`[out:json][timeout:${timeout}][maxsize:${MAX_QUERY_BYTES}];`, "(", ...lines, ");", "out geom qt;"].join("\n");
}

const area = (label: string, parts: RoadAreaPart[], timeout: number): RoadArea => ({ label, parts, query: roadQuery(parts, timeout) });

/** Whether a band or a box would reach across the 180th meridian, which the router does not route over. */
const crossesAntimeridian = (points: LngLat[]) => points.some((p) => p.lng < -180 || p.lng > 180);

/** The areas a route from `from` to `to` needs for a mode. Throws when the ends are too far apart for it. */
export function planRoadAreas(from: LngLat, to: LngLat, mode: RoadMode): RoadPlan {
  const km = distanceMeters(from, to) / 1000;
  if (km > MODE_LIMIT_KM[mode]) throw new Error(`these places are ${Math.round(km)} km apart: a route ${roadModeInfo(mode).words} can be at most ${MODE_LIMIT_KM[mode]} km in a straight line. Draw it as an arc, or as several routes in legs`);
  if (km < 0.01) throw new Error("the two ends are the same place");
  const start = snapToGrid(from, END_CELL);
  const end = snapToGrid(to, END_CELL);
  const all = tierClasses(mode, "all");
  const slack = slackOf(END_CELL);

  if (km <= SINGLE_AREA_KM) {
    // A band along the way, a fifth of the distance to each side (at least 600 m) and as far past each end.
    const polygon = bandAlong(start, end, Math.max(0.6, km * 0.2) + slack);
    if (crossesAntimeridian(polygon)) throw new Error("a route on roads across the 180th meridian is not possible yet: draw it as an arc");
    return { mode, km, areas: [area("around both ends", [{ tier: "all", classes: all, polygon }], 60)] };
  }

  const linkKm = clamp(km * 0.05, 3, 12) + slack;
  const endArea = (p: LngLat, label: string) =>
    area(
      label,
      [
        { tier: "all", classes: all, box: boxAround(p, END_KM + slack) },
        { tier: "linking", classes: tierClasses(mode, "linking"), box: boxAround(p, linkKm) }
      ],
      60
    );
  // The band between is planned from coarser ends the longer the way: a route from the next street over
  // asks for the same band, and the band stays wide enough for where the ends really are.
  const cell = km <= 30 ? END_CELL : km <= 150 ? 0.05 : 0.1;
  const a = snapToGrid(from, cell);
  const b = snapToGrid(to, cell);
  const bandKm = distanceMeters(a, b) / 1000;
  const halfKm = clamp(Math.round(bandKm * 0.25), Math.max(2, Math.ceil(slackOf(cell) * 2)), 120);
  const tier: RoadTier = bandKm <= 80 ? "linking" : bandKm <= 500 ? "major" : "trunk";
  const polygon = bandAlong(a, b, halfKm);
  if (crossesAntimeridian(polygon)) throw new Error("a route on roads across the 180th meridian is not possible yet: draw it as an arc");
  return {
    mode,
    km,
    areas: [endArea(start, "around the start"), area("on the way", [{ tier, classes: tierClasses(mode, tier), polygon }], 90), endArea(end, "around the end")]
  };
}
