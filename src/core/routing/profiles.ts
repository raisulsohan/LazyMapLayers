// What each way of travelling may use of OpenStreetMap's roads, which way and how fast (DECISIONS D102).
//
// A way's tags decide it: its class (`highway`, or a ferry), the access tags read from the most specific
// to the most general for the mode, one-way tags with what they imply, a signed speed limit and the
// surface. Speeds are rough travel speeds by road class, not limits: they choose between roads and give
// the time a route takes, the way a designer would estimate it.

export type RoadMode = "car" | "bicycle" | "foot";

export type RoadModeInfo = { id: RoadMode; name: string; words: string };

export const ROAD_MODES: RoadModeInfo[] = [
  { id: "car", name: "Car", words: "by car" },
  { id: "bicycle", name: "Bicycle", words: "by bicycle" },
  { id: "foot", name: "On foot", words: "on foot" }
];

export const roadModeInfo = (mode: RoadMode): RoadModeInfo => ROAD_MODES.find((info) => info.id === mode) ?? ROAD_MODES[0];

/** How far apart (straight) the ends of one route may be for each mode, in km. */
export const MODE_LIMIT_KM: Record<RoadMode, number> = { car: 1500, bicycle: 400, foot: 60 };

export type Tags = Record<string, string>;

/** km/h on each class of road. A class missing from a mode's table is never used by it. */
const SPEEDS: Record<RoadMode, Record<string, number>> = {
  car: {
    motorway: 100,
    motorway_link: 60,
    trunk: 80,
    trunk_link: 50,
    primary: 65,
    primary_link: 45,
    secondary: 55,
    secondary_link: 40,
    tertiary: 45,
    tertiary_link: 35,
    unclassified: 35,
    residential: 25,
    living_street: 10,
    service: 15,
    road: 25,
    track: 15,
    ferry: 20
  },
  bicycle: {
    trunk: 18,
    trunk_link: 18,
    primary: 18,
    primary_link: 18,
    secondary: 18,
    secondary_link: 18,
    tertiary: 18,
    tertiary_link: 18,
    unclassified: 17,
    residential: 16,
    living_street: 12,
    service: 14,
    road: 15,
    track: 12,
    path: 13,
    cycleway: 18,
    footway: 10,
    pedestrian: 10,
    bridleway: 10,
    ferry: 20
  },
  foot: {
    trunk: 5,
    trunk_link: 5,
    primary: 5,
    primary_link: 5,
    secondary: 5,
    secondary_link: 5,
    tertiary: 5,
    tertiary_link: 5,
    unclassified: 5,
    residential: 5,
    living_street: 5,
    service: 5,
    road: 5,
    track: 5,
    path: 5,
    cycleway: 5,
    footway: 5,
    pedestrian: 5,
    bridleway: 5,
    steps: 3,
    ferry: 20
  }
};

/** Classes a mode may use only where its own tag opens them (a track for a car, a footway for a bicycle). */
const ONLY_WHEN_OPEN: Record<RoadMode, string[]> = { car: ["track"], bicycle: ["footway", "pedestrian", "bridleway"], foot: [] };

/** Busy roads cost more than their time for a bicycle and a walker: quieter ways win when they are close. */
const PREFERENCE: Record<RoadMode, Record<string, number>> = {
  car: {},
  bicycle: { trunk: 1.6, trunk_link: 1.6, primary: 1.3, primary_link: 1.3, secondary: 1.1, secondary_link: 1.1 },
  foot: { trunk: 1.4, trunk_link: 1.4, primary: 1.2, primary_link: 1.2, secondary: 1.1, secondary_link: 1.1 }
};

/** Access tags from the most specific to the most general, per mode. */
const ACCESS_KEYS: Record<RoadMode, string[]> = {
  car: ["motorcar", "motor_vehicle", "vehicle", "access"],
  bicycle: ["bicycle", "vehicle", "access"],
  foot: ["foot", "access"]
};

const OPEN = ["yes", "permissive", "designated", "official", "public"];
const CLOSED = ["no", "private", "agricultural", "forestry", "military", "emergency", "restricted", "permit"];
const COSTLY = ["destination", "delivery", "customers", "discouraged"];
const UNPAVED = ["unpaved", "dirt", "earth", "ground", "gravel", "fine_gravel", "sand", "mud", "grass", "pebblestone", "rock"];

/** A ferry boards in about a quarter of an hour. */
export const FERRY_BOARD_SECONDS = 900;

const first = (value: string | undefined) => (value === undefined ? undefined : value.split(";")[0].trim().toLowerCase());

/** The class of road a way is ("primary", "footway", "ferry"), or null when it is not one. */
export function roadClass(tags: Tags): string | null {
  if (tags.highway) return tags.highway;
  if (tags.route === "ferry") return "ferry";
  return null;
}

/**
 * What the access tags say for a mode: open, closed, open at a cost, open but with a path of its own
 * alongside (the path wins where it was asked for too, the road carries the route where it was not),
 * or nothing (the class decides).
 */
export function accessFor(tags: Tags, mode: RoadMode): "open" | "closed" | "costly" | "sidepath" | "default" {
  for (const key of ACCESS_KEYS[mode]) {
    const value = first(tags[key]);
    if (value === undefined) continue;
    if (OPEN.includes(value)) return "open";
    if (CLOSED.includes(value)) return "closed";
    if (COSTLY.includes(value)) return "costly";
    if (value === "use_sidepath") return "sidepath";
    // Anything else (a vehicle type, an opening time) says nothing about this mode: read further.
  }
  return "default";
}

/** Which way a mode may travel along a way: 1 with its points, -1 against them, 0 both, null neither. */
export function onewayFor(tags: Tags, mode: RoadMode): 1 | -1 | 0 | null {
  if (mode === "foot") {
    const value = first(tags["oneway:foot"]);
    return value === "yes" || value === "1" || value === "true" ? 1 : value === "-1" ? -1 : 0;
  }
  const keys = mode === "car" ? ["oneway:motorcar", "oneway:motor_vehicle", "oneway:vehicle", "oneway"] : ["oneway:bicycle", "oneway"];
  let value: string | undefined;
  let own = false;
  for (const key of keys) {
    value = first(tags[key]);
    if (value !== undefined) {
      own = key !== "oneway";
      break;
    }
  }
  if (value === "reversible" || value === "alternating") return null;
  if (value === "no" || value === "0" || value === "false") return 0;
  const contraflow = mode === "bicycle" && !own && ["cycleway", "cycleway:left", "cycleway:right", "cycleway:both"].some((key) => (first(tags[key]) ?? "").startsWith("opposite"));
  if (value === "-1" || value === "reverse") return contraflow ? 0 : -1;
  if (value === "yes" || value === "1" || value === "true") return contraflow ? 0 : 1;
  // Nothing said: a roundabout goes one way, and so does a motorway (for those allowed on it).
  const junction = first(tags.junction);
  if (junction === "roundabout" || junction === "circular") return 1;
  if (tags.highway === "motorway") return 1;
  return 0;
}

/** A signed limit in km/h; Infinity for "none", null when the tag says nothing we can read. */
export function maxspeedKmh(value: string | undefined): number | null {
  const text = first(value);
  if (!text) return null;
  if (text === "none") return Infinity;
  if (text === "walk") return 6;
  const match = /^(\d+(?:\.\d+)?)\s*(mph|knots)?$/.exec(text);
  if (!match) return null;
  const number = Number(match[1]);
  if (!(number > 0)) return null;
  return match[2] === "mph" ? number * 1.609344 : match[2] === "knots" ? number * 1.852 : number;
}

export type WayUse = {
  /** May travel along the way's points, and against them. */
  forward: boolean;
  backward: boolean;
  /** Travel speed. */
  kmh: number;
  /** The cost is the time times this (1 or more): busy roads, roads open only to some. */
  factor: number;
  /** Seconds added to every crossing (boarding a ferry). */
  board: number;
};

/** How a mode may use a way, or null when it may not. */
export function wayUse(tags: Tags, mode: RoadMode): WayUse | null {
  const kind = roadClass(tags);
  if (!kind) return null;
  const base = SPEEDS[mode][kind];
  if (base === undefined) return null;
  // A pedestrian square drawn as an area is walked round, never driven or ridden.
  if (mode !== "foot" && tags.area === "yes" && kind !== "ferry") return null;
  let access = accessFor(tags, mode);
  if (access === "default" && mode !== "car" && first(tags.motorroad) === "yes") access = "closed";
  if (access === "closed") return null;
  if (access === "default" && ONLY_WHEN_OPEN[mode].includes(kind)) return null;
  const oneway = onewayFor(tags, mode);
  if (oneway === null) return null;

  let kmh = base;
  if (mode === "car" && kind !== "ferry") {
    const limit = maxspeedKmh(tags.maxspeed);
    if (limit === Infinity) kmh = base * 1.3;
    else if (limit !== null) kmh = Math.min(base * 1.3, limit * 0.85);
  }
  const surface = first(tags.surface);
  if (surface && UNPAVED.includes(surface)) kmh *= mode === "car" ? 0.6 : mode === "bicycle" ? 0.7 : 1;
  kmh = Math.max(2, Math.min(130, kmh));

  let factor = PREFERENCE[mode][kind] ?? 1;
  if (access === "costly") factor *= 3;
  if (access === "sidepath") factor *= 1.5;
  const service = first(tags.service);
  if (mode === "car" && (service === "parking_aisle" || service === "driveway" || service === "drive-through")) factor *= 2;
  return { forward: oneway !== -1, backward: oneway !== 1, kmh, factor, board: kind === "ferry" ? FERRY_BOARD_SECONDS : 0 };
}

/** Which roads an area is asked for: every road of the mode, the roads that link a place to the major ones, the major roads, the fastest only. */
export type RoadTier = "all" | "linking" | "major" | "trunk";

const MAJOR_CAR = ["motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link"];
const LINKING_CAR = [...MAJOR_CAR, "secondary", "secondary_link", "tertiary", "tertiary_link"];
const LINKING_BICYCLE = ["trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified", "cycleway"];
const MAJOR_BICYCLE = ["trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link", "cycleway"];
const LINKING_FOOT = ["trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified", "track", "pedestrian"];

/** The `highway` values an area of a tier is asked for (ferries are asked for beside them). */
export function tierClasses(mode: RoadMode, tier: RoadTier): string[] {
  if (tier === "all") return Object.keys(SPEEDS[mode]).filter((kind) => kind !== "ferry");
  if (mode === "car") return tier === "linking" ? LINKING_CAR : tier === "major" ? MAJOR_CAR : ["motorway", "motorway_link", "trunk", "trunk_link"];
  if (mode === "bicycle") return tier === "linking" ? LINKING_BICYCLE : MAJOR_BICYCLE;
  return LINKING_FOOT;
}
