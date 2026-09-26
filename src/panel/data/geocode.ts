// The online search, run the way Nominatim's usage policy asks: only when the user asks, one request
// a second at most, a User-Agent that names the panel and where it lives, and every answer kept on
// disk, so the same search is answered from the computer the next time (core/search/geocode.ts).

import { nominatimResults, nominatimUrl } from "../../core/search/geocode.ts";
import type { SearchResult } from "../../core/search/placeSearch.ts";
import { fs, path, userDataDir } from "../cep.ts";
import { httpsRequest } from "../net.ts";

const GAP_MS = 1100;
let lastRequestAt = 0;
let queue: Promise<unknown> = Promise.resolve();

const folder = () => path().join(userDataDir(), "geocode");

function hashOf(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36);
}

/** The panel, as Nominatim asks to be told who is calling. */
export const geocodeUserAgent = (version: string) => `LazyMapLayers/${version || "dev"} (After Effects extension; https://github.com/raisulsohan/LazyMapLayers)`;

export type GeocodeAnswer = { results: SearchResult[]; cached: boolean };

/** Searches OpenStreetMap for `query`, from the disk when it has been asked before. */
export async function searchOnline(query: string, options: { language?: string; near?: { west: number; south: number; east: number; north: number } | null; version: string }): Promise<GeocodeAnswer> {
  const url = nominatimUrl(query, { language: options.language, near: options.near ?? null });
  const file = path().join(folder(), `${hashOf(url)}.json`);
  try {
    const kept = JSON.parse(fs().readFileSync(file, "utf8")) as { url: string; answer: unknown };
    if (kept.url === url) return { results: nominatimResults(kept.answer), cached: true };
  } catch {
    // Not asked before.
  }
  // One at a time, a little over a second apart.
  const run = queue.then(async () => {
    const wait = Math.max(0, GAP_MS - (Date.now() - lastRequestAt));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      return await httpsRequest(url, { headers: { "user-agent": geocodeUserAgent(options.version), accept: "application/json" } });
    } finally {
      lastRequestAt = Date.now();
    }
  });
  queue = run.catch(() => undefined);
  const response = await run;
  if (response.status !== 200) throw new Error(`the OpenStreetMap search answered ${response.status}`);
  const answer = JSON.parse(new TextDecoder().decode(response.body));
  try {
    fs().mkdirSync(folder(), { recursive: true });
    fs().writeFileSync(file, JSON.stringify({ url, answer }), "utf8");
  } catch {
    // A cache that cannot be written is not a reason to fail the search.
  }
  return { results: nominatimResults(answer), cached: false };
}
