// GC1 (online, only when named): searching OpenStreetMap from the panel.
//
// Two searches, a second apart as Nominatim asks: a street in Paris and a square in Dhaka. Each
// finds its place where it is, and asked again it comes from the disk without going online.

import { searchOnline } from "./data/geocode.ts";
import { panelVersion } from "./store.ts";
import type { SpikeLog } from "./spikes.ts";

export async function runGeocodeTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const check = (ok: boolean, problem: string) => {
    if (!ok) problems.push(problem);
  };
  const started = Date.now();
  const paris = await searchOnline("Rue de Rivoli, Paris", { version: panelVersion.value || "test" });
  const rivoli = paris.results[0];
  check(!!rivoli && rivoli.lat > 48.8 && rivoli.lat < 48.9 && rivoli.lng > 2.25 && rivoli.lng < 2.42, `Rue de Rivoli is at ${rivoli ? `${rivoli.lat}, ${rivoli.lng}` : "nowhere"}`);
  const dhaka = await searchOnline("Gulshan 2, Dhaka", { version: panelVersion.value || "test" });
  const gulshan = dhaka.results[0];
  check(!!gulshan && gulshan.lat > 23.7 && gulshan.lat < 23.85 && gulshan.lng > 90.35 && gulshan.lng < 90.5, `Gulshan is at ${gulshan ? `${gulshan.lat}, ${gulshan.lng}` : "nowhere"}`);
  const gap = Date.now() - started;
  // A second apart, when both went online (a run before may have kept them).
  if (!paris.cached && !dhaka.cached) check(gap >= 1000, `two searches took ${gap} ms, closer than the second Nominatim asks for`);
  const again = await searchOnline("Rue de Rivoli, Paris", { version: panelVersion.value || "test" });
  check(again.cached, "the same search went online again");
  const passed = problems.length === 0;
  log(`GC1 OpenStreetMap search: ${rivoli?.name ?? "?"} (${rivoli?.detail ?? ""}), ${gulshan?.name ?? "?"}, ${problems.length} problems`, passed ? "ok" : "fail");
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, problems, paris: paris.results.slice(0, 3), dhaka: dhaka.results.slice(0, 3) };
}
