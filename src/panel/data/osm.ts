// Features from OpenStreetMap through the Overpass API. The panel only goes there when the user
// asks, one request at a time and never faster than once every two seconds, and every answer is kept
// in the user data folder so the same search costs nothing twice:
//
//   <user data>/osm/<hash>.json   the raw answer, with the query it came from
//
// OpenStreetMap data is ODbL: free for commercial work, with credit. A map that uses it carries the
// "© OpenStreetMap contributors" credit, as a downloaded region already does.

import { osmFeatures, overpassQuery, type OsmBbox, type OsmFeature, type OverpassRequest } from "../../core/data/overpass.ts";
import { fs, path, userDataDir } from "../cep.ts";
import { httpsRequest } from "../net.ts";

/** The public endpoints, in the order they are tried. */
const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
/** An answer larger than this is refused: it would stall the panel and is never what a designer wants. */
export const MAX_ANSWER_BYTES = 24 * 1048576;
/** Asking about half the planet returns nothing useful and is unkind to a free service. */
export const MAX_BBOX_DEGREES = 12;
const CACHE_DAYS = 14;
const CACHE_FILES = 60;
const GAP_MS = 2000;

const folder = () => path().join(userDataDir(), "osm");

/** A short, stable name for a query. */
function hashOf(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193) >>> 0;
    b = Math.imul(b + text.charCodeAt(i) + 1, 0x85ebca6b) >>> 0;
  }
  return (a.toString(16) + b.toString(16)).padStart(16, "0");
}

const cachePath = (query: string) => path().join(folder(), `${hashOf(query)}.json`);

function readCache(query: string): unknown | null {
  const file = cachePath(query);
  try {
    const stat = fs().statSync(file);
    if (Date.now() - stat.mtimeMs > CACHE_DAYS * 86400000) return null;
    const stored = JSON.parse(fs().readFileSync(file, "utf8")) as { query?: string; answer?: unknown };
    return stored.query === query ? (stored.answer ?? null) : null;
  } catch {
    return null;
  }
}

function writeCache(query: string, answer: unknown): void {
  try {
    fs().mkdirSync(folder(), { recursive: true });
    fs().writeFileSync(cachePath(query), JSON.stringify({ query, answer }), "utf8");
    // Keep the folder small: the oldest answers go.
    const files = fs()
      .readdirSync(folder())
      .filter((name: string) => name.endsWith(".json"))
      .map((name: string) => ({ name, at: fs().statSync(path().join(folder(), name)).mtimeMs }))
      .sort((a: { at: number }, b: { at: number }) => b.at - a.at);
    for (const old of files.slice(CACHE_FILES)) fs().unlinkSync(path().join(folder(), old.name));
  } catch {
    // A cache that cannot be written is not a reason to fail the search.
  }
}

let lastRequestAt = 0;
let queue: Promise<unknown> = Promise.resolve();

/** Runs the requests one after another, never faster than the gap a free service deserves. */
function polite<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = Math.max(0, GAP_MS - (Date.now() - lastRequestAt));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      return await work();
    } finally {
      lastRequestAt = Date.now();
    }
  });
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export type OsmSearch = {
  features: OsmFeature[];
  /** Whether the answer came from the folder rather than the network. */
  cached: boolean;
  bytes: number;
  query: string;
};

/** Refuses an area too large to ask about; the message is what the panel shows. */
export function checkBbox(bbox: OsmBbox): string | null {
  const width = Math.abs(bbox[3] - bbox[1]);
  const height = Math.abs(bbox[2] - bbox[0]);
  if (width > MAX_BBOX_DEGREES || height > MAX_BBOX_DEGREES) return "Zoom in first: OpenStreetMap is asked about the area the preview shows, and this is too much of the world.";
  return null;
}

async function ask(query: string, signal?: AbortSignal): Promise<{ answer: unknown; bytes: number }> {
  let lastError: Error | null = null;
  for (const endpoint of ENDPOINTS) {
    try {
      const response = await polite(() => httpsRequest(endpoint, { method: "POST", body: `data=${encodeURIComponent(query)}`, signal }));
      if (response.status === 429 || response.status === 504) {
        lastError = new Error(`OpenStreetMap is busy (${response.status})`);
        continue;
      }
      if (response.status !== 200) throw new Error(`OpenStreetMap answered ${response.status}`);
      if (response.body.length > MAX_ANSWER_BYTES) throw new Error(`the answer is ${Math.round(response.body.length / 1048576)} MB: ask for less, or zoom in`);
      const text = new TextDecoder().decode(response.body);
      return { answer: JSON.parse(text), bytes: response.body.length };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (lastError.message === "cancelled") throw lastError;
    }
  }
  throw lastError ?? new Error("OpenStreetMap could not be reached");
}

/** What OpenStreetMap holds for this search, from the folder when it is already there. */
export async function searchOsm(request: OverpassRequest, signal?: AbortSignal): Promise<OsmSearch> {
  const refusal = checkBbox(request.bbox);
  if (refusal) throw new Error(refusal);
  const query = overpassQuery(request);
  const cached = readCache(query);
  if (cached) return { features: osmFeatures(cached), cached: true, bytes: 0, query };
  const { answer, bytes } = await ask(query, signal);
  writeCache(query, answer);
  return { features: osmFeatures(answer), cached: false, bytes, query };
}
