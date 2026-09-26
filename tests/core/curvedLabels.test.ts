import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { project, type View } from "../../src/core/camera/camera.ts";
import { curvedLabelPathExpression } from "../../src/core/ae/labelExpressions.ts";
import { bendNear, stretchAround } from "../../src/core/labels/cityNames.ts";

const envSource = fs.readFileSync(path.join(import.meta.dirname, "..", "..", "tools", "expression-env.js"), "utf8");
const fake = new Function(`${envSource}\nreturn lmlRunExpression;`)() as (code: string, env: unknown) => { points: number[][]; closed: boolean };

const viewport = { width: 1920, height: 1080 };
const run = (code: string, view: View) =>
  fake(code, {
    own: { Map: "MAP" },
    map: { width: viewport.width, height: viewport.height, scale: 1, controls: { Latitude: view.center.lat, Longitude: view.center.lng, Zoom: view.zoom, Bearing: view.bearing, Pitch: view.pitch }, toComp: [1, 0, 0, 0, 1, 0] },
    comp: viewport,
    value: null
  });
// The fake layer's fromComp moves a point by (-7, +3); undo it to read comp pixels.
const toComp = (p: number[]) => [p[0] + 7, p[1] - 3];
const length = (points: number[][]) => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - points[i][0], p[1] - points[i][1]), 0);

// A street that bends: a quarter circle of about 1.2 km around a centre in Dhaka, as [lng, lat].
const centre = { lat: 23.75, lng: 90.39 };
const arc: number[][] = [];
for (let k = 0; k <= 40; k++) {
  const a = (k / 40) * (Math.PI / 2);
  arc.push([centre.lng + (Math.cos(a) * 0.008) / Math.cos((centre.lat * Math.PI) / 180), centre.lat + Math.sin(a) * 0.008]);
}

test("a stretch of a line either side of a name keeps its place in the middle", () => {
  const stretch = stretchAround(arc, 600, 300, 25);
  const place = stretch.points[stretch.mid];
  assert.ok(stretch.mid >= 10 && stretch.points.length - stretch.mid - 1 >= 10, JSON.stringify([stretch.mid, stretch.points.length]));
  // Every point lies on the circle, as [lat, lng].
  for (const [lat, lng] of stretch.points) {
    const r = Math.hypot((lng - centre.lng) * Math.cos((centre.lat * Math.PI) / 180), lat - centre.lat);
    assert.ok(Math.abs(r - 0.008) < 0.0001, `off the arc by ${r - 0.008}`);
  }
  assert.ok(place[0] > centre.lat && place[1] > centre.lng);
  // Near an end of the line the stretch stops at the end.
  const early = stretchAround(arc, 50, 300, 25);
  assert.equal(early.mid, 2);
});

test("a name bends along its line, centred on its place and upright at any bearing", () => {
  const stretch = stretchAround(arc, 600, 700, 25);
  const [lat, lng] = stretch.points[stretch.mid];
  const from = { lat: stretch.points[stretch.mid - 2][0], lng: stretch.points[stretch.mid - 2][1] };
  const to = { lat: stretch.points[stretch.mid + 2][0], lng: stretch.points[stretch.mid + 2][1] };
  for (const bearing of [0, 70, 160, 250, 330]) {
    const view: View = { center: { lat, lng }, zoom: 15, bearing, pitch: 30 };
    const flatPath = run(curvedLabelPathExpression(stretch, from, to, 0), view).points.map(toComp);
    const place = project(view, viewport, { lat, lng });
    // It reads left to right.
    assert.ok(flatPath[flatPath.length - 1][0] > flatPath[0][0], `reads right to left at bearing ${bearing}`);
    // The name's place is halfway along it, on screen.
    let walked = 0;
    let half = -1;
    const total = length(flatPath);
    for (let i = 1; i < flatPath.length; i++) {
      const step = Math.hypot(flatPath[i][0] - flatPath[i - 1][0], flatPath[i][1] - flatPath[i - 1][1]);
      if (walked + step >= total / 2) {
        const t = (total / 2 - walked) / step;
        half = i;
        const x = flatPath[i - 1][0] + (flatPath[i][0] - flatPath[i - 1][0]) * t;
        const y = flatPath[i - 1][1] + (flatPath[i][1] - flatPath[i - 1][1]) * t;
        assert.ok(Math.hypot(x - place.x, y - place.y) < 0.5, `the middle is ${Math.hypot(x - place.x, y - place.y).toFixed(2)} px off the place at bearing ${bearing}`);
        break;
      }
      walked += step;
    }
    assert.ok(half > 0);
    // It bends: the middle stands off the chord of its ends.
    const [p, q] = [flatPath[0], flatPath[flatPath.length - 1]];
    const bow = Math.abs((q[0] - p[0]) * (p[1] - place.y) - (p[0] - place.x) * (q[1] - p[1])) / Math.hypot(q[0] - p[0], q[1] - p[1]);
    assert.ok(bow > 10, `only ${bow.toFixed(1)} px of bend at bearing ${bearing}`);
    // Moved by dy along its normal: the letters' baseline sits below the line on screen.
    const lowered = run(curvedLabelPathExpression(stretch, from, to, 9), view).points.map(toComp);
    const m = Math.floor(lowered.length / 2);
    let nearest = Infinity;
    for (const r of flatPath) nearest = Math.min(nearest, Math.hypot(lowered[m][0] - r[0], lowered[m][1] - r[1]));
    assert.ok(Math.abs(nearest - 9) < 1, `the baseline is ${nearest.toFixed(2)} px off the line, not 9`);
  }
});

test("a gentle bend carries a bent name; a corner does not", () => {
  // The quarter circle turns 90 degrees over 1.2 km: about 14 degrees within 150 m of its middle.
  const gentle = bendNear(stretchAround(arc, 600));
  assert.ok(gentle > 5 && gentle < 25, `the arc turns ${gentle.toFixed(1)} degrees near its middle`);
  // A right-angled corner 50 m from the name.
  const corner = [[90.39, 23.75], [90.392, 23.75], [90.392, 23.752]];
  const cornerStretch = stretchAround(corner, 160);
  assert.ok(bendNear(cornerStretch) > 80, `the corner turns ${bendNear(cornerStretch).toFixed(1)} degrees`);
});

test("a name longer than its stretch runs on straight past the ends", () => {
  const stretch = stretchAround(arc, 600, 60, 25);
  const [lat, lng] = stretch.points[stretch.mid];
  const view: View = { center: { lat, lng }, zoom: 14, bearing: 0, pitch: 0 };
  const from = { lat: stretch.points[0][0], lng: stretch.points[0][1] };
  const to = { lat: stretch.points[stretch.points.length - 1][0], lng: stretch.points[stretch.points.length - 1][1] };
  const long = run(curvedLabelPathExpression(stretch, from, to, 0, 0, 300), view).points.map(toComp);
  assert.ok(Math.abs(length(long) - 600) < 2, `the path is ${length(long).toFixed(1)} px long, not 600`);
});
