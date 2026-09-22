// Districts (second-level units: districts, counties, departments) are not part of the panel: there are
// too many for a bundle, and every country publishes its own. They are downloaded per country, when
// the user asks, from geoBoundaries' open release (gbOpen: licences that allow commercial use with
// credit), thinned together and kept in the user data folder:
//
//   <user data>/boundaries/manifest.json      the installed sets: source, licence, and each unit's
//                                             name, label point and bounds (what search needs)
//   <user data>/boundaries/<ISO>-ADM2.json    a set's polygons

import { buildBoundarySet, boundaryRecords, type BoundarySetInfo, type BoundaryUnit } from "../../core/data/boundarySet.ts";
import type { JoinTarget } from "../../core/data/join.ts";
import { pointInPolygons } from "../../core/geo/pointInPolygon.ts";
import type { PlaceRecord } from "../../core/search/placeSearch.ts";
import { fs, path, userDataDir } from "../cep.ts";
import { provinceAt } from "./admin1.ts";
import { httpsRequest } from "../net.ts";

const API = "https://www.geoboundaries.org/api/current/gbOpen";
const LEVEL = "ADM2";

/** What geoBoundaries offers for a country, before anything large is downloaded. */
export type DistrictOffer = { iso: string; unit: string; count: number; source: string; license: string; licenseSource: string; url: string; sizeBytes: number | null };

const folder = () => path().join(userDataDir(), "boundaries");
const manifestPath = () => path().join(folder(), "manifest.json");
const setPath = (iso: string) => path().join(folder(), `${iso}-${LEVEL}.json`);

let manifest: BoundarySetInfo[] | null = null;
const loaded = new Map<string, BoundaryUnit[]>();

export function installedDistricts(): BoundarySetInfo[] {
  if (manifest) return manifest;
  manifest = [];
  try {
    const stored = JSON.parse(fs().readFileSync(manifestPath(), "utf8")) as { sets?: BoundarySetInfo[] };
    manifest = (stored.sets ?? []).filter((set) => set && typeof set.iso === "string" && Array.isArray(set.units) && fs().existsSync(setPath(set.iso)));
  } catch {
    // Nothing installed yet.
  }
  return manifest;
}

/** The installed set of a country (by its code in the world data), or null. */
export const districtSetOf = (country: string): BoundarySetInfo | null => installedDistricts().find((set) => set.country === country) ?? null;

export function districtsOf(country: string): BoundaryUnit[] {
  const set = districtSetOf(country);
  if (!set) return [];
  const cached = loaded.get(set.iso);
  if (cached) return cached;
  let features: BoundaryUnit[] = [];
  try {
    features = (JSON.parse(fs().readFileSync(setPath(set.iso), "utf8")) as { features: BoundaryUnit[] }).features;
  } catch {
    features = [];
  }
  loaded.set(set.iso, features);
  return features;
}

export function districtAt(country: string, position: { lat: number; lng: number }): BoundaryUnit | null {
  return districtsOf(country).find((unit) => pointInPolygons(position, unit.polygons)) ?? null;
}

/** Every way of naming a district of a country whose districts are downloaded, for joining a table to them. */
export function districtJoinTargets(country: string): JoinTarget[] {
  const set = districtSetOf(country);
  return set ? set.units.map((unit) => ({ code: unit.id, codes: [], names: [unit.n] })) : [];
}

/** Where a district's name sits, for putting something on it. */
export function districtPoint(country: string, id: string): { lat: number; lng: number; name: string } | null {
  const unit = districtSetOf(country)?.units.find((entry) => entry.id === id);
  return unit ? { lat: unit.lat, lng: unit.lng, name: unit.n } : null;
}

/** Installed districts as search records. */
export function districtRecords(): PlaceRecord[] {
  try {
    return installedDistricts().flatMap(boundaryRecords);
  } catch {
    return [];
  }
}

/** Asks geoBoundaries what it has for a country: a few kilobytes of metadata and the file's size. */
export async function findDistricts(iso: string, signal?: AbortSignal): Promise<DistrictOffer | null> {
  if (!/^[A-Z]{3}$/.test(iso)) return null;
  const answer = await httpsRequest(`${API}/${iso}/${LEVEL}/`, { signal });
  if (answer.status === 404) return null;
  if (answer.status !== 200) throw new Error(`geoBoundaries answered HTTP ${answer.status}`);
  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(new TextDecoder().decode(answer.body)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const url = String(meta.simplifiedGeometryGeoJSON ?? meta.gjDownloadURL ?? "");
  if (!/^https:\/\//.test(url)) return null;
  let sizeBytes: number | null = null;
  try {
    const head = await httpsRequest(url, { method: "HEAD", signal });
    sizeBytes = Number(head.headers["content-length"]) || null;
  } catch {
    // The size is a courtesy; the download can still go ahead.
  }
  const text = (value: unknown) => (typeof value === "string" && value !== "nan" ? value : "");
  return {
    iso,
    unit: text(meta.boundaryCanonical).toLowerCase() || "district",
    count: Number(meta.admUnitCount) || 0,
    source: text(meta.boundarySource),
    license: text(meta.boundaryLicense),
    licenseSource: text(meta.licenseSource),
    url,
    sizeBytes
  };
}

/** Downloads a country's districts, thins them together and installs them. */
export async function installDistricts(
  offer: DistrictOffer,
  country: { code: string; name: string },
  options: { signal?: AbortSignal; onProgress?: (done: number, total: number | null) => void } = {}
): Promise<BoundarySetInfo> {
  const answer = await httpsRequest(offer.url, { signal: options.signal, onProgress: options.onProgress });
  if (answer.status !== 200) throw new Error(`the download answered HTTP ${answer.status}`);
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(answer.body));
  } catch {
    throw new Error("the downloaded file is not GeoJSON");
  }
  const built = buildBoundarySet(data, {
    iso: offer.iso,
    country: country.code,
    countryName: country.name,
    level: LEVEL,
    unit: offer.unit,
    source: offer.source,
    license: offer.license,
    licenseSource: offer.licenseSource,
    downloaded: new Date().toISOString().slice(0, 10)
  });
  // The province each unit lies in (from the bundled province data) tells equal names apart in search.
  for (const unit of built.info.units) {
    const province = provinceAt(country.code, { lat: unit.lat, lng: unit.lng });
    if (province && province.name !== unit.n) unit.p = province.name;
  }
  const nodeFs = fs();
  nodeFs.mkdirSync(folder(), { recursive: true });
  const write = (file: string, value: unknown) => {
    const temporary = `${file}.${process.pid}.tmp`;
    nodeFs.writeFileSync(temporary, JSON.stringify(value));
    nodeFs.renameSync(temporary, file);
  };
  write(setPath(offer.iso), { v: 1, iso: offer.iso, level: LEVEL, source: `geoBoundaries gbOpen: ${offer.source}`, license: offer.license, features: built.features });
  const sets = [...installedDistricts().filter((set) => set.iso !== offer.iso), built.info].sort((a, b) => a.countryName.localeCompare(b.countryName));
  write(manifestPath(), { v: 1, sets });
  manifest = sets;
  loaded.set(offer.iso, built.features);
  return built.info;
}

export function removeDistricts(iso: string): void {
  const sets = installedDistricts().filter((set) => set.iso !== iso);
  fs().rmSync(setPath(iso), { force: true });
  fs().writeFileSync(manifestPath(), JSON.stringify({ v: 1, sets }));
  manifest = sets;
  loaded.delete(iso);
}
