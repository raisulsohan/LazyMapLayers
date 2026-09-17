// DS1: districts from geoBoundaries, end to end. Needs the internet, so it only runs when asked for by
// name. The first run downloads Bangladesh's districts (1.7 MB); later runs reuse the installed set and
// only ask for the metadata again.

import { project, type View } from "../core/camera/camera.ts";
import { simplifyPolygons } from "../core/geo/simplify.ts";
import { decodePng } from "../core/image/pngDecode.ts";
import { DEFAULT_FINAL_SETTINGS, normaliseSettings, sequenceFileName } from "../core/render/plan.ts";
import { searchPlaces } from "../core/search/placeSearch.ts";
import { AREA_MAX_POINTS } from "../core/style/highlights.ts";
import { evalScript, fs, path } from "./cep.ts";
import { districtAt, districtSetOf, districtsOf, findDistricts, installDistricts } from "./data/districts.ts";
import { placeIndex, resetPlaceIndex } from "./data/worldLabels.ts";
import { createMapComp } from "./mapApi.ts";
import { runRenderJob } from "./render/renderJob.ts";
import type { SpikeLog } from "./spikes.ts";

export async function runDistrictTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const started = performance.now();
  const offer = await findDistricts("BGD");
  const lookupMs = performance.now() - started;
  if (!offer || offer.count !== 64 || offer.unit !== "district" || !offer.license || !offer.source || !(offer.sizeBytes && offer.sizeBytes > 5e5 && offer.sizeBytes < 2e7)) problems.push(`the offer for Bangladesh: ${JSON.stringify(offer)}`);
  if ((await findDistricts("ZZZ")) !== null) problems.push("an unknown country gets an offer");

  let installMs = 0;
  if (!districtSetOf("BGD") && offer) {
    const before = performance.now();
    let last = 0;
    await installDistricts(offer, { code: "BGD", name: "Bangladesh" }, { onProgress: (done) => (last = done) });
    installMs = performance.now() - before;
    if (last < 5e5) problems.push(`download progress stopped at ${last} bytes`);
    resetPlaceIndex();
  }
  const set = districtSetOf("BGD");
  if (!set || set.units.length !== 64 || !set.license) problems.push(`the installed set: ${set ? `${set.units.length} units, licence "${set.license}"` : "none"}`);
  const units = districtsOf("BGD");
  const largest = Math.max(0, ...units.map((u) => u.polygons.reduce((n, polygon) => n + polygon.reduce((m, ring) => m + ring.length, 0), 0)));
  if (units.length !== 64 || largest > AREA_MAX_POINTS) problems.push(`${units.length} districts on disk, the largest with ${largest} points`);

  const sylhetCity = { lat: 24.9, lng: 91.87 };
  const dhaka = { lat: 23.8, lng: 90.4 };
  const sylhet = districtAt("BGD", sylhetCity);
  if (sylhet?.name !== "Sylhet" || districtAt("BGD", dhaka)?.name !== "Dhaka" || districtAt("BGD", { lat: 15, lng: 88 })) problems.push(`districts under the test points: ${sylhet?.name}, ${districtAt("BGD", dhaka)?.name}`);
  const found = searchPlaces(placeIndex(), "Sunamganj").find((r) => r.kind === "district");
  if (!found || found.code !== "BGD" || !found.adm1?.startsWith("gb") || !found.bbox || !/District, Sylhet, Bangladesh/.test(found.detail)) problems.push(`searching "Sunamganj": ${JSON.stringify(found)}`);

  // A highlighted district renders as its own layer, and the data credit names geoBoundaries.
  let credit = "";
  if (sylhet) {
    const size = { width: 1280, height: 720 };
    const view: View = { center: { lat: 24.4, lng: 91 }, zoom: 6.6, bearing: 0, pitch: 0 };
    const map = await createMapComp({ name: "DS1 districts", ...size, duration: 1, frameRate: 25, view, newScene: true });
    const settings = normaliseSettings({ ...DEFAULT_FINAL_SETTINGS, supersample: 1, passes: ["base"] }, DEFAULT_FINAL_SETTINGS);
    const job = await runRenderJob({
      mapId: map.id,
      quality: "final",
      settings,
      basemap: { kind: "world" },
      highlights: [{ code: `area:${sylhet.id}`, name: sylhet.name, color: "#ff5fa2", fill: 0.6, outline: 2 }],
      areas: { [sylhet.id]: simplifyPolygons(sylhet.polygons, AREA_MAX_POINTS) }
    });
    const pass = job.sequences.find((s) => s.pass === `highlight-area-${sylhet.id}`);
    if (!pass) problems.push(`passes rendered: ${job.passes.join(",")}`);
    else {
      const rgba = decodePng(new Uint8Array(fs().readFileSync(path().join(pass.folder, sequenceFileName(0))))).rgba;
      const at = (place: { lat: number; lng: number }) => {
        const p = project(view, size, place);
        return rgba[(Math.round(p.y) * size.width + Math.round(p.x)) * 4 + 3];
      };
      if (at(sylhetCity) < 120 || at(dhaka) !== 0) problems.push(`the district layer: Sylhet alpha ${at(sylhetCity)}, Dhaka alpha ${at(dhaka)}`);
    }
    credit = await evalScript(
      `(function () { var scene = LML.pins.findMapLayer(${JSON.stringify(map.id)}).containingComp; for (var i = 1; i <= scene.numLayers; i++) { var t = LML.tag.read(scene.layer(i)); if (t && t.kind === "attribution") return String(scene.layer(i).property("ADBE Text Properties").property("ADBE Text Document").value.text); } return ""; })()`
    );
    if (credit !== "Boundaries: geoBoundaries") problems.push(`the data credit reads "${credit}"`);
  }

  const passed = problems.length === 0;
  log(`DS1 districts: offer in ${lookupMs.toFixed(0)} ms${installMs ? `, installed in ${(installMs / 1000).toFixed(1)} s` : ", already installed"}, ${units.length} districts, largest ${largest} points, credit "${credit}", ${problems.length} problems`, passed ? "ok" : "fail");
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, lookupMs, installMs, units: units.length, largest, offer, problems };
}
