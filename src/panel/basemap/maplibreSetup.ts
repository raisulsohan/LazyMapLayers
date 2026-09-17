// One-time MapLibre setup inside CEP: worker from a blob (file:// pages cannot start module workers
// from disk) and the pmtiles:// protocol backed by local archives.

import * as maplibregl from "maplibre-gl";
import { PMTiles, Protocol } from "pmtiles";
import { extensionRoot, fs, isInCep, path, userDataDir } from "../cep.ts";
import { NodeFileSource } from "./nodeFileSource.ts";

let workerReady = false;
let protocol: Protocol | null = null;

export function ensureMaplibreWorker(): void {
  if (workerReady) return;
  if (isInCep()) {
    const workerFile = path().join(extensionRoot(), "panel", "maplibre-worker.js");
    const code = fs().readFileSync(workerFile, "utf8");
    const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    maplibregl.setWorkerUrl(url);
  }
  workerReady = true;
}

/** Registers a local .pmtiles archive and returns the style URL for it. */
export function registerLocalArchive(key: string, filePath: string): string {
  if (!protocol) {
    protocol = new Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);
  }
  if (!protocol.get(`pmtiles://${key}`) && !protocol.tiles.has(key)) {
    protocol.add(new PMTiles(new NodeFileSource(filePath, key)));
  }
  return `pmtiles://${key}`;
}

/** Downloaded OpenStreetMap regions live in the user's data folder, not in the extension. */
export function regionArchivePath(name: string): string {
  return path().join(userDataDir(), "regions", `${name}.pmtiles`);
}

export function naturalEarthArchivePath(): string {
  return path().join(extensionRoot(), "data", "natural-earth.pmtiles");
}
