// LK1: a look of the designer's own. The colours chosen reach the pixels the renderer draws, the
// names stay readable on them, and a picture makes a look that holds together.

import type { View } from "../core/camera/camera.ts";
import { applyLook, lookFromPicture, NO_LOOK } from "../core/style/customLook.ts";
import { contrast, fromHex } from "../core/style/palette.ts";
import { themeById } from "../core/style/themes.ts";
import { basemapStyle } from "./basemap/basemapStyle.ts";
import { FrameRenderer } from "./render/frameRenderer.ts";
import type { SpikeLog } from "./spikes.ts";

const SIZE = { width: 640, height: 360 };

/** The colour the renderer drew at a point of the frame. */
const at = (rgba: Uint8Array, x: number, y: number): [number, number, number] => {
  const i = (Math.round(y) * SIZE.width + Math.round(x)) * 4;
  return [rgba[i], rgba[i + 1], rgba[i + 2]];
};

const near = (got: [number, number, number], want: string, slack = 12) => {
  const [r, g, b] = fromHex(want);
  return Math.abs(got[0] - r) <= slack && Math.abs(got[1] - g) <= slack && Math.abs(got[2] - b) <= slack;
};

export async function runCustomLookTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  // The Arabian Sea and the middle of India: open water and open land at this view.
  const view: View = { center: { lat: 20, lng: 74 }, zoom: 3.6, bearing: 0, pitch: 0 };
  const sea = { x: 150, y: 250 };
  const land = { x: 360, y: 150 };

  const ownColours = { ...NO_LOOK, ocean: "#3a0d52", land: "#f0e4c8", accent: "#ff3b6b" };
  const look = applyLook(themeById("midnight"), ownColours);
  if (look.dark) problems.push("light land should make a light look");
  if (contrast(fromHex(look.text), fromHex(look.land)) < 4.5) problems.push(`the names (${look.text}) cannot be read on the land (${look.land})`);

  const renderer = new FrameRenderer({ width: SIZE.width, height: SIZE.height, style: basemapStyle({ kind: "world" }, { labels: false, theme: look, viewport: SIZE }) });
  let drawnSea: [number, number, number] = [0, 0, 0];
  let drawnLand: [number, number, number] = [0, 0, 0];
  try {
    await renderer.init();
    const frame = await renderer.renderFrame(view, 0);
    drawnSea = at(frame.rgba, sea.x, sea.y);
    drawnLand = at(frame.rgba, land.x, land.y);
    if (!near(drawnSea, look.ocean)) problems.push(`the sea is ${drawnSea} where the look says ${look.ocean}`);
    if (!near(drawnLand, look.land)) problems.push(`the land is ${drawnLand} where the look says ${look.land}`);
  } finally {
    renderer.destroy();
  }

  // The same map with the look it started as: the colours really did change.
  const plain = new FrameRenderer({ width: SIZE.width, height: SIZE.height, style: basemapStyle({ kind: "world" }, { labels: false, theme: "midnight", viewport: SIZE }) });
  try {
    await plain.init();
    const frame = await plain.renderFrame(view, 0);
    const before = at(frame.rgba, sea.x, sea.y);
    if (near(before, look.ocean, 24)) problems.push(`the look was already ${before} before it was changed`);
  } finally {
    plain.destroy();
  }

  // A picture of three colours makes a look of them.
  const blocks = [
    { hex: "#07131f", count: 500 },
    { hex: "#1d3a52", count: 300 },
    { hex: "#ffb03a", count: 120 }
  ];
  const total = blocks.reduce((n, block) => n + block.count, 0);
  const rgba = new Uint8Array(total * 4);
  let write = 0;
  for (const block of blocks) {
    const [r, g, b] = fromHex(block.hex);
    for (let i = 0; i < block.count; i++) {
      rgba[write++] = r;
      rgba[write++] = g;
      rgba[write++] = b;
      rgba[write++] = 255;
    }
  }
  const fromPicture = lookFromPicture(rgba, { colours: 3 });
  const built = applyLook(themeById("paper"), fromPicture);
  if (!built.dark) problems.push(`a dark picture made a light look (${built.land})`);
  if (contrast(fromHex(built.text), fromHex(built.land)) < 4.5) problems.push(`names from the picture (${built.text}) cannot be read on ${built.land}`);

  const passed = problems.length === 0;
  log(
    `LK1 your own look: the sea drew ${drawnSea.join(",")} for ${look.ocean} and the land ${drawnLand.join(",")} for ${look.land}; a picture gave sea ${fromPicture.ocean}, land ${fromPicture.land}, lines ${fromPicture.accent}; ${problems.length} problems`,
    passed ? "ok" : "fail"
  );
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, sea: drawnSea, land: drawnLand, look: { ocean: look.ocean, land: look.land, text: look.text, border: look.border }, fromPicture, problems };
}
