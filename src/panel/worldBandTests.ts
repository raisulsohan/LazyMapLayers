// WB1: the band between the world map and a downloaded region.
//
// A flight from the globe to a city passes through zoom 7, 8 and 9. Until the world data carried
// cities and the roads between them, that band held only coastlines and borders, so the ground looked
// emptiest exactly where the viewer is closest to it.
//
// The measurement is a comparison, not a guess at colours: every zoom is rendered twice, once with
// the two layers and once without, and the pixels that differ are what they really draw.

import type { StyleSpecification } from "maplibre-gl";
import type { View } from "../core/camera/camera.ts";
import { encodePng } from "../core/image/png.ts";
import { naturalEarthArchivePath, registerLocalArchive } from "./basemap/maplibreSetup.ts";
import { naturalEarthStyle } from "./basemap/naturalEarthStyle.ts";
import { themeById } from "../core/style/themes.ts";
import { FrameRenderer } from "./render/frameRenderer.ts";
import { fs, path } from "./cep.ts";
import { spikeDir, type SpikeLog } from "./spikes.ts";

const SIZE = { width: 640, height: 360 };
const PIXELS = SIZE.width * SIZE.height;
const BAND_LAYERS = ["urban", "ne-roads"];

/** Over the Rhine-Ruhr: cities, motorways and a border in one frame at every zoom. */
const CENTRE = { lng: 6.9, lat: 51.2 };

// share: how much of the frame the two layers touch. strength: how hard they touch it, which is
// what the fade at the top of the band changes while the coverage stays much the same.
type Counted = { zoom: number; drawn: number; share: number; strength: number };

const withoutBand = (style: StyleSpecification): StyleSpecification => ({
  ...style,
  layers: style.layers.filter((layer) => BAND_LAYERS.indexOf(layer.id) < 0)
});

async function frameAt(style: StyleSpecification, view: View): Promise<{ rgba: Uint8Array; width: number; height: number }> {
  const renderer = new FrameRenderer({ ...SIZE, style, antialias: true });
  try {
    await renderer.init();
    const frame = await renderer.renderFrame(view, 0);
    return { rgba: frame.rgba, width: frame.width, height: frame.height };
  } finally {
    renderer.destroy();
  }
}

export async function runWorldBandTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const theme = themeById("daylight");
  const style = naturalEarthStyle(registerLocalArchive("lml-world", naturalEarthArchivePath()), { theme, labels: false });
  const bare = withoutBand(style);
  if (style.layers.length - bare.layers.length !== BAND_LAYERS.length) problems.push("the world style no longer carries both the city and the road layer");
  const folder = path().join(spikeDir(), "WB1-frames");
  fs().mkdirSync(folder, { recursive: true });
  const counted: Counted[] = [];

  for (const zoom of [5, 6, 7, 8, 9, 10, 11]) {
    const view: View = { center: CENTRE, zoom, bearing: 0, pitch: 0 };
    const full = await frameAt(style, view);
    const plain = await frameAt(bare, view);
    fs().writeFileSync(path().join(folder, `z${zoom}.png`), encodePng(full.rgba, full.width, full.height));
    if (zoom === 8) fs().writeFileSync(path().join(folder, "z8-without.png"), encodePng(plain.rgba, plain.width, plain.height));
    let drawn = 0;
    let total = 0;
    for (let at = 0; at < full.rgba.length; at += 4) {
      const apart = Math.abs(full.rgba[at] - plain.rgba[at]) + Math.abs(full.rgba[at + 1] - plain.rgba[at + 1]) + Math.abs(full.rgba[at + 2] - plain.rgba[at + 2]);
      if (apart > 0) drawn++;
      total += apart;
    }
    const share = (drawn / PIXELS) * 100;
    const strength = total / (PIXELS * 3);
    counted.push({ zoom, drawn, share, strength });
    log(`WB1 zoom ${zoom}: cities and roads paint ${share.toFixed(1)} % of the frame, strength ${strength.toFixed(2)}`, "muted");
  }

  const at = (zoom: number) => counted.find((entry) => entry.zoom === zoom);
  // The band is the point: at 7, 8 and 9 the ground must carry more than coastlines and borders.
  for (const zoom of [7, 8, 9]) {
    const entry = at(zoom);
    if (!entry) {
      problems.push(`zoom ${zoom} was not rendered`);
      continue;
    }
    if (entry.share < 4) problems.push(`zoom ${zoom} is only ${entry.share.toFixed(1)} % city and road, which still reads as empty`);
  }
  // They arrive gently rather than snapping on, and give way to a region's own detail past 10.
  const five = at(5);
  const eight = at(8);
  const eleven = at(11);
  if (five && eight && eight.share <= five.share) problems.push(`the cover does not grow into the band: ${five.share.toFixed(1)} % at zoom 5 against ${eight.share.toFixed(1)} % at 8`);
  if (five && five.share > 12) problems.push(`zoom 5 already paints ${five.share.toFixed(1)} %, which is too much for a world view`);
  const nine = at(9);
  if (nine && eleven && eleven.strength >= nine.strength * 0.25) problems.push(`the band does not fade out: strength ${nine.strength.toFixed(2)} at zoom 9 against ${eleven.strength.toFixed(2)} at 11`);

  const passed = problems.length === 0;
  log(`WB1 world band: ${counted.map((entry) => `z${entry.zoom} ${entry.share.toFixed(1)} %`).join(", ")}, ${problems.length} problems`, passed ? "ok" : "fail");
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, counted, folder, problems };
}
