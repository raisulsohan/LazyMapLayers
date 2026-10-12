import { test } from "node:test";
import assert from "node:assert/strict";
import { ARROW_EFFECTS, arrowRigExpressions, defaultArrowControls } from "../../src/core/ae/arrowRig.ts";
import { travellerExpressions } from "../../src/core/ae/labelExpressions.ts";
import { float32 } from "../../src/core/ae/pinExpressions.ts";
import { project, type View, type Viewport } from "../../src/core/camera/camera.ts";

const hd: Viewport = { width: 1920, height: 1080 };
const view: View = { center: { lat: 0.5, lng: 1 }, zoom: 7, bearing: 0, pitch: 0 };
const rounded: View = { center: { lat: float32(view.center.lat), lng: float32(view.center.lng) }, zoom: float32(view.zoom), bearing: 0, pitch: 0 };
// East for 2 degrees, then north for 1 degree (close to the equator, so 2 : 1 in length).
const route = [
  [0, 0, 0],
  [0, 2, 0],
  [1, 2, 0]
];
const e = arrowRigExpressions(route, 1);

/** Evaluates an expression the way After Effects does: the last statement is the result. */
function evaluate(code: string, own: Record<string, number>, value: unknown = 100, time = 0) {
  const mapEffects: Record<string, number> = { Latitude: float32(view.center.lat), Longitude: float32(view.center.lng), Zoom: float32(view.zoom), Bearing: 0, Pitch: 0 };
  const effect = (name: string) => (index: number) => {
    assert.equal(index, 1);
    if (name === "Map") {
      return {
        source: { width: hd.width, height: hd.height },
        effect: (n: string) => () => {
          if (!(n in mapEffects)) throw new Error(`no map control ${n}`);
          return { value: mapEffects[n] };
        },
        toComp: (p: number[]) => [p[0], p[1], 0]
      };
    }
    if (!(name in own)) throw new Error(`unknown effect ${name}`);
    return { value: own[name] };
  };
  // A 2D map layer and arrow layer at the comp's origin: toComp and fromComp change nothing.
  const fromComp = (p: number[]) => [p[0], p[1]];
  const createPath = (points: number[][], _in: unknown, _out: unknown, closed: boolean) => ({ points, closed });
  return new Function("effect", "value", "fromComp", "createPath", "time", "return eval(arguments[5]);")(effect, value, fromComp, createPath, time, code);
}

function controls(over: Partial<Record<string, number>> = {}): Record<string, number> {
  const d = defaultArrowControls(4, [1, 1, 1], [0, 0, 0]);
  return {
    [ARROW_EFFECTS.progress]: 100,
    [ARROW_EFFECTS.tail]: 0,
    [ARROW_EFFECTS.width]: d.width,
    [ARROW_EFFECTS.tailWidth]: d.tailWidth,
    [ARROW_EFFECTS.taperLength]: d.taperLength,
    [ARROW_EFFECTS.headSize]: d.headSize,
    [ARROW_EFFECTS.headStyle]: d.headStyle,
    [ARROW_EFFECTS.bothEnds]: d.bothEnds,
    [ARROW_EFFECTS.dash]: d.dash,
    [ARROW_EFFECTS.gap]: d.gap,
    [ARROW_EFFECTS.dashSpeed]: d.dashSpeed,
    [ARROW_EFFECTS.outline]: d.outline,
    ...over
  } as Record<string, number>;
}

/** The route's length on screen, from the core projection. */
function screenLength(): number {
  const p = route.map(([lat, lng]) => project(rounded, hd, { lat, lng }));
  let total = 0;
  for (let i = 1; i < p.length; i++) total += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
  return total;
}

test("the head sits on the tip and faces the way the route runs", () => {
  const traveller = travellerExpressions(route);
  for (const progress of [0, 20, 50, 90, 100]) {
    const head = evaluate(e.headPosition, controls({ Progress: progress })) as number[];
    const tip = evaluate(traveller.position, { Progress: progress, "Rotate along Route": 1 }, [0, 0]) as number[];
    assert.ok(Math.abs(head[0] - tip[0]) < 1e-6 && Math.abs(head[1] - tip[1]) < 1e-6, `progress ${progress}: head ${head}, tip ${tip}`);
  }
  assert.ok(Math.abs((evaluate(e.headRotation, controls({ Progress: 20 })) as number) - 0) < 0.5, "eastwards is 0 degrees");
  assert.ok(Math.abs((evaluate(e.headRotation, controls({ Progress: 90 })) as number) + 90) < 0.5, "northwards is -90 degrees");
  // The tail head points back the way the route came.
  assert.ok(Math.abs((evaluate(e.tailRotation, controls({ Tail: 10, "Both Ends": 1 })) as number) - 180) < 0.5);
});

test("the line stops behind the head by as much as the head hides", () => {
  const total = screenLength();
  const at = (code: string, over: Partial<Record<string, number>>) => ((evaluate(code, controls(over)) as number) / 100) * total;
  // A triangle on a 4 px line: the head is 14 px long (3.5 times the width), the line stops 4 px back.
  assert.ok(Math.abs(at(e.trimEnd, {}) - (total - 4)) < 0.05, `triangle: ${at(e.trimEnd, {})} of ${total}`);
  assert.ok(Math.abs(at(e.trimEnd, { "Head Style": 2 }) - (total - 2)) < 0.05, "a chevron covers half the width");
  assert.ok(Math.abs(at(e.trimEnd, { "Head Style": 3 }) - total) < 0.05, "no head, the line runs to the end");
  assert.ok(Math.abs(at(e.trimEnd, { Width: 40, "Head Size": 20 }) - (total - 25.2)) < 0.05, "a head never hides more than 90 % of its length");
  assert.equal(evaluate(e.trimStart, controls()), 0);
  assert.ok(Math.abs(at(e.trimStart, { Tail: 30 }) - total * 0.3) < 0.05, "Tail moves the start");
  assert.ok(Math.abs(at(e.trimStart, { Tail: 30, "Both Ends": 1 }) - (total * 0.3 + 4)) < 0.05, "both ends: the start stops behind its own head");
  // Shorter than the head: an empty line, never a start after the end.
  const shortEnd = evaluate(e.trimEnd, controls({ Progress: 0.1 })) as number;
  assert.equal(shortEnd, evaluate(e.trimStart, controls({ Progress: 0.1 })));
  assert.equal(evaluate(e.trimEnd, controls({ Progress: 0 })), 0);
  // Tail never passes the tip.
  assert.equal(evaluate(e.trimStart, controls({ Progress: 40, Tail: 70 })), evaluate(e.trimEnd, controls({ Progress: 40, Tail: 70 })));
});

test("heads fade in as the arrow grows and hide when switched off", () => {
  assert.equal(evaluate(e.headOpacity, controls({ Progress: 0 })), 0);
  const early = evaluate(e.headOpacity, controls({ Progress: 0.5 })) as number;
  assert.ok(early > 0 && early < 100, `a short arrow shows part of its head: ${early}`);
  assert.equal(evaluate(e.headOpacity, controls({ Progress: 50 })), 100);
  assert.equal(evaluate(e.headOpacity, controls({ Progress: 50, "Head Style": 3 })), 0);
  assert.equal(evaluate(e.tailOpacity, controls({ Progress: 50 })), 0, "the tail head waits for Both Ends");
  assert.equal(evaluate(e.tailOpacity, controls({ Progress: 50, "Both Ends": 1 })), 100);
  assert.equal(evaluate(e.fillOpacity, controls()), 100);
  assert.equal(evaluate(e.chevronOpacity, controls()), 0);
  assert.equal(evaluate(e.chevronOpacity, controls({ "Head Style": 2 })), 100);
});

test("the head's shape follows Head Size and Head Style", () => {
  const triangle = evaluate(e.headPath, controls()) as { points: number[][]; closed: boolean };
  assert.equal(triangle.closed, true);
  assert.deepEqual(triangle.points.map((p) => p.map((v) => Math.round(v * 1000) / 1000)), [[0, 0], [-14, -7.7], [-14, 7.7]]);
  const big = evaluate(e.headPath, controls({ "Head Size": 200 })) as { points: number[][] };
  assert.equal(big.points[1][0], -28);
  const hairline = evaluate(e.headPath, controls({ Width: 1 })) as { points: number[][] };
  assert.equal(hairline.points[1][0], -12, "a hairline keeps a readable head");
  const chevron = evaluate(e.headPath, controls({ "Head Style": 2 })) as { points: number[][]; closed: boolean };
  assert.equal(chevron.closed, false);
  assert.deepEqual(chevron.points[1], [0, 0], "the chevron's point is the tip");
});

test("dashes, outline and taper follow their controls", () => {
  assert.equal(evaluate(e.dash, controls()), 100000, "no dash reads as a solid line");
  assert.equal(evaluate(e.gap, controls({ Gap: 9 })), 0);
  assert.equal(evaluate(e.dash, controls({ Dash: 12, Gap: 9 })), 12);
  assert.equal(evaluate(e.gap, controls({ Dash: 12, Gap: 9 })), 9);
  assert.equal(evaluate(e.dashOffset, controls({ "Dash Speed": 30 }), 0, 2), -60);
  assert.equal(evaluate(e.outlineWidth, controls({ "Outline Width": 2 })), 8);
  assert.equal(evaluate(e.outlineOpacity, controls()), 0);
  assert.equal(evaluate(e.outlineOpacity, controls({ "Outline Width": 2 })), 100);
  assert.equal(evaluate(e.headOutlineWidth, controls({ "Outline Width": 2 })), 4);
  assert.equal(evaluate(e.headOutlineWidth, controls({ "Outline Width": 2, "Head Style": 2 })), 8);
  assert.equal(evaluate(e.taperStartWidth, controls({ "Tail Width": 140 })), 100);
  assert.equal(evaluate(e.taperStartLength, controls()), 100);
});

test("every arrow expression is ES3", () => {
  for (const [name, code] of Object.entries(e)) assert.ok(!/\b(const|let)\b|=>|`/.test(code), `${name} is ES3`);
});
