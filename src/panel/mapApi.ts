// Panel-side wrappers around host functions that need core maths first.

import { cameraRigExpressions, groundFrameFor, pin3dPositionExpression } from "../core/ae/cameraRig.ts";
import { pinExpressions } from "../core/ae/pinExpressions.ts";
import type { View } from "../core/camera/camera.ts";
import { callHost, callHostWithJobFile } from "./cep.ts";

export type CreatedMap = { id: string; mapCompId: number; mapCompName: string; sceneCompId: number; sceneCompName: string; layerIndex: number };

export function createMapComp(options: {
  name?: string;
  width?: number;
  height?: number;
  duration?: number;
  frameRate?: number;
  view: View;
  newScene?: boolean;
  projection?: "mercator" | "globe";
}): Promise<CreatedMap> {
  return callHost<CreatedMap>("createMapComp", options);
}

export function setView(mapId: string, view: View, keyframe: boolean): Promise<boolean> {
  return callHost<boolean>("setView", { mapId, view, keyframe });
}

export type AddedPin = { layerIndex: number; name: string; sceneCompId: number; expressionErrors: string[] };

export function addPin(
  mapId: string,
  position: { lat: number; lng: number },
  options: {
    name?: string;
    scaleWithMap?: boolean;
    rotateWithMap?: boolean;
    /** A 3D layer on the ground plane of the map's 3D camera (see addCameraRig). */
    threeD?: boolean;
    altitude?: number;
    style?: { radius?: number; color?: [number, number, number]; fill?: boolean; strokeColor?: [number, number, number]; strokeWidth?: number };
  } = {}
): Promise<AddedPin> {
  return callHostWithJobFile<AddedPin>("addPin", {
    mapId,
    lat: position.lat,
    lng: position.lng,
    name: options.name,
    scaleWithMap: options.scaleWithMap ?? false,
    rotateWithMap: options.rotateWithMap ?? false,
    style: options.style,
    threeD: options.threeD ?? false,
    altitude: options.altitude ?? 0,
    expressions: options.threeD ? { position: pin3dPositionExpression(position.lat, position.lng) } : pinExpressions(position.lat, position.lng)
  });
}

export type AddedCameraRig = {
  created: boolean;
  cameraName: string;
  targetName: string;
  referenceZoom: number;
  expressionErrors: string[];
  warnings: string[];
};

/**
 * Adds an After Effects 3D camera that matches the rendered map, so 3D layers on the ground plane
 * line up with it. The ground origin is the given view (normally the map's view at the current time).
 */
export function addCameraRig(mapId: string, view: View): Promise<AddedCameraRig> {
  const frame = groundFrameFor(view, { width: 0, height: 0 });
  return callHostWithJobFile<AddedCameraRig>("addCameraRig", {
    mapId,
    originLat: frame.origin.lat,
    originLng: frame.origin.lng,
    referenceZoom: frame.referenceZoom,
    expressions: cameraRigExpressions()
  });
}
