// Routes on roads (DECISIONS D102): the roads a route needs come from OpenStreetMap through Overpass,
// one request per area of core's plan, and stay on disk so the same route comes again offline:
//
//   <user data>/osm-roads/<hash>.json   the query on the first line, then Overpass's answer as it came
//
// Answers are fresh for 30 days; an older one is still used when the network fails. The folder keeps
// at most 1 GB, the oldest answers going first. Core builds the graph and finds the way.

import { planRoadAreas } from "../../core/routing/areas.ts";
import { buildRoadGraph, mergeRoadWays, roadWays, type RoadWay } from "../../core/routing/graph.ts";
import type { RoadMode } from "../../core/routing/profiles.ts";
import { routeOnRoads, type RoadRoute } from "../../core/routing/search.ts";
import type { LngLat } from "../../core/geo/mercator.ts";
import { fs, path, userDataDir } from "../cep.ts";
import { isOfflineError } from "../net.ts";
import { askOverpass, hashOf } from "./osm.ts";

/** An area's answer larger than this is refused while it arrives: the plan asks for less than that. */
export const MAX_ROAD_ANSWER_BYTES = 64 * 1048576;
const FRESH_DAYS = 30;
const MAX_FOLDER_BYTES = 1024 * 1048576;
/** Overpass may think this long over a band across a country. */
const TIMEOUT_MS = 180000;

let folderOverride: string | null = null;

/** For the in-AE test (RR1): answers kept in a folder of its own, so a run starts with nothing on disk. */
export function setRoadCacheFolder(folder: string | null): void {
  folderOverride = folder;
}

export const roadCacheFolder = () => folderOverride ?? path().join(userDataDir(), "osm-roads");

const fileOf = (query: string) => path().join(roadCacheFolder(), `${hashOf(query)}.json`);

/** The answer kept for a query, and when it was fetched; null when there is none. */
function readKept(query: string): { text: string; at: number } | null {
  const file = fileOf(query);
  try {
    const stat = fs().statSync(file);
    const text = fs().readFileSync(file, "utf8");
    const line = text.indexOf("\n");
    if (line < 0 || JSON.parse(text.slice(0, line)) !== query) return null;
    return { text: text.slice(line + 1), at: stat.mtimeMs };
  } catch {
    return null;
  }
}

function keep(query: string, text: string): void {
  try {
    const folder = roadCacheFolder();
    fs().mkdirSync(folder, { recursive: true });
    fs().writeFileSync(fileOf(query), `${JSON.stringify(query)}\n${text}`, "utf8");
    // The newest answers stay, up to the folder's size.
    const files = fs()
      .readdirSync(folder)
      .filter((name: string) => name.endsWith(".json"))
      .map((name: string) => {
        const stat = fs().statSync(path().join(folder, name));
        return { name, at: stat.mtimeMs, bytes: stat.size };
      })
      .sort((a: { at: number }, b: { at: number }) => b.at - a.at);
    let total = 0;
    for (const file of files) {
      total += file.bytes;
      if (total > MAX_FOLDER_BYTES) fs().unlinkSync(path().join(folder, file.name));
    }
  } catch {
    // A folder that cannot be written is not a reason to fail the route.
  }
}

/** An answer Overpass cut short (a timeout, too much memory) says so in its remark. */
function checkComplete(answer: unknown): void {
  const remark = (answer as { remark?: unknown } | null)?.remark;
  if (typeof remark === "string" && /error|timed out|out of memory/i.test(remark)) throw new Error(`OpenStreetMap stopped before answering: ${remark.trim()}`);
}

export type RoadRouteFound = {
  route: RoadRoute;
  /** Areas asked for, fetched now, found on disk, and found on disk though old (the network failed). */
  areas: number;
  fetched: number;
  kept: number;
  stale: number;
  /** Bytes that came over the network. */
  bytes: number;
  /** Roads in the graph the route was searched on. */
  ways: number;
};

export type RoadRouteOptions = {
  signal?: AbortSignal;
  onProgress?: (label: string, done: number, total: number) => void;
};

/** The route from one place to another on the roads a mode may use. */
export async function findRouteOnRoads(from: LngLat, to: LngLat, mode: RoadMode, options: RoadRouteOptions = {}): Promise<RoadRouteFound> {
  const plan = planRoadAreas(from, to, mode);
  const total = plan.areas.length + 1;
  const lists: RoadWay[][] = [];
  let fetched = 0;
  let kept = 0;
  let stale = 0;
  let bytes = 0;
  for (let i = 0; i < plan.areas.length; i++) {
    const area = plan.areas[i];
    options.onProgress?.(`OpenStreetMap roads ${area.label}`, i, total);
    const old = readKept(area.query);
    let answer: unknown;
    if (old && Date.now() - old.at < FRESH_DAYS * 86400000) {
      answer = JSON.parse(old.text);
      kept++;
    } else {
      try {
        const got = await askOverpass(area.query, {
          signal: options.signal,
          maxBytes: MAX_ROAD_ANSWER_BYTES,
          timeoutMs: TIMEOUT_MS,
          onBusy: (seconds) => options.onProgress?.(`OpenStreetMap is busy: asking again in ${seconds} s`, i, total)
        });
        answer = JSON.parse(got.text);
        checkComplete(answer);
        keep(area.query, got.text);
        bytes += got.bytes;
        fetched++;
      } catch (error) {
        if (error instanceof Error && error.message === "cancelled") throw error;
        if (old) {
          answer = JSON.parse(old.text);
          stale++;
        } else if (isOfflineError(error)) {
          throw new Error(`OpenStreetMap cannot be reached and the roads ${area.label} are not on this computer yet: make this route once online, and it comes again offline`);
        } else throw error;
      }
    }
    lists.push(roadWays(answer));
  }
  options.onProgress?.("Finding the way", plan.areas.length, total);
  // Let the progress line show before the search holds the panel for a moment.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const ways = mergeRoadWays(lists);
  const graph = buildRoadGraph(ways, mode);
  const route = routeOnRoads(graph, from, to);
  return { route, areas: plan.areas.length, fetched, kept, stale, bytes, ways: graph.ways.length };
}
