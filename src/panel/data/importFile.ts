// Reads a file the user picked and turns it into lines, places and areas:
//   GPX, KML       through @tmcw/togeojson (it needs a DOM document, which the panel has)
//   KMZ            a zip with a KML inside (fflate)
//   CSV, TSV, TXT  a table of places or track points (papaparse, then core's importTable)
//   ZIP, SHP       a zipped shapefile, or a lone .shp (shpjs; a .prj inside the zip is honoured)
//   GeoJSON, JSON  as they are

import { gpx, kml } from "@tmcw/togeojson";
import { unzipSync } from "fflate";
import Papa from "papaparse";
import { combine, parseDbf, parseShp } from "shpjs";
import { importGeoJson, type Imported } from "../../core/data/importLines.ts";
import { readDataTable, type DataTable } from "../../core/data/dataTable.ts";
import { importTable, MAX_TABLE_ROWS } from "../../core/data/importTable.ts";

export const IMPORT_ACCEPT = ".gpx,.kml,.kmz,.geojson,.json,.csv,.tsv,.txt,.zip,.shp";
/** Larger files are refused: they would stall the panel while parsing. */
export const MAX_IMPORT_BYTES = 60 * 1048576;

const extensionOf = (name: string) => (name.split(".").pop() ?? "").toLowerCase();

function xmlToGeoJson(text: string, kind: "gpx" | "kml", fileName: string): unknown {
  const document = new DOMParser().parseFromString(text, "text/xml");
  if (document.getElementsByTagName("parsererror").length) throw new Error(`${fileName} is not valid XML`);
  return kind === "gpx" ? gpx(document) : kml(document);
}

/** The files of a zip that matter here (names in lower case), unpacked. */
function unzip(bytes: Uint8Array, fileName: string): Record<string, Uint8Array> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (entry) => /\.(kml|shp|dbf|prj|cpg)$/i.test(entry.name) && !entry.name.includes("__MACOSX") });
  } catch {
    throw new Error(`${fileName} is not a readable zip file`);
  }
  return Object.fromEntries(Object.entries(files).map(([name, data]) => [name.toLowerCase(), data]));
}

function zipToGeoJson(bytes: Uint8Array, fileName: string): unknown {
  const files = unzip(bytes, fileName);
  const names = Object.keys(files);
  // A KMZ keeps its main document at the top, usually as doc.kml.
  const kmlName = names.filter((n) => n.endsWith(".kml")).sort((a, b) => a.split("/").length - b.split("/").length)[0];
  if (kmlName) return xmlToGeoJson(new TextDecoder().decode(files[kmlName]), "kml", fileName);
  const shapes = names.filter((n) => n.endsWith(".shp"));
  if (!shapes.length) throw new Error(`${fileName} holds no KML and no shapefile`);
  const features: unknown[] = [];
  for (const shape of shapes) {
    const base = shape.slice(0, -4);
    const prj = files[`${base}.prj`];
    const dbf = files[`${base}.dbf`];
    const collection = combine([parseShp(files[shape], prj ? new TextDecoder().decode(prj) : undefined), dbf ? parseDbf(dbf, files[`${base}.cpg`]) : undefined]);
    features.push(...collection.features);
  }
  return { type: "FeatureCollection", features };
}

/** What a file held: lines, places and areas, or - for a CSV of numbers about countries - a table. */
export type ImportedFile = Imported & { fileName: string; table?: DataTable };

export async function importFile(file: File): Promise<ImportedFile> {
  if (file.size > MAX_IMPORT_BYTES) throw new Error(`${file.name} is ${(file.size / 1048576).toFixed(0)} MB; files up to ${MAX_IMPORT_BYTES / 1048576} MB can be imported`);
  const extension = extensionOf(file.name);
  let imported: Imported;
  if (extension === "csv" || extension === "tsv" || extension === "txt") {
    const parsed = Papa.parse<string[]>(await file.text(), { skipEmptyLines: "greedy", preview: MAX_TABLE_ROWS + 50 });
    imported = importTable(parsed.data, file.name);
    if (!imported.lines.length && !imported.places.length) {
      // No coordinates: a table of numbers about countries, which colours the map instead.
      const table = readDataTable(parsed.data, file.name);
      if (table) return { lines: [], places: [], areas: [], skipped: 0, fileName: file.name, table };
      throw new Error(`${file.name}: no latitude and longitude columns found (name them lat and lng, or latitude and longitude), and no column of numbers to colour countries by`);
    }
  } else {
    let data: unknown;
    if (extension === "kmz" || extension === "zip") data = zipToGeoJson(new Uint8Array(await file.arrayBuffer()), file.name);
    else if (extension === "shp") data = combine([parseShp(await file.arrayBuffer(), undefined), undefined]);
    else if (extension === "gpx" || extension === "kml") data = xmlToGeoJson(await file.text(), extension, file.name);
    else {
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error(`${file.name} is not valid JSON`);
      }
    }
    imported = importGeoJson(data, file.name);
    if (!imported.lines.length && !imported.places.length) throw new Error(`${file.name} holds no lines or places`);
  }
  return { ...imported, fileName: file.name };
}
