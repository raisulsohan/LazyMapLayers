import { test } from "node:test";
import assert from "node:assert/strict";
import { bearingAndPitch, cameraAxes, earthCentred, EARTH_STUDIO_RADIUS, enuAt, parseEarthStudio, rotationForView, viewOfFrame, type EarthStudioFrame } from "../../src/core/earth/earthStudio.ts";
import { metersPerPixel } from "../../src/core/geo/mercator.ts";

const DEG = Math.PI / 180;

/** A file shaped the way Earth Studio writes them, with the camera straight down over Dhaka. */
function file(options: { frames?: number; rotation?: { x: number; y: number; z: number }; altitude?: number } = {}) {
  const frames = options.frames ?? 2;
  const altitude = options.altitude ?? 65545.34379005432;
  return JSON.stringify({
    name: "Sample",
    width: 1280,
    height: 720,
    frameRate: 30,
    numFrames: frames,
    durationSeconds: frames / 30,
    cameraFrames: Array.from({ length: frames }, (_, i) => ({
      position: { x: -42678.78, y: 5888848.32, z: 2597862.33 },
      rotation: options.rotation ?? { x: 113.80464864735724, y: 0.3799131434521951, z: 179.83240322335283 },
      coordinate: { latitude: 23.804093 - i * 0.0005, longitude: 90.415238 - i * 0.0004, altitude: altitude - i * 700 },
      fovVertical: 20
    })),
    trackPoints: [
      {
        position: { x: -38601.17, y: 5831151.12, z: 2566340.25 },
        name: "Track Point 1",
        coordinate: {
          name: "Track Point 1",
          color: "#148fbc",
          visible: true,
          position: {
            type: "position",
            attributes: [
              { type: "longitude", value: { relative: 0.7510535616920164 } },
              { type: "latitude", value: { relative: 0.631968194088493 } },
              { type: "altitude", value: { maxValueRange: 65117481, minValueRange: -500, relative: 0.000007855835214123708, logarithmic: false } }
            ]
          },
          isOrigin: true
        },
        visible: true
      }
    ]
  });
}

test("a tracking file is read into frames and track points", () => {
  const project = parseEarthStudio(file({ frames: 3 }));
  assert.equal(project.name, "Sample");
  assert.equal(project.width, 1280);
  assert.equal(project.height, 720);
  assert.equal(project.frameRate, 30);
  assert.equal(project.frames.length, 3);
  assert.ok(Math.abs(project.frames[0].lat - 23.804093) < 1e-9);
  assert.ok(Math.abs(project.frames[0].altitude - 65545.34379) < 1e-4);
  assert.equal(project.frames[0].fov, 20);
  // The track point's shares of its ranges become degrees and metres.
  assert.equal(project.trackPoints.length, 1);
  const point = project.trackPoints[0];
  assert.equal(point.name, "Track Point 1");
  assert.ok(Math.abs(point.lng - 90.379282) < 1e-5, `${point.lng}`);
  assert.ok(Math.abs(point.lat - 23.754275) < 1e-5, `${point.lat}`);
  assert.ok(Math.abs(point.altitude - 11.56) < 0.05, `${point.altitude}`);
  assert.equal(point.origin, true);
  assert.equal(point.color, "#148fbc");
});

test("a file that is something else says what is wrong with it", () => {
  assert.throws(() => parseEarthStudio("not json"), /not a JSON file/);
  assert.throws(() => parseEarthStudio('{"hello":1}'), /no cameraFrames/);
  assert.throws(() => parseEarthStudio('{"cameraFrames":[{}],"width":1,"height":1,"frameRate":30}'), /latitude, longitude and altitude/);
  assert.throws(() => parseEarthStudio('{"cameraFrames":[{"coordinate":{"latitude":1,"longitude":2,"altitude":3}}]}'), /what size the render is/);
});

test("the place in the file is the place on Earth Studio's sphere", () => {
  // The numbers a real export carries for its first frame, to a metre.
  const point = earthCentred(23.804093, 90.4152376, 65545.34379005432);
  const theirs = [-42678.781502606646, 5888848.319876273, 2597862.329064446];
  const off = Math.hypot(point[0] - theirs[0], point[1] - theirs[1], point[2] - theirs[2]);
  assert.ok(off < 3, `${off.toFixed(3)} m away from what the file says`);
  assert.equal(EARTH_STUDIO_RADIUS, 6371010);
  // East, north and up stand at right angles and point the right way.
  const { east, north, up } = enuAt(23.8, 90.4);
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  assert.ok(Math.abs(dot(east, north)) < 1e-12 && Math.abs(dot(east, up)) < 1e-12 && Math.abs(dot(north, up)) < 1e-12);
  assert.ok(up[2] > 0 && north[2] > 0, "north of the equator, up and north both lean north");
});

test("a camera straight down over Dhaka reads as no bearing and no pitch", () => {
  const project = parseEarthStudio(file());
  const { bearing, pitch } = bearingAndPitch(project.frames[0]);
  assert.ok(Math.abs(pitch) < 0.01, `pitch ${pitch}`);
  assert.ok(Math.abs(bearing) < 0.2, `bearing ${bearing}`);
  // It really is looking down.
  const { forward } = cameraAxes(project.frames[0].rotation);
  const { up } = enuAt(project.frames[0].lat, project.frames[0].lng);
  assert.ok(forward[0] * up[0] + forward[1] * up[1] + forward[2] * up[2] < -0.9999);
});

test("every way a camera can be pointed survives the round trip", () => {
  for (const lat of [0, 23.8, -33.9, 61.2]) {
    for (const lng of [0, 90.4, -74, 179]) {
      for (const bearing of [0, 37, -110, 179]) {
        for (const pitch of [0, 12, 45, 70]) {
          const rotation = rotationForView(lat, lng, bearing, pitch);
          const frame: EarthStudioFrame = { lat, lng, altitude: 2000, fov: 20, rotation };
          const read = bearingAndPitch(frame);
          assert.ok(Math.abs(read.pitch - pitch) < 1e-6, `pitch ${read.pitch} for ${pitch} at ${lat},${lng}`);
          const turn = Math.abs(((read.bearing - bearing + 540) % 360) - 180);
          if (pitch > 0.001 || true) assert.ok(turn < 1e-6, `bearing ${read.bearing} for ${bearing} at ${lat},${lng} pitch ${pitch}`);
        }
      }
    }
  }
});

test("the view shows the same ground as the frame it came from", () => {
  const project = parseEarthStudio(file());
  const view = viewOfFrame(project.frames[0], project.height);
  assert.deepEqual(
    { lat: Math.round(view.center.lat * 1e6) / 1e6, lng: Math.round(view.center.lng * 1e6) / 1e6 },
    { lat: 23.804093, lng: 90.415238 }
  );
  // What their camera covers from top to bottom is what our comp covers at that zoom.
  const covered = 2 * project.frames[0].altitude * Math.tan(10 * DEG);
  const ours = metersPerPixel(view.center.lat, view.zoom) * project.height;
  assert.ok(Math.abs(covered - ours) < covered * 1e-6, `${covered} m against ${ours} m`);
  // Twice as high in the air is one zoom level out.
  const higher = viewOfFrame({ ...project.frames[0], altitude: project.frames[0].altitude * 2 }, project.height);
  assert.ok(Math.abs(higher.zoom - (view.zoom - 1)) < 1e-9);
  // A tilted camera is further from the ground it points at, so the picture is wider.
  const tilted = viewOfFrame({ ...project.frames[0], rotation: rotationForView(project.frames[0].lat, project.frames[0].lng, 0, 60) }, project.height);
  assert.ok(Math.abs(tilted.pitch - 60) < 1e-6);
  assert.ok(Math.abs(tilted.zoom - (view.zoom - 1)) < 1e-6, `${tilted.zoom} against ${view.zoom}`);
});
