// Panel-side wrappers around host functions that need core maths first.

import { pinExpressions } from "../core/ae/pinExpressions.ts";
import type { View } from "../core/camera/camera.ts";
import { callHost, callHostWithJobFile } from "./cep.ts";

export type CreatedMap = { id: string; mapCompId: number; mapCompName: string; sceneCompId: number; sceneCompName: string; layerIndex: number };

export function createMapComp(options: { name?: string; width?: number; height?: number; duration?: number; frameRate?: number; view: View; newScene?: boolean }): Promise<CreatedMap> {
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
    expressions: pinExpressions(position.lat, position.lng)
  });
}
