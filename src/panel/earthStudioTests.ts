// ES1: a Google Earth Studio camera brought in. A tracking file written the way Earth Studio writes
// them becomes a scene of the same size, length and frame rate, with this map's camera keyed to
// theirs frame by frame, and their track points pinned.

import { rotationForView, viewOfFrame, type EarthStudioFrame } from "../core/earth/earthStudio.ts";
import { float32 } from "../core/ae/pinExpressions.ts";
import { evalScript } from "./cep.ts";
import { importEarthStudio } from "./earthStudio.ts";
import type { SpikeLog } from "./spikes.ts";

const WIDTH = 960;
const HEIGHT = 540;
const FPS = 25;

/** A camera that drops towards Dhaka while it turns and tilts, written as Earth Studio writes it. */
function trackingFile(frames: number): { text: string; frames: EarthStudioFrame[] } {
  const made: EarthStudioFrame[] = [];
  for (let i = 0; i < frames; i++) {
    const t = i / (frames - 1);
    const lat = 23.81 - 0.02 * t;
    const lng = 90.41 + 0.03 * t;
    const bearing = -40 + 95 * t;
    const pitch = 8 + 47 * t;
    made.push({ lat, lng, altitude: 40000 - 37000 * t, fov: 20, rotation: rotationForView(lat, lng, bearing, pitch) });
  }
  const text = JSON.stringify({
    name: "ES1 flight",
    width: WIDTH,
    height: HEIGHT,
    frameRate: FPS,
    numFrames: frames,
    durationSeconds: frames / FPS,
    cameraFrames: made.map((frame) => ({
      position: { x: 0, y: 0, z: 0 },
      rotation: frame.rotation,
      coordinate: { latitude: frame.lat, longitude: frame.lng, altitude: frame.altitude },
      fovVertical: frame.fov
    })),
    trackPoints: [
      {
        position: { x: 0, y: 0, z: 0 },
        name: "Old town",
        coordinate: {
          name: "Old town",
          color: "#148fbc",
          visible: true,
          position: {
            type: "position",
            attributes: [
              { type: "longitude", value: { relative: (90.4125 + 180) / 360 } },
              { type: "latitude", value: { relative: (23.7104 + 90) / 180 } },
              { type: "altitude", value: { maxValueRange: 65117481, minValueRange: -500, relative: (12 + 500) / (65117481 + 500), logarithmic: false } }
            ]
          },
          isOrigin: true
        },
        visible: true
      }
    ]
  });
  return { text, frames: made };
}

type Built = {
  comp: { width: number; height: number; frameRate: number; duration: number; name: string };
  keys: number[];
  at: { time: number; lat: number; lng: number; zoom: number; bearing: number; pitch: number }[];
  pins: { name: string; lat: number; lng: number }[];
};

/** What After Effects holds after the import: the comp, the camera keys, the pins. */
async function readBuilt(mapId: string, sample: number[]): Promise<Built> {
  return JSON.parse(
    await evalScript(`(function () {
      var layer = LML.pins.findMapLayer(${JSON.stringify(mapId)});
      var scene = layer.containingComp;
      var out = { comp: { width: scene.width, height: scene.height, frameRate: scene.frameRate, duration: scene.duration, name: scene.name }, keys: [], at: [], pins: [] };
      var names = ["Latitude", "Longitude", "Zoom", "Bearing", "Pitch"];
      var props = [];
      for (var c = 0; c < names.length; c++) {
        var prop = LML.map.controlValueProperty(layer, names[c]);
        props.push(prop);
        out.keys.push(prop ? prop.numKeys : 0);
      }
      var wanted = ${JSON.stringify(sample)};
      for (var w = 0; w < wanted.length; w++) {
        var index = wanted[w] + 1;
        if (!props[0] || props[0].numKeys < index) continue;
        out.at.push({
          time: props[0].keyTime(index),
          lat: props[0].keyValue(index),
          lng: props[1].keyValue(index),
          zoom: props[2].keyValue(index),
          bearing: props[3].keyValue(index),
          pitch: props[4].keyValue(index)
        });
      }
      for (var i = 1; i <= scene.numLayers; i++) {
        var other = scene.layer(i), tag = LML.tag.read(other);
        if (!tag || tag.kind !== "pin") continue;
        var effects = other.property("ADBE Effect Parade");
        out.pins.push({ name: other.name, lat: effects.property("Latitude").property(1).value, lng: effects.property("Longitude").property(1).value });
      }
      return LML.json.stringify(out);
    })()`)
  ) as Built;
}

export async function runEarthStudioTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const count = 60;
  const { text, frames } = trackingFile(count);
  const made = await importEarthStudio(text, { name: "ES1 Earth Studio", pinTrackPoints: true, newScene: true });

  if (made.keys !== count) problems.push(`${made.keys} camera keys for ${count} frames`);
  if (made.pins !== 1) problems.push(`${made.pins} pins for one track point`);

  const sample = [0, 1, Math.floor(count / 2), count - 1];
  const built = await readBuilt(made.map.id, sample);
  if (built.comp.width !== WIDTH || built.comp.height !== HEIGHT) problems.push(`the scene is ${built.comp.width}x${built.comp.height}`);
  if (Math.abs(built.comp.frameRate - FPS) > 0.001) problems.push(`the scene runs at ${built.comp.frameRate} fps`);
  if (Math.abs(built.comp.duration - count / FPS) > 0.001) problems.push(`the scene is ${built.comp.duration} s long, expected ${count / FPS}`);
  for (const keys of built.keys) {
    if (keys !== count) problems.push(`a camera control has ${keys} keys, expected ${count}`);
  }

  // Every sampled key is the view the file asks for, to the sixth decimal.
  for (let i = 0; i < sample.length; i++) {
    const wanted = viewOfFrame(frames[sample[i]], HEIGHT);
    const got = built.at[i];
    if (!got) {
      problems.push(`no key read for frame ${sample[i]}`);
      continue;
    }
    if (Math.abs(got.time - sample[i] / FPS) > 1e-6) problems.push(`frame ${sample[i]} is keyed at ${got.time} s`);
    // A slider holds a float32, so the keys come back rounded to one.
    // A slider holds a float32, and the answer comes back through JSON with fifteen digits.
    if (Math.abs(got.lat - float32(wanted.center.lat)) > 1e-9) problems.push(`frame ${sample[i]} latitude ${got.lat} against ${float32(wanted.center.lat)}`);
    if (Math.abs(got.lng - float32(wanted.center.lng)) > 1e-9) problems.push(`frame ${sample[i]} longitude ${got.lng} against ${float32(wanted.center.lng)}`);
    if (Math.abs(got.zoom - wanted.zoom) > 1e-5) problems.push(`frame ${sample[i]} zoom ${got.zoom} against ${wanted.zoom}`);
    if (Math.abs(got.pitch - wanted.pitch) > 1e-4) problems.push(`frame ${sample[i]} pitch ${got.pitch} against ${wanted.pitch}`);
    const turn = Math.abs(((got.bearing - wanted.bearing + 540) % 360) - 180);
    if (turn > 1e-4) problems.push(`frame ${sample[i]} bearing ${got.bearing} against ${wanted.bearing}`);
  }

  // The camera really moves: it turns, tilts and comes down over the flight.
  const first = built.at[0];
  const last = built.at[built.at.length - 1];
  if (first && last) {
    if (!(last.zoom > first.zoom + 2)) problems.push(`the camera only went from zoom ${first.zoom} to ${last.zoom}`);
    if (!(last.pitch > first.pitch + 30)) problems.push(`the tilt went from ${first.pitch} to ${last.pitch}`);
    if (!(Math.abs(last.bearing - first.bearing) > 60)) problems.push(`the turn went from ${first.bearing} to ${last.bearing}`);
  }

  const pin = built.pins.find((p) => p.name.indexOf("Old town") >= 0);
  if (!pin) problems.push(`the track point was not pinned: ${JSON.stringify(built.pins.map((p) => p.name))}`);
  else if (Math.abs(pin.lat - 23.7104) > 1e-4 || Math.abs(pin.lng - 90.4125) > 1e-4) problems.push(`the pin sits at ${pin.lat}, ${pin.lng}`);

  const passed = problems.length === 0;
  log(`ES1 Earth Studio: ${made.keys} keys, ${built.comp.width}x${built.comp.height} at ${built.comp.frameRate} fps, tilt ${first?.pitch.toFixed(1)}-${last?.pitch.toFixed(1)}, ${built.pins.length} pins, ${problems.length} problems`, passed ? "ok" : "fail");
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, keys: made.keys, comp: built.comp, first, last, pins: built.pins.length, problems };
}
