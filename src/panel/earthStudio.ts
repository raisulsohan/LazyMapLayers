// Bringing a Google Earth Studio camera into After Effects: the panel makes a scene the size and
// length of that render, keys this map's camera to their camera frame by frame, and marks their
// track points with pins. Drop the Earth Studio footage into the scene and every layer the panel
// makes from then on - names, pins, routes, outlines, highlights - sits on it.

import { parseEarthStudio, viewOfFrame, type EarthStudioProject } from "../core/earth/earthStudio.ts";
import type { View } from "../core/camera/camera.ts";
import { callHostWithJobFile } from "./cep.ts";
import { addPin, createMapComp, type CreatedMap } from "./mapApi.ts";

export type EarthStudioImport = {
  project: EarthStudioProject;
  map: CreatedMap;
  views: View[];
  keys: number;
  pins: number;
  /** How far the camera is tilted at its most, so the panel can warn when the match will be loose. */
  mostPitch: number;
};

export type EarthStudioOptions = {
  /** A name for the map comp; the project's own name by default. */
  name?: string;
  /** Pins on the track points, named as they were named in Earth Studio. */
  pinTrackPoints?: boolean;
  /** The scene the map goes into; a new one by default. */
  newScene?: boolean;
  onProgress?: (done: number, total: number) => void;
};

/** How many camera keys go into After Effects in one call. */
const BATCH = 300;

/**
 * Reads the tracking file and builds the map. The text is whatever the user picked - this throws with
 * a plain reason when it is not an Earth Studio export.
 */
export async function importEarthStudio(text: string, options: EarthStudioOptions = {}): Promise<EarthStudioImport> {
  const project = parseEarthStudio(text);
  const views = project.frames.map((frame) => viewOfFrame(frame, project.height));
  const seconds = project.frames.length / project.frameRate;
  const map = await createMapComp({
    name: options.name?.trim() || project.name,
    width: project.width,
    height: project.height,
    duration: Math.max(1 / project.frameRate, seconds),
    frameRate: project.frameRate,
    view: views[0],
    newScene: options.newScene ?? true
  });

  let keys = 0;
  for (let at = 0; at < views.length; at += BATCH) {
    const slice = views.slice(at, at + BATCH);
    await callHostWithJobFile("setViewKeys", {
      mapId: map.id,
      times: slice.map((_, i) => (at + i) / project.frameRate),
      views: slice.map((view) => [view.center.lat, view.center.lng, view.zoom, view.bearing, view.pitch])
    });
    keys += slice.length;
    options.onProgress?.(keys, views.length);
  }

  let pins = 0;
  if (options.pinTrackPoints !== false) {
    for (const point of project.trackPoints) {
      await addPin(map.id, { lat: point.lat, lng: point.lng }, { name: point.name, style: point.color ? { color: hexToUnit(point.color) } : undefined });
      pins++;
    }
  }

  return { project, map, views, keys, pins, mostPitch: views.reduce((most, view) => Math.max(most, view.pitch), 0) };
}

/** "#148fbc" as the 0-to-1 colour After Effects wants. */
function hexToUnit(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const value = Number.parseInt(clean.length === 3 ? clean.replace(/./g, (c) => c + c) : clean, 16);
  if (!Number.isFinite(value)) return [0.21, 0.7, 1];
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}
