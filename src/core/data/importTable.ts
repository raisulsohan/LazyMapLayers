// A table of places or of track points (the rows of a CSV file) as lines and places. Columns are
// found by their headings (lat, latitude, lon, lng, longitude, x, y, name, time, or one column with
// both coordinates); a table without headings is read as "latitude, longitude" next to a name.

import { lineLengthKm } from "../geo/simplify.ts";
import { parseCoordinates } from "../search/placeSearch.ts";
import { trackTimes, type Imported, type ImportedPlace } from "./importLines.ts";

/** Rows beyond this many are skipped: the panel stays light, and no animation needs more. */
export const MAX_TABLE_ROWS = 50000;
/** A table without names and with more rows than this is a track: a line, not a crowd of pins. */
const TRACK_ROWS = 25;

const UNIT = "(_?(deg|degrees|dd|decimal|wgs84))?";
const LAT = new RegExp("^(lat|latitude|y|breite|breitengrad|latitud|latitudine)" + UNIT + "$");
const LNG = new RegExp("^(lng|lon|long|longitude|x|laenge|länge|längengrad|longitud|longitudine)" + UNIT + "$");
const BOTH = /^(coordinates?|coords?|lat_?l(ng|on)|latlong|location|position|gps|point)$/;
const NAME = /^(name|title|label|place|city|town|station|stop|airport|address|description|desc)$/;
const TIME = /^(time|timestamp|utc|date|datetime|date_?time|recorded_?at|when)$/;

const heading = (cell: string) =>
  cell
    .trim()
    .toLowerCase()
    .replace(/[().:]/g, "")
    .trim()
    .replace(/[\s-]+/g, "_");

/** Dates and clock times, which must not be taken for names. */
const looksLikeTime = (cell: string) => /^\d{4}-\d\d-\d\d|^\d{1,2}:\d\d|^\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}/.test(cell.trim());

/** A coordinate written as 48.85, "48,85", 48.85°, N48.85 or 48.85 S. */
export function toDegrees(cell: string): number {
  const match = /^([NSEW])?\s*([+-]?\d+(?:[.,]\d+)?)\s*°?\s*([NSEW])?$/i.exec(cell.trim());
  if (!match) return NaN;
  const value = Number(match[2].replace(",", "."));
  const side = (match[1] ?? match[3] ?? "").toUpperCase();
  return side === "S" || side === "W" ? -Math.abs(value) : value;
}

export function importTable(rows: string[][], fileName = "Table"): Imported {
  const result: Imported = { lines: [], places: [], areas: [], skipped: 0 };
  const base = fileName.replace(/\.[^.]+$/, "") || "Table";
  const filled = rows.filter((row) => row.some((cell) => cell.trim() !== ""));
  if (!filled.length) return result;

  // Columns from the headings, when the first row has any we know.
  const heads = filled[0].map(heading);
  let lat = heads.findIndex((h) => LAT.test(h));
  let lng = heads.findIndex((h) => LNG.test(h));
  let both = lat < 0 || lng < 0 ? heads.findIndex((h) => BOTH.test(h)) : -1;
  const hasHeadings = (lat >= 0 && lng >= 0) || both >= 0;
  let name = hasHeadings ? heads.findIndex((h) => NAME.test(h)) : -1;
  const time = hasHeadings ? heads.findIndex((h) => TIME.test(h)) : -1;
  let data = hasHeadings ? filled.slice(1) : filled;
  if (!hasHeadings) {
    // No headings we know: the first two cells that read as coordinates, in the order latitude,
    // longitude, in the first row that has them (rows before it are headings in other words).
    const numericCells = (row: string[]) => row.map((cell, i) => (Number.isFinite(toDegrees(cell)) ? i : -1)).filter((i) => i >= 0);
    const probe = data.slice(0, 5).findIndex((row) => numericCells(row).length >= 2 || row.some((cell) => parseCoordinates(cell) !== null));
    if (probe < 0) {
      result.skipped = data.length;
      return result;
    }
    data = data.slice(probe);
    const sample = data[0];
    const numeric = numericCells(sample);
    if (numeric.length >= 2) {
      lat = numeric[0];
      lng = numeric[1];
      // A first value that cannot be a latitude means the file is written longitude first.
      if (Math.abs(toDegrees(sample[lat])) > 90) [lat, lng] = [lng, lat];
    } else both = sample.findIndex((cell) => parseCoordinates(cell) !== null);
  }
  if (name < 0) {
    // No name heading: the first column of words that differ from row to row (a flight's call sign,
    // the same in every row, names nothing).
    const sample = data.slice(0, 20);
    name = (data[0] ?? []).findIndex((cell, i) => {
      if (i === lat || i === lng || i === both || i === time || cell.trim() === "" || Number.isFinite(toDegrees(cell)) || looksLikeTime(cell)) return false;
      return sample.length === 1 || sample.some((row) => (row[i] ?? "").trim() !== cell.trim());
    });
  }

  const places: ImportedPlace[] = [];
  const rawTimes: unknown[] = [];
  const limit = Math.min(data.length, MAX_TABLE_ROWS);
  result.skipped += data.length - limit;
  for (let r = 0; r < limit; r++) {
    const row = data[r];
    let position: { lat: number; lng: number } | null = null;
    if (both >= 0) position = parseCoordinates(row[both] ?? "");
    else {
      const y = toDegrees(row[lat] ?? "");
      const x = toDegrees(row[lng] ?? "");
      if (Number.isFinite(y) && Number.isFinite(x) && Math.abs(y) <= 90 && Math.abs(x) <= 360) position = { lat: y, lng: x };
    }
    if (!position) {
      result.skipped++;
      continue;
    }
    const label = name >= 0 ? (row[name] ?? "").trim().slice(0, 80) : "";
    places.push({ name: label || `${base} ${places.length + 1}`, lat: position.lat, lng: position.lng });
    rawTimes.push(time >= 0 ? row[time] : undefined);
  }

  // The rows in order as a line: a journey from place to place, or a recorded track.
  const isTrack = name < 0 && places.length > TRACK_ROWS;
  if (places.length >= 2) {
    const points: { lat: number; lng: number }[] = [];
    const first: number[] = [];
    const last: number[] = [];
    places.forEach((p, i) => {
      const previous = points[points.length - 1];
      if (previous && previous.lat === p.lat && previous.lng === p.lng) last[last.length - 1] = i;
      else {
        points.push({ lat: p.lat, lng: p.lng });
        first.push(i);
        last.push(i);
      }
    });
    if (points.length >= 2) {
      const timed = time >= 0 ? trackTimes(rawTimes, places.length, first, last) : undefined;
      result.lines.push({ name: isTrack ? base : `${base} (rows in order)`, points, closed: false, lengthKm: lineLengthKm(points), ...timed });
    }
  }
  if (!isTrack) result.places = places;
  return result;
}
