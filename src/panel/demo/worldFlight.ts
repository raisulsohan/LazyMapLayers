// Milestone A demo: a world flight built entirely from LazyMapLayers features.
//
//   0 - 6 s    the globe turns in space while country borders draw on
//   6 - 16 s   one continuous flight down to the Eiffel Tower in Paris
//   16 - 21 s  a slow orbit with a pin and a callout
//   21 - 33 s  a flight to the second city along a great-circle route that draws on
//   33 - 36 s  arrival, with a pin and a callout
//   all along  country and city labels in the local language, placed over the whole timeline

import type { View } from "../../core/camera/camera.ts";
import { flightKeys, type FlightKey } from "../../core/camera/flight.ts";
import { callHost, callHostWithJobFile } from "../cep.ts";
import type { BasemapSource } from "../basemap/basemapStyle.ts";
import { autoLabels, type AutoLabelResult } from "../labels/autoLabels.ts";
import { addPin, createMapComp } from "../mapApi.ts";
import { addCallout, addRoute } from "../overlays/routeCallout.ts";

export type City = { name: string; lat: number; lng: number; view: View; title: string; subtitle: string };

export const PARIS: City = {
  name: "Eiffel Tower",
  lat: 48.85837,
  lng: 2.294481,
  view: { center: { lat: 48.8566, lng: 2.2986 }, zoom: 15.1, bearing: 32, pitch: 58 },
  title: "Paris",
  subtitle: "Tour Eiffel · 330 m"
};

export const TOKYO: City = {
  name: "Tokyo Tower",
  lat: 35.65858,
  lng: 139.74543,
  view: { center: { lat: 35.6605, lng: 139.7482 }, zoom: 14.6, bearing: -25, pitch: 55 },
  title: "東京",
  subtitle: "Tokyo · 東京タワー"
};

export type WorldFlightOptions = {
  width?: number;
  height?: number;
  frameRate?: number;
  basemap: BasemapSource;
  second?: City;
  /** Ends the first flight above Paris instead of in the street (when there is no region data for it). */
  firstZoom?: number;
  /** Ends the second flight above the city instead of in the street (when there is no region data for it). */
  secondZoom?: number;
};

export type WorldFlightResult = { mapId: string; sceneName: string; frames: number; labels: AutoLabelResult; expressionErrors: string[] };

export async function buildWorldFlight(options: WorldFlightOptions, log: (line: string) => void = () => undefined): Promise<WorldFlightResult> {
  const t0 = performance.now();
  const lap = (what: string) => log(`${what} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;
  const fps = options.frameRate ?? 25;
  const viewport = { width, height };
  const second = options.second ?? TOKYO;
  // Views are framed for 1080 lines; taller comps zoom in by the same factor, so 4K shows the same shot.
  const zoomOffset = Math.log2(height / 1080);
  const framed = (view: View): View => ({ ...view, zoom: view.zoom + zoomOffset });
  const above = (city: City, zoom: number | undefined): View => (zoom ? { ...city.view, zoom, pitch: Math.min(city.view.pitch, 35) } : city.view);
  const parisView = framed(above(PARIS, options.firstZoom));
  const secondView = framed(above(second, options.secondZoom));
  // A globe that fills about two thirds of the frame height.
  const globeZoom = Math.log2(((height * 0.36 * 2 * Math.PI) / 512) * Math.cos(30 * (Math.PI / 180)));
  const space1: View = { center: { lat: 24, lng: -32 }, zoom: globeZoom, bearing: 0, pitch: 0 };
  const space2: View = { center: { lat: 34, lng: -4 }, zoom: globeZoom + 0.25, bearing: 0, pitch: 0 };
  const orbitEnd: View = { ...parisView, bearing: parisView.bearing + 40, zoom: parisView.zoom + 0.15 };
  const duration = 36;

  log("creating the map comp");
  const map = await createMapComp({ name: "World flight", width, height, duration, frameRate: fps, view: space1, newScene: true, projection: "globe" });
  await callHost("setMapSettings", { mapId: map.id, basemap: options.basemap, render: { scale: 1, supersample: 2, motionBlur: false, motionBlurSamples: 8, passes: ["base"], labels: false } });

  lap("map comp created");
  const linear = (t: number) => t;
  const segments: FlightKey[][] = [
    flightKeys(space1, space2, viewport, { duration: 6, frameRate: fps, startTime: 0, easing: linear, pitchDip: false }),
    flightKeys(space2, parisView, viewport, { duration: 10, frameRate: fps, startTime: 6 }),
    flightKeys(parisView, orbitEnd, viewport, { duration: 5, frameRate: fps, startTime: 16, easing: linear, pitchDip: false }),
    flightKeys(orbitEnd, secondView, viewport, { duration: 12, frameRate: fps, startTime: 21 })
  ];
  // Segments share their boundary frames; keep the first copy of each.
  const keys: FlightKey[] = [];
  for (const segment of segments) for (const key of segment) if (!keys.length || key.time > keys[keys.length - 1].time + 1e-6) keys.push(key);
  // Keep the longitude continuous across segments (flights may have unwrapped it).
  for (let i = 1; i < keys.length; i++) {
    const previous = keys[i - 1].view.center.lng;
    keys[i].view.center.lng += 360 * Math.round((previous - keys[i].view.center.lng) / 360);
  }
  await callHostWithJobFile("setViewKeys", {
    mapId: map.id,
    times: keys.map((k) => k.time),
    views: keys.map((k) => [k.view.center.lat, k.view.center.lng, k.view.zoom, k.view.bearing, k.view.pitch])
  });
  await callHost("setControlKeys", { mapId: map.id, name: "Borders Draw-on", times: [0.4, 4.8], values: [0, 100] });
  await callHost("addBackground", { mapId: map.id });

  const errors: string[] = [];
  lap("camera, borders and background keyed");
  const f = (seconds: number) => Math.round(seconds * fps);
  const route = await addRoute(map.id, PARIS, second, { name: `Route: Paris to ${second.subtitle.split(" ·")[0]}`, startFrame: f(22), endFrame: f(31.5) });
  errors.push(...route.expressionErrors);
  for (const [city, show, hide] of [
    [PARIS, 16.2, 21.4],
    [second, 32.2, 36]
  ] as [City, number, number][]) {
    const pin = await addPin(map.id, city, { name: city.name, style: { radius: 9 * (height / 1080), color: [1, 0.55, 0.2], strokeColor: [1, 1, 1], strokeWidth: 3 * (height / 1080) } });
    errors.push(...pin.expressionErrors);
    await callHost("keyLayer", {
      mapId: map.id,
      layerName: pin.name,
      property: "opacity",
      keys: [
        [f(show) - 1, 0],
        [f(show) + 6, 100],
        [f(hide) - 6, 100],
        [f(hide), 0]
      ]
    });
    const callout = await addCallout(map.id, city, city.title, city.subtitle, { inFrame: f(show + 0.3), outFrame: f(hide) });
    errors.push(...callout.expressionErrors);
  }

  lap("route, pins and callouts added");
  // Keep labels clear of the pins and callouts (with their fade margins), scaled to the comp.
  const s = height / 1080;
  const keepOut = (
    [
      [PARIS, 16.2, 21.4],
      [second, 32.2, 36]
    ] as [City, number, number][]
  ).map(([city, show, hide]) => ({ lat: city.lat, lng: city.lng, fromFrame: f(show) - 12, toFrame: f(hide) + 12, dx: -40 * s, dy: -260 * s, width: 520 * s, height: 300 * s }));
  const labels = await autoLabels(map.id, { placeMaxZoom: 9.5 + zoomOffset, maxLabels: 140, keepOut });
  errors.push(...labels.expressionErrors);
  lap(`labels: ${labels.labels} (${labels.layers} layers) from ${labels.candidates} candidates in ${labels.seconds.toFixed(1)} s`);
  return { mapId: map.id, sceneName: map.sceneCompName, frames: duration * fps, labels, expressionErrors: errors };
}
