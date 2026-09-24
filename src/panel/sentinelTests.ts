// SN1 (online, only when named): a satellite picture built from Sentinel-2 inside the panel.
//
// This is the whole path in the place it really runs: ask the open catalogue, read cloud-optimised
// GeoTIFFs over the network with range requests, decode them with our own reader, paint map tiles,
// encode them in the browser and write a PMTiles archive the renderer can draw.

import { PMTiles } from "pmtiles";
import { decodePng } from "../core/image/pngDecode.ts";
import { NodeFileSource } from "./basemap/nodeFileSource.ts";
import { fs } from "./cep.ts";
import { buildSatellite, encodeTile, listSatellitePacks, planSatellite, satellitePath } from "./imagery/sentinelBuild.ts";
import type { SpikeLog } from "./spikes.ts";

/** A small piece of central Dhaka: a handful of tiles, a few megabytes. */
const AREA = { west: 90.39, south: 23.75, east: 90.43, north: 23.78 };
const NAME = "sn1-test";

export async function runSentinelTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const started = performance.now();

  const plan = await planSatellite(AREA, { minZoom: 12, maxZoom: 13, months: 14 });
  log(`SN1: ${plan.scenes.length} scenes, ${plan.tiles.length} tiles, about ${(plan.estimateBytes / 1048576).toFixed(0)} MB`, "muted");
  if (!plan.scenes.length) problems.push("the catalogue found no clear scene over Dhaka in fourteen months");
  if (plan.tiles.length < 2 || plan.tiles.length > 40) problems.push(`${plan.tiles.length} tiles for a small area`);
  for (const scene of plan.scenes) {
    if (!scene.grid) problems.push(`${scene.id} is on a grid this cannot read (epsg ${scene.epsg})`);
    if (!scene.visual.startsWith("https://")) problems.push(`${scene.id} has no true-colour picture`);
  }

  const built = plan.scenes.length ? await buildSatellite(NAME, plan, { encode: encodeTile }) : null;
  if (!built) {
    log("SN1 satellite: nothing to build", "fail");
    return { passed: false, problems };
  }
  if (!built.tiles) problems.push("no tile came out of the build");
  if (built.downloaded < 100000) problems.push(`only ${built.downloaded} bytes were downloaded, which cannot be a picture`);
  if (!fs().existsSync(satellitePath(NAME))) problems.push("the archive was not written");

  // The archive reads back as an archive, over the area asked for, with a real picture inside.
  const source = new NodeFileSource(satellitePath(NAME), "sn1-check");
  let colours = { r: 0, g: 0, b: 0 };
  let opaque = 0;
  try {
    const archive = new PMTiles(source);
    const header = await archive.getHeader();
    if (header.maxZoom !== 13 || header.minZoom !== 12) problems.push(`the archive holds zooms ${header.minZoom} to ${header.maxZoom}`);
    if (header.minLon > AREA.west + 0.01 || header.maxLon < AREA.east - 0.01) problems.push(`the archive covers ${header.minLon} to ${header.maxLon}`);
    const metadata = (await archive.getMetadata()) as { attribution?: string };
    if (!metadata?.attribution?.includes("Copernicus")) problems.push(`the archive credits "${metadata?.attribution}"`);
    // One tile, decoded: a satellite picture is never flat black or flat white.
    const first = plan.tiles.find((tile) => tile.z === 13) ?? plan.tiles[0];
    const tile = await archive.getZxy(first.z, first.x, first.y);
    if (!tile?.data) problems.push(`no tile at ${first.z}/${first.x}/${first.y}`);
    else {
      const bitmap = await createImageBitmap(new Blob([tile.data], { type: "image/webp" }));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      context?.drawImage(bitmap, 0, 0);
      const pixels = context?.getImageData(0, 0, bitmap.width, bitmap.height).data;
      if (!pixels) problems.push("the tile could not be drawn");
      else {
        let r = 0;
        let g = 0;
        let b = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 3] < 255) continue;
          opaque++;
          r += pixels[i];
          g += pixels[i + 1];
          b += pixels[i + 2];
        }
        colours = { r: Math.round(r / Math.max(1, opaque)), g: Math.round(g / Math.max(1, opaque)), b: Math.round(b / Math.max(1, opaque)) };
        if (opaque < bitmap.width * bitmap.height * 0.9) problems.push(`only ${((opaque / (bitmap.width * bitmap.height)) * 100).toFixed(0)}% of the tile was painted`);
        if (colours.r < 10 && colours.g < 10 && colours.b < 10) problems.push("the tile came out black");
        if (colours.r > 245 && colours.g > 245 && colours.b > 245) problems.push("the tile came out white");
      }
    }
  } catch (error) {
    problems.push(`the archive could not be read: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    source.close();
  }

  // It is listed as an area of this computer, and can be taken away again.
  const listed = (await listSatellitePacks()).find((pack) => pack.name === NAME);
  if (!listed) problems.push("the area was not listed afterwards");
  else if (!listed.attribution?.includes("Copernicus")) problems.push(`the listing credits "${listed.attribution}"`);
  try {
    fs().unlinkSync(satellitePath(NAME));
  } catch {
    problems.push("the test's archive could not be removed again");
  }

  const seconds = ((performance.now() - started) / 1000).toFixed(0);
  const passed = problems.length === 0;
  log(
    `SN1 satellite: ${built.tiles} tiles from ${built.scenes.length} scenes in ${seconds} s, ${(built.downloaded / 1048576).toFixed(1)} MB down, ${(built.bytes / 1048576).toFixed(1)} MB kept, average colour ${colours.r},${colours.g},${colours.b}, ${problems.length} problems`,
    passed ? "ok" : "fail"
  );
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, scenes: built.scenes, tiles: built.tiles, downloaded: built.downloaded, bytes: built.bytes, colours, seconds: Number(seconds), problems };
}
