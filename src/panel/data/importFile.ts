// Reads a GPX, KML or GeoJSON file the user picked and turns it into lines and places.
// GPX and KML go through @tmcw/togeojson (it needs a DOM document, which the panel has).

import { gpx, kml } from "@tmcw/togeojson";
import { importGeoJson, type Imported } from "../../core/data/importLines.ts";

export const IMPORT_ACCEPT = ".gpx,.kml,.geojson,.json";
/** Larger files are refused: they would stall the panel while parsing. */
export const MAX_IMPORT_BYTES = 60 * 1048576;

export async function importFile(file: File): Promise<Imported & { fileName: string }> {
  if (file.size > MAX_IMPORT_BYTES) throw new Error(`${file.name} is ${(file.size / 1048576).toFixed(0)} MB; files up to ${MAX_IMPORT_BYTES / 1048576} MB can be imported`);
  const text = await file.text();
  const extension = (file.name.split(".").pop() ?? "").toLowerCase();
  let data: unknown;
  if (extension === "gpx" || extension === "kml") {
    const document = new DOMParser().parseFromString(text, "text/xml");
    if (document.getElementsByTagName("parsererror").length) throw new Error(`${file.name} is not valid XML`);
    data = extension === "gpx" ? gpx(document) : kml(document);
  } else {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`${file.name} is not valid JSON`);
    }
  }
  const imported = importGeoJson(data, file.name);
  if (!imported.lines.length && !imported.places.length) throw new Error(`${file.name} holds no lines or places`);
  return { ...imported, fileName: file.name };
}
