// Panel state (signals) and the actions behind the buttons. Components only read signals and call
// these functions; every talk with After Effects happens here. Nothing polls After Effects: maps are
// read when the panel gets the focus and after the panel's own actions.

import { computed, effect, signal } from "@preact/signals";
import type { View } from "../core/camera/camera.ts";
import { fitBounds, fitPoints } from "../core/camera/fit.ts";
import { importGeoJson } from "../core/data/importLines.ts";
import type { ImportedArea, ImportedLine, ImportedPlace } from "../core/data/importLines.ts";
import { simplifyPolygons } from "../core/geo/simplify.ts";
import { keyOf } from "../core/render/frameKey.ts";
import type { MapProjection } from "../core/camera/globe.ts";
import { NAME_LANGUAGES, SCRIPT_FONTS, type NameLanguage } from "../core/labels/language.ts";
import type { ExtractPlan } from "../core/pmtiles/extract.ts";
import { PASS_IDS, type PassId } from "../core/render/passes.ts";
import { DEFAULT_FINAL_SETTINGS, PREVIEW_SETTINGS, normaliseSettings, type RenderQuality, type RenderSettings } from "../core/render/plan.ts";
import { nameForView, nearestPlaceName, zoomForPlace, type SearchResult } from "../core/search/placeSearch.ts";
import { AREA_MAX_POINTS, AREA_PREFIX, DEFAULT_HIGHLIGHT, MAX_AREAS, areaIdOf, isAreaCode, normaliseAreas, normaliseHighlights, toggleHighlight, type AreaGeometry, type Areas, type Highlight } from "../core/style/highlights.ts";
import { DEFAULT_SHADE, normaliseTerrain, type TerrainSetting } from "../core/style/terrain.ts";
import { columnCategories, columnValues, isCategoryColumn, readDataTable, type DataTable } from "../core/data/dataTable.ts";
import { describeSeries, detectSeries, readSeries, type SeriesShape } from "../core/data/series.ts";
import type { CategoryPaletteId } from "../core/style/categories.ts";
import { flowRows, guessFlowColumns } from "../core/data/flows.ts";
import { addFlows } from "./overlays/flows.ts";
import { buildLookup, describeJoin, joinValues } from "../core/data/join.ts";
import { dataFillColors, describeDataFill, normaliseDataFill, DEFAULT_DATA_FILL, type DataFill } from "../core/style/dataFill.ts";
import { applyLook, followsTheLook as lookFollows, lookFromPalette, lookFromPicture, normaliseLook, NO_LOOK, type LookOverride } from "../core/style/customLook.ts";
import { lookFileName, readLookFile, writeLookFile } from "../core/style/lookFile.ts";
import { readSwatchFile } from "../core/style/swatchFile.ts";
import { bubbleSet, type BubblePlace } from "../core/style/bubbles.ts";
import { spikeSet } from "../core/style/spikes.ts";
import { dataShapes, DEFAULT_DATA_SHAPES, MAX_DATA_SHAPES } from "../core/style/dataShapes.ts";
import { formatValue } from "../core/style/valueScale.ts";
import { DEFAULT_HEAT, describeHeat, heatPoints, normaliseHeat, type HeatSetting } from "../core/style/heat.ts";
import { DEFAULT_DETAILS, normaliseDetails, type LookDetails } from "../core/style/lookDetails.ts";
import { describeOwnImagery, isTileAddress, normaliseOwnImagery, type OwnImagery } from "../core/style/ownImagery.ts";
import { imageryService, ownImageryFromService } from "../core/style/imageryCatalogue.ts";
import type { LegendCorner } from "../core/style/legend.ts";
import { RAMPS, type RampId, type ScaleMethod } from "../core/style/valueScale.ts";
import { countryCodeRows, countryJoinTargets } from "./data/countries.ts";
import { countryOfProvince, provinceJoinTargets, provincePoint } from "./data/admin1.ts";
import { areaKm2, centreOf, circleAround, combinedName, growArea, mergeAreas } from "../core/geo/combine.ts";
import { osmGeoJson, osmKind, type OsmBbox, type OsmKind } from "../core/data/overpass.ts";
import { checkBbox, searchOsm } from "./data/osm.ts";
import { addZones, normaliseKeepOut, togglePreset, type KeepOutPreset, type KeepOutZone } from "../core/labels/keepOut.ts";
import { labelTemplateFollowsLook, normaliseLabelTemplate, NO_LABEL_OVERRIDE, resolveLabelTemplate, templateFonts, type LabelTemplateOverride } from "../core/labels/labelTemplate.ts";
import { followsTheLook, normaliseLayerStyle, NO_OVERRIDE, resolveLayerStyle, type LayerStyleOverride } from "../core/style/layerStyle.ts";
import { DEFAULT_THEME_ID, hexToRgb, themeById } from "../core/style/themes.ts";
import { tileCount, tileRangeForBbox, type Bbox } from "../core/tiles/tileMath.ts";
import { regionNames, type BasemapSource } from "./basemap/basemapStyle.ts";
import { regionArchivePath } from "./basemap/maplibreSetup.ts";
import { callHost, fs as nodeFs, isInCep } from "./cep.ts";
import { provinceAt, provincesOf, type Province } from "./data/admin1.ts";
import { districtAt, districtJoinTargets, districtPoint, districtSetOf, districtsOf, findDistricts, installDistricts, installedDistricts, removeDistricts, type DistrictOffer } from "./data/districts.ts";
import { buildGeoJson, type ExportLayer } from "../core/data/geoJsonExport.ts";
import { countryOutline } from "./data/countries.ts";
import { placeIndex, resetPlaceIndex } from "./data/worldLabels.ts";
import { buildWorldFlight } from "./demo/worldFlight.ts";
import { autoLabels } from "./labels/autoLabels.ts";
import { addCameraRig, addPin, attachLayers, createMapComp, detachLayers, flyTo, selectionInfo, setView, type SelectionInfo } from "./mapApi.ts";
import { importFile } from "./data/importFile.ts";
import { addCallout, addRoute, addRouteLine } from "./overlays/routeCallout.ts";
import { addBubbles, removeBubbles } from "./overlays/bubbles.ts";
import { addSpikes, removeSpikes } from "./overlays/spikes.ts";
import { addChart, addLineChart, removeChart } from "./overlays/chart.ts";
import { addMinimap, addNorthArrow, addScaleBar, removeFurniture, removeMinimap, type FurnitureKind } from "./overlays/furniture.ts";
import { featureKeys, filterFeatures, parseFilter, type FeatureRow, applyFeatureEdits, editFeature, typedValue, type FeatureEdits } from "../core/data/featureList.ts";
import { featureCentre, featurePolygons, featureRows, type FeatureScope, type FeatureSources } from "./features.ts";
import { cutHole, explodeArea, pointsInside } from "../core/geo/shapeOps.ts";
import { addMesh } from "./overlays/mesh.ts";
import { importCsvText } from "./data/importFile.ts";
import { importEarthStudio } from "./earthStudio.ts";
import { buildSatellite, encodeTile as encodeSatelliteTile, isSatelliteName, listSatellitePacks, planSatellite, satellitePath, type SatellitePackInfo, type SatellitePlan } from "./imagery/sentinelBuild.ts";
import { SENTINEL_CREDIT } from "../core/imagery/sentinel.ts";
import { satelliteAddress, satelliteNameOf } from "../core/style/ownImagery.ts";
import type { ScaleUnits } from "../core/ae/mapFurniture.ts";
import { copyToPlaces } from "./overlays/copies.ts";
import { restyleLabels } from "./labels/restyleLabels.ts";
import { repositionLabels } from "./labels/repositionLabels.ts";
import { labelDesigns, type LabelDesign } from "./labels/labelDesigns.ts";
import { formatBytes, removeOldLooseRenders, renderDiskReport, type RenderDiskReport } from "./render/renderDisk.ts";
import { addValueLabels, removeValueLabels } from "./overlays/valueLabels.ts";
import { addLegend, removeLegend } from "./overlays/legend.ts";
import { addFeatureShape } from "./overlays/shapeFeature.ts";
import { compSize, compView, countryAt, pointOf, previewMap, setCompSize, setPreviewImport, setPreviewStyle, showCompView } from "./preview.ts";
import { openUrl } from "./cep.ts";
import { readPrefs, writePrefs } from "./prefs.ts";
import { issueUrl, newerVersion, RELEASES_URL, writeProblemReport, type Update } from "./updates.ts";
import { downloadRegion, listRegions, planRegion, safeRegionName, type RegionInfo } from "./regions.ts";
import { downloadTerrain, listTerrainPacks, planTerrain, type TerrainPackInfo } from "./terrain.ts";
import { samplerFor } from "./elevation.ts";
import { styleRgb } from "../core/style/layerStyle.ts";
import { downloadImagery, IMAGERY_INFO, type ImageryPack } from "./imagery/packs.ts";
import { describeSpec, renderQueue, type QueueJob } from "./render/renderQueue.ts";

export type LogKind = "ok" | "fail" | "muted";
export type LogLine = { text: string; kind?: LogKind };

export type MapEntry = {
  mapId: string;
  /** Which layer this is, across calls (31-duplicates.jsx keyOf). */
  layerKey?: string;
  mapCompName: string;
  sceneCompName: string;
  basemap: BasemapSource | null;
  isActiveScene: boolean;
  hasCamera: boolean;
  hasShots: boolean;
  projection: MapProjection;
  time: number;
  duration: number;
  layerStart: number;
  frameRate: number;
  width: number;
  height: number;
  render: Partial<RenderSettings> | null;
  /** The map's look (core/style/themes.ts). */
  theme: string | null;
  relief: boolean;
  sky?: boolean;
  terrain?: TerrainSetting | null;
  highlightLayers?: "each" | "one";
  layerStyle?: LayerStyleOverride | null;
  labelTemplate?: LabelTemplateOverride | null;
  labelDesign?: number | null;
  labelImages?: Record<string, string> | null;
  featureEdits?: FeatureEdits | null;
  keepOut?: KeepOutZone[] | null;
  osmData?: boolean;
  dataFill?: DataFill | null;
  heat?: { column: string; points: number } | null;
  look?: LookOverride | null;
  lookDetails?: LookDetails | null;
  ownImagery?: OwnImagery | null;
  highlights: Highlight[];
  view: View;
  /** "javascript-1.0" or "extendscript" (the project's expression engine). */
  expressionEngine: string | null;
};

export type Progress = { label: string; done: number; total: number; cancel?: () => void } | null;
/** The download sheet, for an OpenStreetMap region or for an elevation pack of the area in the preview. */
export type RegionSheet = { kind: "region" | "terrain"; name: string; maxZoom: number; bbox: Bbox; planned?: { plan: ExtractPlan; url: string; build: string } };
export type Screen = "main" | "maps" | "newMap" | "settings";
export type Tab = "shots" | "render";
/** A tool waits for clicks on the preview: a place for a pin or a callout, two places for a route. */
export type Tool = "none" | "pin" | "pin3d" | "callout" | "route" | "highlight" | "attach";
export type ToolSheet = { kind: "callout"; place: { lat: number; lng: number }; title: string; subtitle: string; seconds: number } | { kind: "route"; from: { lat: number; lng: number }; to: { lat: number; lng: number }; seconds: number };

export const LARGE_DOWNLOAD_BYTES = 200 * 1048576;
export const MAX_DOWNLOAD_BYTES = 2048 * 1048576;
export const DETAIL_ZOOMS = [10, 11, 12, 13, 14, 15];
/** Elevation tiles are 512 px wide: zoom 12 is about 20 m per pixel, which is what the open 30 m models hold. */
export const TERRAIN_DETAIL_ZOOMS = [7, 8, 9, 10, 11, 12];

export const LABEL_LANGUAGES: { value: string; label: string }[] = [
  { value: "local+en", label: "Local language + English" },
  { value: "local", label: "Local language only" },
  ...NAME_LANGUAGES.map((code) => ({ value: code, label: `All in ${code}` }))
];

export const logLines = signal<LogLine[]>([]);
export const logOpen = signal(false);
export const busy = signal(false);
export const progress = signal<Progress>(null);
export const maps = signal<MapEntry[]>([]);
export const selectedId = signal("");
export const regions = signal<RegionInfo[]>([]);
export const basemap = signal<BasemapSource>({ kind: "world" });
export const projection = signal<MapProjection>("mercator");
export const themeId = signal<string>(DEFAULT_THEME_ID);
/** Shaded relief over the land (needs the relief imagery pack). */
export const reliefOn = signal(false);
/** The sky above the horizon of a tilted flat map. */
export const skyOn = signal(true);
/** The map's elevation pack and shading, and the packs on this computer. */
export const terrain = signal<TerrainSetting | null>(null);
export const terrainPacks = signal<TerrainPackInfo[]>([]);
/** How the layers this map generates look; what is not set follows the map's look. */
export const layerStyle = signal<LayerStyleOverride>(NO_OVERRIDE);
/** The colours, stroke and glow the next pin, route, callout or traveller really gets. */
/** Colours of the user's own, on top of the look the map started from. */
export const lookOverride = signal<LookOverride>(NO_LOOK);
/** The look's smaller details: how heavy its lines are, how wide its roads, how many names it draws. */
export const lookDetails = signal<LookDetails>(DEFAULT_DETAILS);
/** Tiles of the user's own over the map (an XYZ address or a PMTiles archive), or none. */
export const ownImagery = signal<OwnImagery | null>(null);
/** The address as typed, so a half-typed one is not lost. */
export const ownImageryDraft = signal("");
/** The look the map really draws with. */
export const currentTheme = computed(() => applyLook(themeById(themeId.value), lookOverride.value));
export const lookFollowsTheme = computed(() => lookFollows(lookOverride.value));

export const currentLayerStyle = computed(() => resolveLayerStyle(currentTheme.value, layerStyle.value));
export const layerStyleFollowsLook = computed(() => followsTheLook(layerStyle.value));
/** How the names on this map look; what is not set follows the map's look. */
export const labelTemplate = signal<LabelTemplateOverride>(NO_LABEL_OVERRIDE);
export const currentLabelTemplate = computed(() => resolveLabelTemplate(currentTheme.value, labelTemplate.value));
export const labelTemplateFollows = computed(() => labelTemplateFollowsLook(labelTemplate.value));
/** Parts of the frame the names stay out of, such as the band a lower third sits in. */
export const keepOut = signal<KeepOutZone[]>([]);
/** Whether features from OpenStreetMap were brought into this map (they carry their own credit). */
export const osmData = signal(false);
/** Numbers on this map: a colour per country, from a table the user brought in. */
export const dataFill = signal<DataFill | null>(null);
/** Heat on the map: points that warm the map around them (stored with the map, on their own comment line). */
export const heat = signal<HeatSetting | null>(null);
export const heatRadius = signal(DEFAULT_HEAT.radius);
/** What the last imported file held (kept for this session; the layers made from it live in the project). */
export const imported = signal<{ fileName: string; lines: ImportedLine[]; places: ImportedPlace[]; areas: ImportedArea[]; skipped: number } | null>(null);
export const importSheetOpen = signal(false);

/** Highlighted countries of the selected map. */
export const highlights = signal<Highlight[]>([]);
/** Polygons of the custom areas among the highlights (stored with the map, on their own comment line). */
export const areas = signal<Areas>({});
const look = () => ({ theme: currentTheme.value, relief: reliefOn.value, highlights: highlights.value, areas: areas.value, data: dataFill.value, heat: heat.value, details: lookDetails.value, own: ownImagery.value, sky: skyOn.value, terrain: terrain.value });
export const view = signal<View | null>(null);
export const screen = signal<Screen>("main");
export const tab = signal<Tab>("shots");
export const tool = signal<Tool>("none");
export const toolFirstPoint = signal<{ lat: number; lng: number } | null>(null);
export const toolSheet = signal<ToolSheet | null>(null);
export const regionSheet = signal<RegionSheet | null>(null);
export const jobs = signal<QueueJob[]>([]);
export const flightSeconds = signal(6);
/** A bright head that runs along a new route while it draws on. */
export const routeComet = signal(false);
/** An arrow that rides a click-made route (imported lines have their own Draw + arrow button). */
export const routeArrow = signal(false);
/** New routes are drawn as a dashed line. */
export const routeDashed = signal(false);
/** Dash length in 1080-line pixels when a route is dashed. */
export const ROUTE_DASH = 14;
export const labelLanguage = signal("local+en");
/** How many names Auto labels may place: the most important ones come first. */
export const LABEL_DENSITIES = { few: { label: "Few (up to 20)", max: 20 }, normal: { label: "Normal (up to 45)", max: 45 }, many: { label: "Many (up to 120)", max: 120 } } as const;
export type LabelDensity = keyof typeof LABEL_DENSITIES;
export const labelDensity = signal<LabelDensity>("normal");
/** What Auto labels names: countries, cities, the water (seas, rivers, lakes) and the land (ranges, deserts, islands, peaks). */
export const LABEL_KINDS = [
  { id: "countries", name: "Countries", hint: "Country names" },
  { id: "places", name: "Cities", hint: "Capitals, cities and towns" },
  { id: "water", name: "Seas and rivers", hint: "Oceans, seas, bays, rivers, lakes and waterfalls, in italic in the colour of water" },
  { id: "land", name: "Mountains and deserts", hint: "Continents, mountain ranges, deserts, islands and regions in spaced capitals, and peaks with their height" },
  { id: "city", name: "Streets and landmarks", hint: "Inside a downloaded area: districts, parks, landmarks, stations, airports, the rivers through town and the main streets laid along them, from its own OpenStreetMap data" }
] as const;
export type LabelKind = (typeof LABEL_KINDS)[number]["id"];
export const labelKinds = signal<Record<LabelKind, boolean>>({ countries: true, places: true, water: true, land: true, city: true });
export const toggleLabelKind = (kind: LabelKind) => {
  const next = { ...labelKinds.value, [kind]: !labelKinds.value[kind] };
  // At least one kind stays on: placing nothing is never what was meant.
  if (Object.values(next).some(Boolean)) labelKinds.value = next;
};
/** A comp of the user's own put on every place instead of a plain name, and the comps to choose from. */
export const labelDesignId = signal<number | null>(null);
export const labelDesignList = signal<LabelDesign[]>([]);
/** The folder each picture field of the design takes its pictures from, kept with the map. */
export const labelImageFolders = signal<Record<string, string>>({});

/** Chooses the folder a picture field ({flag}, {logo}) takes its pictures from. */
export const chooseLabelImageFolder = (field: string) =>
  run("label pictures", async () => {
    const folder = await callHost<string | null>("pickFolder", { prompt: `Pictures for {${field}}: a folder of images named by country code or name` });
    if (!folder) return;
    labelImageFolders.value = { ...labelImageFolders.value, [field]: folder };
    if (selectedId.value) {
      await callHost("setMapSettings", { mapId: selectedId.value, labelImages: labelImageFolders.value });
      await readMaps();
    }
    let count = 0;
    try {
      count = nodeFs().readdirSync(folder).filter((name: string) => /\.(png|jpe?g|tiff?|psd|ai|gif|bmp|tga|exr)$/i.test(name)).length;
    } catch {
      count = 0;
    }
    log(`{${field}} takes its pictures from ${folder} (${count} pictures). Place the names again to use them`, count ? "ok" : "fail");
  });
export const currentLabelDesign = computed(() => labelDesignList.value.find((design) => design.compId === labelDesignId.value) ?? null);

/** Reads the project's comps again: any comp with a {field} in a text layer can be a label. */
export const refreshLabelDesigns = () =>
  run("label designs", async () => {
    labelDesignList.value = await labelDesigns();
    if (labelDesignId.value !== null && !labelDesignList.value.some((design) => design.compId === labelDesignId.value)) {
      labelDesignId.value = null;
      log("the label design comp is not in this project any more; names are plain text again", "muted");
    }
  });

/** Chooses the design (or none) and keeps it with the map. */
export const changeLabelDesign = (compId: number | null) =>
  run("label design", async () => {
    labelDesignId.value = compId;
    if (selectedId.value) {
      await callHost("setMapSettings", { mapId: selectedId.value, labelDesign: compId });
      await readMaps();
    }
    const design = currentLabelDesign.value;
    log(design ? `names will be copies of "${design.name}" (${design.fields.map((field) => `{${field}}`).join(" ")}). Place the names again to use it` : "names are plain text again. Place the names again to use it", "ok");
  });
export const liveLink = signal(false);
/** Preview names and lines at their rendered size instead of enlarged to stay readable. */
export const exactLook = signal(false);
export const hostInfo = signal<string>("");
/** The name of the last search result the user went to, used to name new maps and shots. */
export const lastPlaceName = signal<string | null>(null);

export const selected = computed(() => maps.value.find((m) => m.mapId === selectedId.value) ?? null);
export const renderSettings = computed(() => normaliseSettings(selected.value?.render ?? null, DEFAULT_FINAL_SETTINGS));

let pinCounter = 1;
/** How often each place name has named a pin or route this session, so a second pin in Paris is "Paris 2". */
const nameUses = new Map<string, number>();
function uniquePlaceName(name: string, kind = ""): string {
  const uses = (nameUses.get(kind + name) ?? 0) + 1;
  nameUses.set(kind + name, uses);
  return uses === 1 ? name : `${name} ${uses}`;
}
let legacyEngineNoted = false;
/** Listeners told when the selected map changes or is read again (the shot list reloads then). */
const mapListeners = new Set<(entry: MapEntry | null) => void>();

export function onSelectedMap(listener: (entry: MapEntry | null) => void): () => void {
  mapListeners.add(listener);
  return () => mapListeners.delete(listener);
}

export const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;
export const compactNumber = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}k` : String(n));

export function log(text: string, kind?: LogKind): void {
  logLines.value = [...logLines.value.slice(-200), { text, kind }];
}

export function fail(what: string, error: unknown): void {
  log(`${what}: ${error instanceof Error ? error.message : String(error)}`, "fail");
}

/** Runs one action at a time with the busy state; errors go to the status line. */
export async function run(label: string, task: () => Promise<void>): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    await task();
  } catch (error) {
    fail(label, error);
  } finally {
    busy.value = false;
    progress.value = null;
  }
}

/** Tiles from zoom 0 to maxZoom that cover the bbox (offline estimate, before asking the server). */
export function tilesUpTo(bbox: Bbox, maxZoom: number): number {
  let total = 0;
  for (let z = 0; z <= maxZoom; z++) total += tileCount(tileRangeForBbox(bbox, z));
  return total;
}

export const sourceKey = (s: BasemapSource) => (s.kind === "region" ? `region:${s.name}` : s.kind === "regions" ? `regions:${s.names.join("+")}` : "world");
export const sourceFromKey = (key: string): BasemapSource =>
  key.startsWith("regions:") ? { kind: "regions", names: key.slice(8).split("+") } : key.startsWith("region:") ? { kind: "region", name: key.slice(7) } : { kind: "world" };

/** Every downloaded region, wide ones (fewer zoom levels) first so detailed ones draw on top. */
export const allRegions = (list: RegionInfo[]): BasemapSource => ({
  kind: "regions",
  names: [...list].sort((a, b) => (a.maxZoom ?? 15) - (b.maxZoom ?? 15) || a.name.localeCompare(b.name)).map((r) => r.name)
});

export function basemapLabel(source: BasemapSource): string {
  if (source.kind === "world") return "World";
  const names = regionNames(source);
  return names.length === 1 ? names[0] : `${names.length} regions`;
}

function showMap(entry: MapEntry): void {
  const source = entry.basemap ?? { kind: "world" };
  basemap.value = source;
  projection.value = entry.projection ?? "mercator";
  themeId.value = themeById(typeof entry.theme === "string" ? entry.theme : null).id;
  lookOverride.value = normaliseLook(entry.look);
  lookDetails.value = normaliseDetails(entry.lookDetails);
  ownImagery.value = normaliseOwnImagery(entry.ownImagery);
  ownImageryDraft.value = ownImagery.value?.url ?? "";
  reliefOn.value = !!entry.relief;
  skyOn.value = entry.sky !== false;
  terrain.value = normaliseTerrain(entry.terrain);
  layerStyle.value = normaliseLayerStyle(entry.layerStyle);
  labelTemplate.value = normaliseLabelTemplate(entry.labelTemplate);
  labelDesignId.value = typeof entry.labelDesign === "number" ? entry.labelDesign : null;
  labelImageFolders.value = entry.labelImages && typeof entry.labelImages === "object" ? (entry.labelImages as Record<string, string>) : {};
  featureEdits.value = entry.featureEdits && typeof entry.featureEdits === "object" ? (entry.featureEdits as FeatureEdits) : {};
  keepOut.value = normaliseKeepOut(entry.keepOut);
  osmData.value = entry.osmData === true;
  dataFill.value = normaliseDataFill(entry.dataFill);
  heat.value = null;
  // The points of a heat map are read separately: they can be many, and most maps have none.
  if (entry.heat) {
    const mapId = entry.mapId;
    callHost<unknown>("getHeat", { mapId })
      .then((stored) => {
        if (selectedId.value !== mapId) return;
        heat.value = normaliseHeat(stored);
        setPreviewStyle(basemap.value, projection.value, look());
      })
      .catch((error) => fail("reading the heat map", error));
  }
  highlights.value = normaliseHighlights(entry.highlights);
  highlightLayers.value = entry.highlightLayers === "one" ? "one" : "each";
  areas.value = {};
  // The polygons of custom areas are read separately: they can be large, and most maps have none.
  if (highlights.value.some((h) => h.code.startsWith(AREA_PREFIX))) {
    const mapId = entry.mapId;
    callHost<Areas>("getAreas", { mapId })
      .then((stored) => {
        if (selectedId.value !== mapId) return;
        areas.value = normaliseAreas(stored, highlights.value);
        setPreviewStyle(basemap.value, projection.value, look());
      })
      .catch((error) => fail("reading highlighted areas", error));
  }
  setCompSize(entry.width, entry.height);
  setPreviewStyle(source, projection.value, look());
  showCompView(entry.view);
}

/** Copies separated in this session; one Undo brings a copy back, and it is then left alone. */
const separatedCopies = new Set<string>();
const sharedNoted = new Set<string>();

type Separated = { from: string; to: string; sceneCompName: string; originalSceneName: string; mapCompName: string; madeComp: boolean; footage: number; layers: number; sameScene: boolean; key: string };

/**
 * A scene duplicated in After Effects carries a copy of its map layer with the same id. Each copy is
 * given a map of its own (31-duplicates.jsx), so the two scenes can move and render apart.
 */
async function separateCopiedMaps(list: MapEntry[]): Promise<MapEntry[]> {
  const seen = new Map<string, number>();
  for (const entry of list) seen.set(entry.mapId, (seen.get(entry.mapId) ?? 0) + 1);
  if (![...seen.values()].some((count) => count > 1)) return list;
  const result = await callHost<{ separated: Separated[]; kept: { key: string; sceneCompName: string }[] }>("separateDuplicateMaps", { skip: [...separatedCopies] });
  for (const done of result.separated) {
    separatedCopies.add(done.key);
    log(
      done.sameScene
        ? `the copied map layer in "${done.sceneCompName}" now has a map of its own, "${done.mapCompName}"`
        : `"${done.sceneCompName}" is a copy of "${done.originalSceneName}"; it now has a map of its own, "${done.mapCompName}", showing the same frames until you render it`,
      "ok"
    );
  }
  for (const kept of result.kept) {
    if (sharedNoted.has(kept.key)) continue;
    sharedNoted.add(kept.key);
    log(`"${kept.sceneCompName}" shares its map with another scene again (Undo brought the copy back); the panel leaves it that way, and the first of the two is the one it moves and renders`, "muted");
  }
  return result.separated.length ? await callHost<MapEntry[]>("listMaps") : list;
}

export async function readMaps(): Promise<MapEntry[]> {
  let list = await callHost<MapEntry[]>("listMaps");
  try {
    list = await separateCopiedMaps(list);
  } catch (error) {
    fail("separating copied maps", error);
  }
  maps.value = list;
  // A render belongs to one map of one project; the queue is told which maps are here, so a job
  // from another project waits quietly instead of failing.
  renderQueue.markMissingMaps(list.map((entry) => entry.mapId));
  jobs.value = [...renderQueue.jobs];
  return list;
}

export async function refreshMaps(preferActive = false): Promise<void> {
  if (!isInCep()) return;
  try {
    const list = await readMaps();
    if (list.some((m) => m.expressionEngine === "extendscript") && !legacyEngineNoted) {
      legacyEngineNoted = true;
      log("this project uses the Legacy ExtendScript expression engine. Map layers work with it, but play back faster with File > Project Settings > Expressions > JavaScript", "muted");
    }
    const current = list.find((m) => m.mapId === selectedId.value);
    const active = list.find((m) => m.isActiveScene);
    const next = (preferActive && active) || current || active || list[0] || null;
    if (next && next.mapId !== selectedId.value) {
      selectedId.value = next.mapId;
      showMap(next);
    } else if (!next && selectedId.value) {
      selectedId.value = "";
    }
    for (const listener of mapListeners) listener(next);
  } catch (error) {
    fail("reading maps", error);
  }
}

export async function refreshRegions(): Promise<void> {
  if (!isInCep()) return;
  try {
    regions.value = await listRegions();
  } catch (error) {
    fail("reading regions", error);
  }
}

export function selectMap(id: string): void {
  const entry = maps.value.find((m) => m.mapId === id);
  if (!entry) return;
  selectedId.value = id;
  showMap(entry);
  for (const listener of mapListeners) listener(entry);
  void callHost("revealMap", { mapId: id }).catch((error) => fail("showing the map", error));
}

/** A name for a new map or shot: the last place searched for, or what the preview shows. */
export function suggestName(): string | null {
  const v = compView();
  if (!v) return lastPlaceName.value;
  if (lastPlaceName.value) return lastPlaceName.value;
  try {
    // Names are framed for 1080 lines; taller comps sit at a higher zoom for the same picture.
    return nameForView(placeIndex(), v.center, v.zoom - Math.log2(compSize().height / 1080));
  } catch {
    return null;
  }
}

export type NewMapOptions = { name: string; width?: number; height?: number; frameRate?: number; duration?: number; newScene: boolean };

export const createMap = (options: NewMapOptions) =>
  run("new map", async () => {
    const v = compView();
    if (!v) return;
    // A different comp size shows the same picture at a different zoom.
    const height = options.height ?? compSize().height;
    const created = await createMapComp({
      name: options.name,
      width: options.width,
      height: options.height,
      frameRate: options.frameRate,
      duration: options.duration,
      newScene: options.newScene,
      view: { ...v, zoom: v.zoom + Math.log2(height / compSize().height) },
      projection: projection.value
    });
    await callHost("setMapSettings", { mapId: created.id, basemap: basemap.value, theme: themeId.value, relief: reliefOn.value, highlights: highlights.value, areas: areas.value, highlightLayers: highlightLayers.value, sky: skyOn.value, terrain: terrain.value, layerStyle: layerStyle.value, labelTemplate: labelTemplate.value, keepOut: keepOut.value });
    log(`created ${created.mapCompName} in ${created.sceneCompName}`, "ok");
    selectedId.value = created.id;
    screen.value = "main";
    const list = await readMaps();
    const entry = list.find((m) => m.mapId === created.id) ?? null;
    if (entry) showMap(entry);
    for (const listener of mapListeners) listener(entry);
  });

export const renameMap = (name: string) =>
  run("rename", async () => {
    if (!selected.value || !name.trim()) return;
    await callHost("renameMap", { mapId: selected.value.mapId, name: name.trim() });
    await readMaps();
  });

export const keyframeView = () =>
  run("keyframe", async () => {
    const v = compView();
    if (!v || !selected.value) return;
    await setView(selected.value.mapId, v, true);
    log("camera keyframed at the current time", "ok");
  });

export const flyHere = () =>
  run("fly", async () => {
    const list = await readMaps();
    const entry = list.find((m) => m.mapId === selectedId.value);
    const v = compView();
    if (!v || !entry) return;
    const flight = await flyTo(entry, v, flightSeconds.value);
    log(`flight of ${flightSeconds.value} s keyed from ${entry.time.toFixed(2)} s (${flight.keys} keys, widest zoom ${flight.topZoom.toFixed(1)}); the time indicator is at its end`, "ok");
  });

export const matchAe = () =>
  run("match view", async () => {
    const list = await readMaps();
    const entry = list.find((m) => m.mapId === selectedId.value);
    if (entry) showCompView(entry.view);
  });

/** Live link: the preview drives the camera at the current time (called when a move by hand ends). */
let liveTimer: ReturnType<typeof setTimeout> | null = null;
export function previewMoved(v: View, byUser: boolean): void {
  if (!byUser || !liveLink.value || !selected.value || busy.value) return;
  if (liveTimer) clearTimeout(liveTimer);
  const mapId = selected.value.mapId;
  liveTimer = setTimeout(() => {
    liveTimer = null;
    if (busy.value || !liveLink.value) return;
    setView(mapId, v, false).catch((error) => fail("live link", error));
  }, 250);
}

/** Adds the matched 3D camera unless the map has one; uses the map's view at the current AE time. */
async function ensureCamera(mapId: string): Promise<void> {
  const list = await readMaps();
  const entry = list.find((m) => m.mapId === mapId);
  if (!entry) throw new Error("the selected map is gone");
  if (entry.hasCamera) return;
  const rig = await addCameraRig(mapId, entry.view);
  if (rig.expressionErrors.length) log(`3D camera expression problems: ${rig.expressionErrors.join("; ")}`, "fail");
  else log(`added ${rig.cameraName} (ground scale of zoom ${rig.referenceZoom})`, "ok");
  for (const warning of rig.warnings) log(warning, "fail");
  await readMaps();
}

export const addCamera = () =>
  run("3D camera", async () => {
    if (selectedId.value) await ensureCamera(selectedId.value);
  });

/** The ground's elevation at places, from the selected map's elevation pack (zeros without one). */
async function groundElevations(places: { lat: number; lng: number }[]): Promise<number[]> {
  const sampler = samplerFor(terrain.value);
  if (!sampler) return places.map(() => 0);
  try {
    return await sampler.elevations(places);
  } finally {
    sampler.close();
  }
}

/** The place a click landed on, when a named one is within about forty kilometres; else null. */
export function placeNameAt(position: { lat: number; lng: number }): string | null {
  try {
    return nearestPlaceName(placeIndex(), position, 0.35);
  } catch {
    return null;
  }
}

export async function addPinAt(position: { lat: number; lng: number }, threeD = false): Promise<void> {
  const mapId = selectedId.value;
  if (!mapId) {
    log("create or select a map first", "muted");
    return;
  }
  await run("add pin", async () => {
    if (threeD) await ensureCamera(mapId);
    const [elevation] = await groundElevations([position]);
    // A pin is named after the place it sits on, so the layer list reads "Pin: Dhaka", not "Pin 7".
    const place = placeNameAt(position);
    // 3D pins and flat pins carry different prefixes, so each kind counts its own uses of a name.
    const name = place ? uniquePlaceName(place, threeD ? "3D " : "") : threeD ? String(pinCounter++) : `Pin ${pinCounter++}`;
    const added = await addPin(mapId, position, { name, threeD, elevation: terrain.value ? elevation : undefined, style: { color: styleRgb(currentLayerStyle.value.accent) } });
    if (added.expressionErrors.length) log(`pin expression problems: ${added.expressionErrors.join("; ")}`, "fail");
    else log(`added ${added.name} at ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}`, "ok");
  });
}

export function armTool(next: Tool): void {
  tool.value = tool.value === next ? "none" : next;
  toolFirstPoint.value = null;
  toolSheet.value = null;
  if (tool.value === "attach") void refreshSelection();
}

/** What the user has selected in After Effects, for the attach tool. */
export const selection = signal<SelectionInfo | null>(null);
/** Attached layers grow and turn with the map while these are on. */
export const attachScale = signal(false);
export const attachRotate = signal(false);

export async function refreshSelection(): Promise<void> {
  if (!selectedId.value) {
    selection.value = null;
    return;
  }
  try {
    selection.value = await selectionInfo(selectedId.value);
  } catch (error) {
    selection.value = null;
    fail("reading the selection in After Effects", error);
  }
}

/** Attaches the layers selected in After Effects to a place, so they stay on it while the camera moves. */
export const attachAt = (position: { lat: number; lng: number }) =>
  run("attach layers", async () => {
    const mapId = selectedId.value;
    if (!mapId) return;
    const [elevation] = await groundElevations([position]);
    const made = await attachLayers(mapId, position, { elevation: terrain.value ? elevation : 0, scaleWithMap: attachScale.value, rotateWithMap: attachRotate.value });
    await refreshSelection();
    if (made.expressionErrors.length) log(`attach problems: ${made.expressionErrors.slice(0, 3).join("; ")}`, "fail");
    else log(`${made.layers.length} ${made.layers.length === 1 ? "layer" : "layers"} attached at ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}: ${made.layers.slice(0, 3).join(", ")}${made.layers.length > 3 ? "…" : ""}. Move them with their Latitude and Longitude sliders`, "ok");
  });

/** Puts the selected attached layers back as they were. */
export const detachSelected = () =>
  run("unlink layers", async () => {
    const mapId = selectedId.value;
    if (!mapId) return;
    const undone = await detachLayers(mapId);
    await refreshSelection();
    log(undone.layers.length ? `${undone.layers.length} ${undone.layers.length === 1 ? "layer is" : "layers are"} back as they were: ${undone.layers.slice(0, 3).join(", ")}` : "none of the selected layers is attached to this map", undone.layers.length ? "ok" : "muted");
  });

/** A click on the preview: Alt+click pins as before; otherwise the armed tool gets the place. */
/** What is under the pointer in the preview: "23.8103, 90.4125 · Dhaka · Dhaka · Bangladesh", or null when it is off the map. */
export const hereText = signal<string | null>(null);
let hereTimer: ReturnType<typeof setTimeout> | null = null;

/** The place, district, province and country at a position, nearest first, without a name repeating itself. */
export function describePlace(position: { lat: number; lng: number }, point: { x: number; y: number } | null, zoom: number): string {
  const country = point ? countryAt(point) : null;
  // A place within about fifty pixels of the pointer, whatever the zoom.
  const reach = Math.max(0.02, (50 * 360) / (512 * Math.pow(2, zoom)));
  let place: string | null = null;
  try {
    place = nearestPlaceName(placeIndex(), position, reach);
  } catch {
    place = null;
  }
  const district = country && districtSetOf(country.code) ? districtAt(country.code, position)?.name ?? null : null;
  const province = country ? provinceAt(country.code, position)?.name ?? null : null;
  const parts: string[] = [];
  for (const part of [place, district, province, country?.name ?? null]) {
    if (part && parts[parts.length - 1] !== part) parts.push(part);
  }
  const where = parts.length ? parts.join(" · ") : point ? "open sea" : "";
  return `${position.lat.toFixed(4)}, ${position.lng.toFixed(4)}${where ? ` · ${where}` : ""}`;
}

/** The pointer moved over the preview: the readout follows it, a few times a second. */
export function previewHovered(position: { lat: number; lng: number } | null, point: { x: number; y: number } | null = position ? pointOf(position) : null): void {
  if (hereTimer) clearTimeout(hereTimer);
  if (!position) {
    hereTimer = null;
    hereText.value = null;
    return;
  }
  hereTimer = setTimeout(() => {
    hereTimer = null;
    try {
      hereText.value = describePlace(position, point, view.value?.zoom ?? 2);
    } catch {
      hereText.value = null;
    }
  }, 90);
}

export function previewClicked(position: { lat: number; lng: number }, event: MouseEvent, point: { x: number; y: number }): void {
  if (event.altKey) {
    void addPinAt(position, event.shiftKey);
    return;
  }
  const active = tool.value;
  if (active === "none") return;
  if (active === "highlight") {
    // The tool stays on, so several countries can be clicked in a row (Esc ends it).
    const country = countryAt(point);
    if (!country) log("no country there (click on land)", "muted");
    else if (highlightLevel.value === "province") {
      const province = provinceAt(country.code, position);
      if (province) toggleProvinceHighlight(province);
      else log(`no province of ${country.name} there`, "muted");
    } else if (highlightLevel.value === "district") {
      const set = districtSetOf(country.code);
      if (!set) void offerDistricts(country);
      else {
        districtPrompt.value = null;
        const unit = districtAt(country.code, position);
        if (unit) toggleProvinceHighlight(unit);
        else log(`no ${set.unit} of ${country.name} there`, "muted");
      }
    } else toggleCountryHighlight(country.code, country.name);
    return;
  }
  if (!selectedId.value) {
    log("create or select a map first", "muted");
    tool.value = "none";
    return;
  }
  if (active === "attach") {
    tool.value = "none";
    void attachAt(position);
  } else if (active === "pin" || active === "pin3d") {
    tool.value = "none";
    void addPinAt(position, active === "pin3d");
  } else if (active === "callout") {
    tool.value = "none";
    toolSheet.value = { kind: "callout", place: position, title: suggestName() ?? "", subtitle: "", seconds: 5 };
  } else if (active === "route") {
    if (!toolFirstPoint.value) toolFirstPoint.value = position;
    else {
      toolSheet.value = { kind: "route", from: toolFirstPoint.value, to: position, seconds: 4 };
      toolFirstPoint.value = null;
      tool.value = "none";
    }
  }
}

/** Frame of the map comp at the scene's current time. */
function currentMapFrame(entry: MapEntry): number {
  return Math.max(0, Math.round((entry.time - entry.layerStart) * entry.frameRate));
}

export const confirmToolSheet = () =>
  run("add layer", async () => {
    const sheet = toolSheet.value;
    if (!sheet) return;
    const list = await readMaps();
    const entry = list.find((m) => m.mapId === selectedId.value);
    if (!entry) return;
    const start = currentMapFrame(entry);
    const frames = Math.max(1, Math.round(sheet.seconds * entry.frameRate));
    if (sheet.kind === "callout") {
      if (!sheet.title.trim()) {
        log("a callout needs a title", "muted");
        return;
      }
      const made = await addCallout(entry.mapId, sheet.place, sheet.title.trim(), sheet.subtitle.trim(), { inFrame: start, outFrame: start + frames, terrain: terrain.value, style: currentLayerStyle.value, template: currentLabelTemplate.value });
      log(`added a callout "${sheet.title.trim()}" from ${entry.time.toFixed(2)} s for ${sheet.seconds} s`, made.expressionErrors.length ? "fail" : "ok");
    } else {
      // "Route: Dhaka to Chittagong" when both ends are on a named place.
      const ends = [placeNameAt(sheet.from), placeNameAt(sheet.to)];
      const routeName = ends[0] && ends[1] ? uniquePlaceName(`${ends[0]} to ${ends[1]}`) : `Route ${pinCounter++}`;
      const made = await addRoute(entry.mapId, sheet.from, sheet.to, { name: routeName, startFrame: start, endFrame: start + frames, terrain: terrain.value, style: currentLayerStyle.value, comet: routeComet.value, traveller: routeArrow.value, dash: routeDashed.value ? ROUTE_DASH : 0 });
      log(`added "${routeName}", a route that draws on from ${entry.time.toFixed(2)} s over ${sheet.seconds} s${routeArrow.value ? ", with an arrow riding it (parent your own artwork to the Traveller layer)" : ""}`, made.expressionErrors.length ? "fail" : "ok");
    }
    toolSheet.value = null;
  });

export const importPicked = (file: File) =>
  run("import", async () => {
    progress.value = { label: `Reading ${file.name}`, done: 0, total: 1 };
    const result = await importFile(file);
    if (result.table) {
      openDataTable(result.table);
      log(`${file.name}: a table of ${result.table.rows.length} rows. ${dataMessage.value ?? ""}`, "ok");
      return;
    }
    imported.value = result;
    importSheetOpen.value = true;
    const first = result.lines[0];
    if (first) fitLine(first.points);
    else if (result.places.length) showCompView(fitPoints(result.places, compSize(), { padding: 0.15, maxZoom: 12 + Math.log2(compSize().height / 1080) }), true);
    log(`${file.name}: ${result.lines.length} ${result.lines.length === 1 ? "line" : "lines"}, ${result.areas.length} ${result.areas.length === 1 ? "area" : "areas"}, ${result.places.length} ${result.places.length === 1 ? "place" : "places"}${result.skipped ? `, ${result.skipped} skipped` : ""}`, "ok");
  });

/** Frames a line in the preview, at the current bearing and pitch. */
export function fitLine(points: { lat: number; lng: number }[]): void {
  const current = compView();
  showCompView(fitPoints(points, compSize(), { bearing: current?.bearing ?? 0, pitch: current?.pitch ?? 0, padding: 0.12, maxZoom: 16 + Math.log2(compSize().height / 1080) }), true);
}

/** Draws an imported line as a route layer from the current time, with or without a traveller. */
export const drawImportedLine = (line: ImportedLine, seconds: number, traveller: boolean, recordedPace = false) =>
  run("draw route", async () => {
    const list = await readMaps();
    const entry = list.find((m) => m.mapId === selectedId.value);
    if (!entry) {
      log("create or select a map first", "muted");
      return;
    }
    const start = currentMapFrame(entry);
    const frames = Math.max(1, Math.round(seconds * entry.frameRate));
    const pace = recordedPace && line.times ? { points: line.points, times: line.times, leaves: line.leaves } : undefined;
    const made = await addRouteLine(entry.mapId, line.points, { name: `Route: ${line.name}`, startFrame: start, endFrame: start + frames, traveller, outline: line.closed, pace, terrain: terrain.value, style: currentLayerStyle.value, comet: routeComet.value, dash: routeDashed.value ? ROUTE_DASH : 0 });
    const thinned = made.points < line.points.length ? ` (${line.points.length} points thinned to ${made.points})` : "";
    const paced = pace ? ` at its recorded pace (${made.keys} keys, long stops shortened)` : "";
    log(`"${line.name}" draws on from ${entry.time.toFixed(2)} s over ${seconds} s${paced}${traveller ? ", with an arrow travelling along it (parent your own artwork to the Traveller layer)" : ""}${thinned}`, made.expressionErrors.length ? "fail" : "ok");
  });

export const pinImportedPlaces = (places: ImportedPlace[]) =>
  run("add pins", async () => {
    const mapId = selectedId.value;
    if (!mapId) {
      log("create or select a map first", "muted");
      return;
    }
    const some = places.slice(0, 40);
    const elevations = await groundElevations(some);
    let done = 0;
    for (const place of some) {
      progress.value = { label: "Adding pins", done, total: some.length };
      await addPin(mapId, place, { name: place.name, elevation: terrain.value ? elevations[done] : undefined, style: { color: styleRgb(currentLayerStyle.value.accent) } });
      done++;
    }
    log(`added ${done} pins${places.length > some.length ? ` (the first ${some.length} of ${places.length})` : ""}`, "ok");
  });

export const changeBasemap = (key: string) =>
  run("basemap", async () => {
    const source = sourceFromKey(key);
    basemap.value = source;
    setPreviewStyle(source, projection.value);
    if (selectedId.value) await callHost("setMapSettings", { mapId: selectedId.value, basemap: source });
  });

export const changeTheme = (next: string) =>
  run("look", async () => {
    themeId.value = themeById(next).id;
    setPreviewStyle(basemap.value, projection.value, look());
    if (selectedId.value) {
      await callHost("setMapSettings", { mapId: selectedId.value, theme: themeId.value });
      await readMaps();
    }
  });

/** Replaces the map's highlights: the preview shows them at once, the next render draws their pass. */
export async function setHighlights(next: Highlight[], nextAreas: Areas = areas.value): Promise<void> {
  highlights.value = normaliseHighlights(next);
  // Geometry of areas that are no longer highlighted goes with them.
  areas.value = normaliseAreas(nextAreas, highlights.value);
  setPreviewStyle(basemap.value, projection.value, look());
  if (!selectedId.value) return;
  try {
    await callHost("setMapSettings", { mapId: selectedId.value, highlights: highlights.value, areas: areas.value });
    maps.value = maps.value.map((m) => (m.mapId === selectedId.value ? { ...m, highlights: highlights.value } : m));
  } catch (error) {
    fail("saving highlights", error);
  }
}

/** The highlight code an imported area gets: the same area always gets the same code. */
export const areaCode = (area: ImportedArea) => `${AREA_PREFIX}${keyOf([area.name, area.points, area.bbox]).slice(0, 12)}`;

/** Highlights an imported area (or removes it again). Its polygons are thinned and saved with the map. */
export function toggleAreaHighlight(area: ImportedArea): void {
  const code = areaCode(area);
  const had = highlights.value.some((h) => h.code === code);
  if (!had && Object.keys(areas.value).length >= MAX_AREAS) {
    log(`a map can highlight up to ${MAX_AREAS} custom areas`, "muted");
    return;
  }
  const geometry = simplifyPolygons(area.polygons, AREA_MAX_POINTS);
  if (!had && !geometry.length) {
    log(`"${area.name}" has no usable outline`, "fail");
    return;
  }
  void setHighlights(toggleHighlight(highlights.value, code, area.name), had ? areas.value : { ...areas.value, [code.slice(AREA_PREFIX.length)]: geometry });
  log(had ? `${area.name} is no longer highlighted` : `${area.name} highlighted: render to get it as its own layer above the basemap`, "ok");
}

/** "each": every highlight renders as its own After Effects layer. "one": a single layer holds them all. */
export const highlightLayers = signal<"each" | "one">("each");

export const changeHighlightLayers = (next: "each" | "one") =>
  run("highlight layers", async () => {
    highlightLayers.value = next;
    if (selectedId.value) {
      await callHost("setMapSettings", { mapId: selectedId.value, highlightLayers: next });
      await readMaps();
    }
  });

/** What a click of the highlight tool picks: whole countries, their provinces, or their districts (a download per country). */
export const highlightLevel = signal<"country" | "province" | "district">("country");

/** The country whose districts the user asked for, and what geoBoundaries offers for it. */
export type DistrictPrompt = { country: { code: string; name: string; iso: string }; state: "looking" | "offer" | "none" | "failed"; offer?: DistrictOffer; message?: string };
export const districtPrompt = signal<DistrictPrompt | null>(null);
/** Bumped when district sets are installed or removed, so lists of them redraw. */
export const districtSets = signal(0);
export const listDistrictSets = () => (districtSets.value, installedDistricts());

/** Looks up what can be downloaded for a country (a few kilobytes); nothing large moves before the user presses Download. */
export async function offerDistricts(country: { code: string; name: string; iso: string }): Promise<void> {
  districtPrompt.value = { country, state: "looking" };
  try {
    const offer = await findDistricts(country.iso);
    if (districtPrompt.value?.country.code !== country.code) return;
    districtPrompt.value = offer ? { country, state: "offer", offer } : { country, state: "none" };
  } catch (error) {
    if (districtPrompt.value?.country.code === country.code) districtPrompt.value = { country, state: "failed", message: error instanceof Error ? error.message : String(error) };
  }
}

export const downloadDistricts = () =>
  run("download districts", async () => {
    const prompt = districtPrompt.value;
    if (!prompt?.offer) return;
    const stopper = new AbortController();
    const cancel = () => stopper.abort();
    const label = `Downloading the ${prompt.offer.unit} boundaries of ${prompt.country.name}`;
    progress.value = { label, done: 0, total: 1, cancel };
    const started = performance.now();
    const set = await installDistricts(prompt.offer, prompt.country, {
      signal: stopper.signal,
      onProgress: (done, total) => (progress.value = { label, done, total: total ?? Math.max(done, prompt.offer?.sizeBytes ?? 1), cancel })
    });
    resetPlaceIndex();
    districtSets.value++;
    districtPrompt.value = null;
    // A table waiting for these districts joins to them now.
    if (dataSheetOpen.value && dataLevel.value === "district") rejoinTable();
    log(`${set.units.length} ${set.unit} boundaries of ${set.countryName} installed in ${((performance.now() - started) / 1000).toFixed(1)} s (${set.source}; ${set.license}). Click one on the map, or search its name`, "ok");
  });

/** How far Grow, Shrink and Circle reach, in kilometres. */
export const combineKm = signal(25);

/** The id a made-up area gets: the same geometry always gets the same id. */
const madeAreaCode = (name: string, polygons: number[][][][]) => `${AREA_PREFIX}${keyOf([name, polygons.length, polygons[0]?.[0]?.length ?? 0, polygons[0]?.[0]?.[0] ?? 0]).slice(0, 12)}`;

/**
 * Puts an area the panel worked out into the map, in place of the highlights it came from, and
 * gives back what was really kept: an area is thinned to the points a map style can carry, so the
 * smallest islands of a large outline may not survive.
 */
async function addMadeArea(name: string, polygons: number[][][][], keep: Highlight[], style: Highlight | undefined): Promise<number[][][][] | null> {
  const thinned = simplifyPolygons(polygons, AREA_MAX_POINTS);
  if (!thinned.length) {
    log(`"${name}" came out empty`, "fail");
    return null;
  }
  const code = madeAreaCode(name, thinned);
  const next = [...keep.filter((highlight) => highlight.code !== code), { code, name, color: style?.color ?? DEFAULT_HIGHLIGHT.color, fill: style?.fill ?? DEFAULT_HIGHLIGHT.fill, outline: style?.outline ?? DEFAULT_HIGHLIGHT.outline }];
  const geometry: Areas = { ...Object.fromEntries(Object.entries(areas.value).filter(([id]) => next.some((highlight) => highlight.code === `${AREA_PREFIX}${id}`))), [code.slice(AREA_PREFIX.length)]: thinned };
  await setHighlights(next, geometry);
  return thinned;
}

/** The outlines of the highlights, with the ones this build has no outline for left out. */
function outlinesOf(list: Highlight[]): { highlight: Highlight; polygons: number[][][][] }[] {
  return list.map((highlight) => ({ highlight, polygons: outlineFor(highlight.code) })).filter((entry): entry is { highlight: Highlight; polygons: number[][][][] } => !!entry.polygons);
}

/** One area out of every highlight, with the borders between the ones that touch gone. */
export const mergeHighlights = () =>
  run("merge areas", async () => {
    const list = highlights.value;
    const parts = outlinesOf(list);
    if (parts.length < 2) {
      log(parts.length ? "highlight at least two areas to merge them" : "highlight some areas first", "muted");
      return;
    }
    const name = combinedName(parts.map((part) => part.highlight.name));
    const merged = mergeAreas(parts.map((part) => part.polygons));
    const kept = list.filter((highlight) => !parts.some((part) => part.highlight.code === highlight.code));
    const stored = await addMadeArea(name, merged, kept, parts[0].highlight);
    if (stored) {
      const dropped = merged.length - stored.length;
      log(
        `${parts.length} areas merged into "${name}" (${areaKm2(stored).toLocaleString("en")} km2, ${stored.length} ${stored.length === 1 ? "shape" : "shapes"}). The borders between them are gone${dropped > 0 ? `; ${dropped} of the smallest islands did not fit in one area` : ""}`,
        "ok"
      );
    }
  });

/** Every highlighted area pushed out (or pulled in) by the distance in the sheet. */
export const growHighlights = (km: number) =>
  run(km > 0 ? "grow areas" : "shrink areas", async () => {
    const parts = outlinesOf(highlights.value);
    if (!parts.length) {
      log("highlight an area first", "muted");
      return;
    }
    let done = 0;
    let lost = 0;
    for (const part of parts) {
      const grown = growArea(part.polygons, km);
      if (!grown.length) {
        lost++;
        continue;
      }
      const kept = highlights.value.filter((highlight) => highlight.code !== part.highlight.code);
      if (await addMadeArea(part.highlight.name, grown, kept, part.highlight)) done++;
    }
    log(
      `${done} ${done === 1 ? "area" : "areas"} ${km > 0 ? "grown" : "shrunk"} by ${Math.abs(km)} km${lost ? `, ${lost} disappeared` : ""}${km > 0 ? ". Parts that came within the distance of each other joined up" : ". Parts narrower than the distance are gone"}`,
      done ? "ok" : "fail"
    );
  });

/** A circle of the distance in the sheet around the middle of the preview. */
export const addCircleArea = (km: number) =>
  run("circle", async () => {
    const view = compView();
    if (!view) return;
    const circle = circleAround(view.center, km);
    // Named after the place it is really around, not the country the preview happens to show.
    let where: string | null = null;
    try {
      where = nearestPlaceName(placeIndex(), view.center, Math.max(0.2, km / 111));
    } catch {
      where = null;
    }
    const name = `${km} km around ${where || `${view.center.lat.toFixed(2)}, ${view.center.lng.toFixed(2)}`}`;
    if (await addMadeArea(name, circle, highlights.value, undefined)) log(`"${name}" highlighted (${areaKm2(circle).toLocaleString("en")} km2). Render to get it as its own layer, or add it as a shape layer`, "ok");
  });

/** While on, a shape layer's outline draws on over four seconds from the current time. */
export const shapeDrawOn = signal(false);

/** The outline of a highlight: a country from the bundled outlines, anything else from the map's own areas. */
function outlineFor(code: string): number[][][][] | null {
  if (isAreaCode(code)) return areas.value[areaIdOf(code)] ?? null;
  return countryOutline(code)?.polygons ?? null;
}

/** Adds a highlighted country, province, district or area as an editable After Effects shape layer. */
export const addHighlightShape = (highlight: Highlight) =>
  run("shape layer", async () => {
    const list = await readMaps();
    const entry = list.find((m) => m.mapId === selectedId.value);
    if (!entry) {
      log("create or select a map first", "muted");
      return;
    }
    const polygons = outlineFor(highlight.code);
    if (!polygons) {
      log(`no outline for "${highlight.name}" in this build`, "fail");
      return;
    }
    const made = await addFeatureShape(
      entry.mapId,
      { name: highlight.name, polygons, code: highlight.code },
      {
        color: highlight.color,
        fill: highlight.fill,
        outline: highlight.outline,
        startFrame: currentMapFrame(entry),
        drawFrames: shapeDrawOn.value ? Math.round(4 * entry.frameRate) : 0,
        terrain: terrain.value
      }
    );
    const drawn = shapeDrawOn.value ? ` and draws on from ${entry.time.toFixed(2)} s over 4 s` : "";
    log(`"${highlight.name}" added as a shape layer (${made.rings} ${made.rings === 1 ? "path" : "paths"}, ${made.points} points)${drawn}. It follows the map; restyle it like any shape layer`, made.expressionErrors.length ? "fail" : "ok");
  });

/** Writes what is on this map (pins, routes, outlines, callouts, highlighted areas) as a GeoJSON file. */
export const exportGeoJson = () =>
  run("export", async () => {
    const entry = (await readMaps()).find((m) => m.mapId === selectedId.value);
    if (!entry) {
      log("create or select a map first", "muted");
      return;
    }
    const layers = await callHost<ExportLayer[]>("exportLayers", { mapId: entry.mapId });
    const named = highlights.value.filter((h) => isAreaCode(h.code) && areas.value[areaIdOf(h.code)]);
    const { geojson, skipped } = buildGeoJson(
      layers,
      named.map((h) => ({ name: h.name, polygons: areas.value[areaIdOf(h.code)] })),
      entry.mapCompName
    );
    if (!geojson.features.length) {
      log("nothing on this map can go out as GeoJSON yet: add pins, routes, outlines or callouts first", "muted");
      return;
    }
    const path = await callHost<string | null>("saveTextFile", { text: JSON.stringify(geojson), suggestedName: `${entry.mapCompName}.geojson` });
    if (!path) {
      log("export cancelled", "muted");
      return;
    }
    log(
      `${geojson.features.length} ${geojson.features.length === 1 ? "feature" : "features"} written to ${path}${skipped ? ` (${skipped} layers had no points left to read)` : ""}`,
      "ok"
    );
  });

export function removeDistrictSet(iso: string): void {
  try {
    removeDistricts(iso);
    resetPlaceIndex();
    districtSets.value++;
  } catch (error) {
    fail("removing districts", error);
  }
}

/** A district from a search result (its country and id). */
export function toggleDistrictById(country: string, id: string): void {
  const unit = districtsOf(country).find((u) => u.id === id);
  if (unit) toggleProvinceHighlight(unit);
  else log("that district's boundaries are no longer installed", "fail");
}

/** Highlights a province (or removes it again): its polygons come from the bundled province data. */
export function toggleProvinceHighlight(province: Province): void {
  const code = `${AREA_PREFIX}${province.id}`;
  const had = highlights.value.some((h) => h.code === code);
  if (!had && Object.keys(areas.value).length >= MAX_AREAS) {
    log(`a map can highlight up to ${MAX_AREAS} provinces and custom areas`, "muted");
    return;
  }
  const geometry = simplifyPolygons(province.polygons, AREA_MAX_POINTS);
  void setHighlights(toggleHighlight(highlights.value, code, province.name), had ? areas.value : { ...areas.value, [province.id]: geometry });
  log(had ? `${province.name} is no longer highlighted` : `${province.name} highlighted: render to get it as its own layer above the basemap`, "ok");
}

/** A province from a search result (its country and id). */
export function toggleProvinceById(country: string, id: string): void {
  const province = provincesOf(country).find((p) => p.id === id);
  if (province) toggleProvinceHighlight(province);
  else log("the province data for that country is missing from this build", "fail");
}

export function toggleCountryHighlight(code: string, name: string): void {
  const had = highlights.value.some((h) => h.code === code);
  void setHighlights(toggleHighlight(highlights.value, code, name));
  log(had ? `${name} is no longer highlighted` : `${name} highlighted: render to get it as its own layer above the basemap`, "ok");
}

export const changeRelief = (on: boolean) =>
  run("relief", async () => {
    reliefOn.value = on;
    setPreviewStyle(basemap.value, projection.value, look());
    if (selectedId.value) {
      await callHost("setMapSettings", { mapId: selectedId.value, relief: on });
      await readMaps();
    }
  });

/** Bumped when an imagery pack arrives, so the Look sheet redraws. */
export const imageryVersion = signal(0);

/** Downloads a satellite or relief pack from the project's GitHub release into the user data folder. */
export const downloadImageryPack = (pack: ImageryPack) =>
  run("download imagery", async () => {
    const info = IMAGERY_INFO[pack];
    const stopper = new AbortController();
    const cancel = () => stopper.abort();
    const label = `Downloading ${info.label}`;
    progress.value = { label, done: 0, total: info.bytes, cancel };
    const started = performance.now();
    await downloadImagery(pack, { signal: stopper.signal, onProgress: (done, total) => (progress.value = { label, done, total, cancel }) });
    imageryVersion.value++;
    setPreviewStyle(basemap.value, projection.value, look());
    log(`${info.label} installed (${mb(info.bytes)} in ${((performance.now() - started) / 1000).toFixed(1)} s) · ${info.attribution}`, "ok");
  });

/** Changes how the layers this map generates look (null in a field means "follow the look"). */
export const changeLayerStyle = (next: Partial<LayerStyleOverride>) =>
  run("layer style", async () => {
    layerStyle.value = normaliseLayerStyle({ ...layerStyle.value, ...next });
    if (selectedId.value) {
      await callHost("setMapSettings", { mapId: selectedId.value, layerStyle: layerStyle.value });
      await readMaps();
    }
  });

/** Takes the colour and stroke of the layer selected in After Effects for the layers the panel makes. */
export const pickUpLayerStyle = () =>
  run("style from a layer", async () => {
    if (!selectedId.value) return;
    const found = await callHost<{ accent: string; stroke: number | null; from: string }>("readLayerStyle", { mapId: selectedId.value });
    layerStyle.value = normaliseLayerStyle({ ...layerStyle.value, accent: found.accent, stroke: found.stroke ?? layerStyle.value.stroke });
    await callHost("setMapSettings", { mapId: selectedId.value, layerStyle: layerStyle.value });
    await readMaps();
    log(`new pins, routes and callouts take their colour ${found.accent} from "${found.from}"`, "ok");
  });

/** The names already on the map (Auto labels and the numbers of a data map) take the template's new look, at once. */
async function restylePlacedLabels(): Promise<void> {
  const mapId = selectedId.value;
  if (!mapId) return;
  let names = 0;
  let dotsMissing = 0;
  for (const kind of ["label", "value"]) {
    const made = await restyleLabels(mapId, { template: currentLabelTemplate.value, kind, onProgress: (done, total) => (progress.value = { label: "Restyling names", done, total }) });
    names += made.labels;
    if (kind === "label") dotsMissing = made.dotsMissing;
  }
  // Bigger or smaller names need different room, so the ones on the map are placed again.
  let moved = 0;
  let hidden = 0;
  if (names) {
    const again = await repositionLabels(mapId, {
      template: currentLabelTemplate.value,
      terrain: terrain.value,
      zones: keepOut.value,
      onProgress: (done, total) => (progress.value = { label: "Moving names", done, total })
    });
    moved = again.moved;
    hidden = again.hidden;
  }
  if (names) {
    const room = moved ? `, ${moved} placed again${hidden ? ` (${hidden} no longer fit and stay hidden)` : ""}` : "";
    log(`${names} names on the map restyled${room}${dotsMissing ? `; ${dotsMissing} have no dot yet: place the names again to get dots` : ""}`, "ok");
  }
}

/** Changes how the names on this map look (a null field follows the look), on the names already placed too. */
export const changeLabelTemplate = (next: Partial<LabelTemplateOverride>) =>
  run("label template", async () => {
    labelTemplate.value = normaliseLabelTemplate({ ...labelTemplate.value, ...next });
    if (selectedId.value) {
      await callHost("setMapSettings", { mapId: selectedId.value, labelTemplate: labelTemplate.value });
      await readMaps();
      await restylePlacedLabels();
    }
  });

/** Takes the colour, size, halo and font of the text layer selected in After Effects for new labels. */
export const pickUpLabelStyle = () =>
  run("label style from a layer", async () => {
    if (!selectedId.value) return;
    const found = await callHost<{ from: string; color: string | null; size: number; haloColor: string | null; halo: number; font: string | null; caps: boolean | null }>("readLabelStyle", {
      mapId: selectedId.value
    });
    labelTemplate.value = normaliseLabelTemplate({
      ...labelTemplate.value,
      color: found.color ?? labelTemplate.value.color,
      countryColor: found.color ?? labelTemplate.value.countryColor,
      haloColor: found.haloColor ?? labelTemplate.value.haloColor,
      halo: found.halo,
      size: found.size,
      font: found.font,
      caps: found.caps ?? labelTemplate.value.caps
    });
    await callHost("setMapSettings", { mapId: selectedId.value, labelTemplate: labelTemplate.value });
    await readMaps();
    await restylePlacedLabels();
    log(`the names follow "${found.from}": ${found.font ?? "its font"} at ${found.size} px${found.color ? `, ${found.color}` : ""}. Latin, Cyrillic and Greek names use that font; other scripts keep fonts that shape them correctly`, "ok");
  });

const storeKeepOut = async (next: KeepOutZone[]) => {
  keepOut.value = next;
  if (selectedId.value) {
    await callHost("setMapSettings", { mapId: selectedId.value, keepOut: next });
    await readMaps();
  }
};

/** Turns one of the usual title areas on or off. */
export const toggleKeepOutPreset = (preset: KeepOutPreset) => run("keep-out zone", () => storeKeepOut(togglePreset(keepOut.value, preset)));

/** Keeps names away from the layers selected in After Effects, for as long as they are on screen. */
export const keepOutFromLayers = () =>
  run("keep-out from layers", async () => {
    if (!selectedId.value) return;
    const found = await callHost<KeepOutZone[]>("readLayerBounds", { mapId: selectedId.value });
    const zones = normaliseKeepOut(found);
    if (!zones.length) return;
    await storeKeepOut(addZones(keepOut.value, zones));
    log(`names will keep away from ${zones.map((zone) => zone.name).join(", ")}`, "ok");
  });

export const removeKeepOut = (id: string) => run("keep-out zone", () => storeKeepOut(keepOut.value.filter((zone) => zone.id !== id)));

export const changeSky = (on: boolean) =>
  run("sky", async () => {
    skyOn.value = on;
    setPreviewStyle(basemap.value, projection.value, look());
    if (selectedId.value) {
      await callHost("setMapSettings", { mapId: selectedId.value, sky: on });
      await readMaps();
    }
  });

/** The ground's elevation at the map's centre, rounded to 10 m (the level a 3D map's camera counts from). */
export async function groundAtCentre(): Promise<number> {
  const centre = compView()?.center;
  if (!centre) return 0;
  const [elevation] = await groundElevations([centre]).catch(() => [0]);
  return Math.round(elevation / 10) * 10;
}

/** Picks the map's elevation pack (null for a flat map), the strength of its shading, or the 3D height and ground level. */
export const changeTerrain = (next: TerrainSetting | null) =>
  run("terrain", async () => {
    const before = terrain.value;
    let wanted = normaliseTerrain(next);
    // Switching 3D on: the ground level starts at the map centre's elevation, so the camera keeps its height above the ground there.
    if (wanted && wanted.height > 0 && !(before && before.height > 0) && wanted.ground === 0) {
      terrain.value = { ...wanted, height: 0 };
      wanted = { ...wanted, ground: await groundAtCentre() };
    }
    terrain.value = wanted;
    setPreviewStyle(basemap.value, projection.value, look());
    if (selectedId.value) {
      await callHost("setMapSettings", { mapId: selectedId.value, terrain: terrain.value });
      await readMaps();
    }
  });

export async function refreshTerrainPacks(): Promise<void> {
  try {
    terrainPacks.value = await listTerrainPacks();
  } catch (error) {
    fail("listing elevation packs", error);
  }
}

export const changeProjection = (next: MapProjection) =>
  run("projection", async () => {
    projection.value = next;
    setPreviewStyle(basemap.value, next);
    if (selectedId.value) {
      await callHost("setMapSettings", { mapId: selectedId.value, projection: next });
      await readMaps();
    }
  });

export const runAutoLabels = () =>
  run("labels", async () => {
    const mapId = selectedId.value;
    if (!mapId) return;
    const stopper = new AbortController();
    const cancel = () => stopper.abort();
    progress.value = { label: "Choosing names for the whole timeline", done: 0, total: 1, cancel };
    const choice = labelLanguage.value;
    const fixed = choice !== "local" && choice !== "local+en";
    const result = await autoLabels(mapId, {
      language: fixed ? { kind: "fixed", language: choice as NameLanguage } : { kind: "local" },
      english: choice === "local+en",
      countries: labelKinds.value.countries,
      places: labelKinds.value.places,
      water: labelKinds.value.water,
      land: labelKinds.value.land,
      city: labelKinds.value.city,
      regions: regionNames(basemap.value).map((name) => regionArchivePath(name)),
      theme: currentTheme.value,
      maxLabels: LABEL_DENSITIES[labelDensity.value].max,
      terrain: terrain.value,
      template: currentLabelTemplate.value,
      design: currentLabelDesign.value,
      designImages: labelImageFolders.value,
      zones: keepOut.value,
      signal: stopper.signal,
      // Names arrive in After Effects a few at a time, so it stays responsive and can be cancelled.
      onProgress: (done, total) => (progress.value = { label: "Adding names", done, total, cancel })
    });
    const summary = `${result.labels} of ${result.planned} names added (${result.layers} layers, ${result.removed} old layers replaced) in ${result.seconds.toFixed(1)} s`;
    if (result.cancelled) log(`labels cancelled: ${summary}. The names added so far stay; Remove labels takes them away`, "muted");
    else log(`labels: ${summary}`, result.expressionErrors.length ? "fail" : "ok");
  });

export const removeLabels = () =>
  run("remove labels", async () => {
    const mapId = selectedId.value;
    if (!mapId) return;
    const result = await callHost<{ removed: number }>("removeLabels", { mapId });
    log(result.removed ? `removed ${result.removed} label layers (one undo step)` : "this map has no labels from Auto labels", result.removed ? "ok" : "muted");
  });

export const animateBorders = () =>
  run("borders", async () => {
    const list = await readMaps();
    const entry = list.find((m) => m.mapId === selectedId.value);
    if (!entry) return;
    await callHost("setControlKeys", { mapId: entry.mapId, name: "Borders Draw-on", times: [entry.time, entry.time + 4], values: [0, 100] });
    log(`borders draw on from ${entry.time.toFixed(2)} s over 4 s (the "Borders Draw-on" slider on the map layer; render to see it)`, "ok");
  });

export const buildSample = () =>
  run("sample", async () => {
    const wanted = ["paris-wide", "paris", "tokyo-wide", "tokyo"].filter((name) => regions.value.some((r) => r.name === name));
    progress.value = { label: "Building the world flight sample", done: 0, total: 1 };
    const demo = await buildWorldFlight(
      {
        basemap: wanted.length ? { kind: "regions", names: wanted } : { kind: "world" },
        firstZoom: wanted.includes("paris") ? undefined : 5.2,
        secondZoom: wanted.includes("tokyo") ? undefined : 5.2
      },
      (line) => log(`sample: ${line}`, "muted")
    );
    const missing = ["paris", "tokyo"].filter((name) => !wanted.includes(name));
    if (missing.length) log(`sample: download regions named ${missing.join(" and ")} (Download this area) and build it again to fly down to street level`, "muted");
    log(`world flight sample built in "${demo.sceneName}": render it to see the basemap`, demo.expressionErrors.length ? "fail" : "ok");
    screen.value = "main";
    await refreshMaps(true);
  });

/** A data map from the bundled data alone: every country coloured by its population, spikes for the numbers, a legend. */
export const buildNumbersSample = () =>
  run("sample", async () => {
    progress.value = { label: "Building the numbers sample", done: 0, total: 1 };
    const countries = placeIndex().records.filter((record) => record.kind === "country" && record.population > 0 && record.names.en);
    const table = readDataTable(
      [["Country", "Population (millions)"], ...countries.map((record) => [record.names.en as string, String(Math.round(record.population / 1e5) / 10)])],
      "population.csv"
    );
    if (!table) {
      log("the bundled data has no populations to show", "fail");
      return;
    }
    await createMapComp({ name: "Numbers sample", width: 1920, height: 1080, duration: 10, frameRate: 25, view: { center: { lat: 22, lng: 12 }, zoom: 1.55, bearing: 0, pitch: 0 }, newScene: true });
    await refreshMaps(true);
    openDataTable(table);
    dataLevel.value = "country";
    dataSteps.value = 5;
    await applyDataFillNow();
    spikeHeight.value = 140;
    await addDataSpikesNow();
    legendCorner.value = "bottomLeft";
    await addDataLegendNow();
    log("numbers sample built: every country by its population, spikes for the numbers, a legend. Render to see the colours; try bubbles, heat or your own CSV in the Numbers sheet", "ok");
    screen.value = "main";
  });

export function renderBasemap(quality: RenderQuality): void {
  const entry = selected.value;
  if (!entry) return;
  const settings = quality === "preview" ? PREVIEW_SETTINGS : renderSettings.value;
  renderQueue.add({ mapId: entry.mapId, quality, settings, basemap: basemap.value, theme: currentTheme.value, relief: reliefOn.value, highlights: highlights.value, areas: areas.value, highlightLayers: highlightLayers.value, sky: skyOn.value, terrain: terrain.value, osmData: osmData.value, dataFill: dataFill.value, heat: heat.value, lookDetails: lookDetails.value, own: ownImagery.value }, entry.mapCompName);
  tab.value = "render";
}

export async function updateRenderSettings(change: Partial<RenderSettings>): Promise<void> {
  const entry = maps.value.find((m) => m.mapId === selectedId.value);
  if (!entry) return;
  const next = normaliseSettings({ ...normaliseSettings(entry.render, DEFAULT_FINAL_SETTINGS), ...change }, DEFAULT_FINAL_SETTINGS);
  maps.value = maps.value.map((m) => (m.mapId === entry.mapId ? { ...m, render: next } : m));
  try {
    await callHost("setMapSettings", { mapId: entry.mapId, render: next });
  } catch (error) {
    fail("saving render settings", error);
  }
}

export function togglePass(pass: PassId, on: boolean): void {
  const passes = new Set(renderSettings.value.passes);
  if (on) passes.add(pass);
  else passes.delete(pass);
  void updateRenderSettings({ passes: PASS_IDS.filter((p) => passes.has(p)) });
}

/** A table of numbers the user brought in, and what the Data sheet is set to. */
export const dataTable = signal<DataTable | null>(null);
export const dataSheetOpen = signal(false);
export const dataKeyColumn = signal(0);
export const dataValueColumn = signal(1);
export const dataRamp = signal<RampId>(DEFAULT_DATA_FILL.ramp);
export const dataSteps = signal(DEFAULT_DATA_FILL.steps);
export const dataMethod = signal<ScaleMethod>(DEFAULT_DATA_FILL.method);
export const dataOpacity = signal(DEFAULT_DATA_FILL.opacity);
export const dataNoData = signal<string | null>(null);
/** null: the look decides which end of the ramp is "much". */
export const dataReverse = signal<boolean | null>(null);
/** What the rows are about: worked out from the table, or set by hand. */
/** What the rows of a table are taken to be about: worked out, or told. */
export type DataLevelChoice = "auto" | "country" | "province" | "district";
export const dataLevel = signal<DataLevelChoice>("auto");
/** For provinces: the country they belong to (null lets the table decide). */
export const dataCountry = signal<string | null>(null);
export const dataMessage = signal<string | null>(null);
/** How the table holds years, when it does, and whether the map moves through them. */
export const dataSeriesShape = signal<SeriesShape | null>(null);
export const dataAnimate = signal(true);
/** The palette a table of categories is coloured with. */
export const dataPalette = signal<CategoryPaletteId>("safe");
/** Whether the chosen "Colour by" column holds categories rather than amounts. */
export const dataIsCategory = (table: DataTable | null = dataTable.value, column = dataValueColumn.value): boolean => {
  const c = table?.columns[column];
  return !!c && isCategoryColumn(c);
};
/** A table of flows: which columns say where from, where to, and how much. */
export const flowFrom = signal(-1);
export const flowTo = signal(-1);
export const flowValue = signal(-1);
export const flowWidth = signal(14);
export const flowArrows = signal(true);
export const flowSeconds = signal(4);
/** Every arc in its step's colour of the ramp, instead of the accent colour. */
export const flowColoured = signal(false);

/** Draws every row of the table as an arc whose width follows the value. */
export const drawFlows = () =>
  run("flows", async () => {
    const table = dataTable.value;
    const entry = (await readMaps()).find((m) => m.mapId === selectedId.value);
    if (!table || !entry) {
      log("create or select a map first", "muted");
      return;
    }
    if (flowFrom.value < 0 || flowTo.value < 0 || flowValue.value < 0 || flowFrom.value === flowTo.value) {
      log("pick the From, To and Amount columns first", "muted");
      return;
    }
    const rows = flowRows(table, flowFrom.value, flowTo.value, flowValue.value);
    if (!rows.length) {
      log("no row has a place at both ends and an amount above zero", "fail");
      return;
    }
    const start = currentMapFrame(entry);
    const frames = Math.max(1, Math.round(flowSeconds.value * entry.frameRate));
    const stopper = new AbortController();
    progress.value = { label: "Drawing flows", done: 0, total: rows.length, cancel: () => stopper.abort() };
    try {
      const made = await addFlows(entry.mapId, placeIndex(), rows, {
        startFrame: start,
        endFrame: start + frames,
        theme: currentTheme.value,
        style: currentLayerStyle.value,
        terrain: terrain.value,
        maxWidth: flowWidth.value,
        arrows: flowArrows.value,
        comet: routeComet.value,
        byColour: flowColoured.value,
        ramp: dataRamp.value,
        steps: dataSteps.value,
        method: dataMethod.value,
        reverse: dataReverse.value ?? currentTheme.value.dark,
        signal: stopper.signal,
        onProgress: (done, total) => (progress.value = { label: "Drawing flows", done, total, cancel: () => stopper.abort() })
      });
      const unknown = made.unknown.length ? `; ${made.unknown.length} ${made.unknown.length === 1 ? "place" : "places"} not found: ${made.unknown.slice(0, 4).join(", ")}${made.unknown.length > 4 ? "..." : ""}` : "";
      const dropped = made.dropped ? `; ${made.dropped} smaller flows left out` : "";
      log(
        `${made.drawn} ${made.drawn === 1 ? "flow" : "flows"} drawn from ${entry.time.toFixed(2)} s over ${flowSeconds.value} s, the widest standing for ${made.legend[0]?.label ?? ""}${made.cancelled ? " (stopped)" : ""}${unknown}${dropped}`,
        made.expressionErrors.length ? "fail" : made.drawn ? "ok" : "muted"
      );
    } finally {
      progress.value = null;
    }
  });

/** The map's furniture: a scale bar and a north arrow, both in the corner they are given. */
export const scaleBarUnits = signal<ScaleUnits>("metric");
export const scaleBarCorner = signal<LegendCorner>("bottomLeft");
export const northCorner = signal<LegendCorner>("topRight");
export const northLetter = signal(true);

export const addMapScaleBar = () =>
  run("furniture", async () => {
    if (!selectedId.value) return;
    const made = await addScaleBar(selectedId.value, {
      theme: currentTheme.value,
      template: currentLabelTemplate.value,
      corner: scaleBarCorner.value,
      units: scaleBarUnits.value
    });
    if (made.expressionErrors.length) log(`scale bar expression problems: ${made.expressionErrors.join("; ")}`, "fail");
    else log("a scale bar is on the scene. It measures itself from the map on every frame, so it stays right through a zoom; move it, restyle it, keyframe it", "ok");
  });

export const addMapNorthArrow = () =>
  run("furniture", async () => {
    if (!selectedId.value) return;
    const made = await addNorthArrow(selectedId.value, {
      theme: currentTheme.value,
      template: currentLabelTemplate.value,
      corner: northCorner.value,
      letter: northLetter.value ? "N" : null
    });
    if (made.expressionErrors.length) log(`north arrow expression problems: ${made.expressionErrors.join("; ")}`, "fail");
    else log("a north arrow is on the scene. It turns with the map, and on the globe it follows the pole", "ok");
  });

export const removeMapFurniture = (kind: FurnitureKind) =>
  run("furniture", async () => {
    if (!selectedId.value) return;
    const gone = await removeFurniture(selectedId.value, kind);
    const what = kind === "scaleBar" ? "scale bar" : "north arrow";
    log(gone.removed ? `the ${what} is off the scene` : `this map has no ${what}`, gone.removed ? "ok" : "muted");
  });

export const minimapCorner = signal<LegendCorner>("topLeft");
export const minimapZoomOut = signal(4);

export const addMapMinimap = () =>
  run("furniture", async () => {
    if (!selectedId.value) return;
    const made = await addMinimap(selectedId.value, {
      theme: currentTheme.value,
      corner: minimapCorner.value,
      zoomOut: minimapZoomOut.value
    });
    if (made.expressionErrors.length) log(`inset expression problems: ${made.expressionErrors.join("; ")}`, "fail");
    else {
      await refreshMaps();
      log(`"${made.insetComp}" is in the scene at zoom ${made.zoom.toFixed(1)}, with a box showing where this map is looking. It is a map of its own: pick it above to give it a look and render it`, "ok");
    }
  });

export const removeMapMinimap = () =>
  run("furniture", async () => {
    if (!selectedId.value) return;
    const gone = await removeMinimap(selectedId.value);
    if (gone.removed) await refreshMaps();
    log(gone.removed ? "the inset map is off the scene" : "this map has no inset", gone.removed ? "ok" : "muted");
  });

/**
 * The feature browser: every shape the panel can put on a map, filtered by name or by a property,
 * and acted on together. The rows come from src/panel/features.ts, the filtering from core.
 */
export const featureSheetOpen = signal(false);
export const featureScope = signal<FeatureScope>("country");
export const featureCountry = signal<string | null>(null);
export const featureText = signal("");
export const featureFilterText = signal("");
export const featureSort = signal<{ key: string; descending: boolean } | null>(null);
export const featurePicks = signal<string[]>([]);
/** What the user changed about features, kept with the map (core/data/featureList.ts). */
export const featureEdits = signal<FeatureEdits>({});
/** The row whose properties are open for editing. */
export const featureEditing = signal<string | null>(null);

async function saveFeatureEdits(next: FeatureEdits): Promise<void> {
  featureEdits.value = next;
  if (selectedId.value) {
    await callHost("setMapSettings", { mapId: selectedId.value, featureEdits: next });
    await readMaps();
  }
}

/** Sets a property of a feature (a number when it reads as one); an empty value takes it away. */
export const setFeatureProperty = (rowId: string, key: string, text: string) =>
  run("features", async () => {
    await saveFeatureEdits(editFeature(featureEdits.value, rowId, key, text.trim() === "" ? null : typedValue(text)));
  });

/** Renames a feature: the name its highlights, shapes and labels will carry. */
export const renameFeature = (rowId: string, name: string) =>
  run("features", async () => {
    if (!name.trim()) return;
    await saveFeatureEdits(editFeature(featureEdits.value, rowId, "name", name.trim()));
  });

/** Puts a feature back as its data has it. */
export const resetFeature = (rowId: string) =>
  run("features", async () => {
    const next = { ...featureEdits.value };
    delete next[rowId];
    await saveFeatureEdits(next);
  });

/** How many features one click may turn into shape layers, for the reason the data map has a cap. */
export const MAX_FEATURE_SHAPES = 40;

const featureSources = (): FeatureSources => ({
  country: featureCountry.value,
  fill: dataFill.value,
  areas: areas.value,
  imported: imported.value?.areas ?? [],
  counts: featureCounts.value
});

/** The rows of the browser as it stands: the scope, the words typed and the filter written. */
export const featureView = computed(() => {
  const rows = applyFeatureEdits(featureRows(featureScope.value, featureSources()), featureEdits.value);
  const filter = parseFilter(featureFilterText.value);
  const found = filterFeatures(rows, { text: featureText.value, filter, sort: featureSort.value });
  return { ...found, keys: featureKeys(rows), filter, filterFailed: featureFilterText.value.trim().length > 0 && !filter };
});

export function toggleFeaturePick(id: string): void {
  const picks = featurePicks.value;
  featurePicks.value = picks.includes(id) ? picks.filter((pick) => pick !== id) : [...picks, id];
}

export function pickEveryFeature(): void {
  const shown = featureView.value.rows.map((row) => row.id);
  featurePicks.value = shown.every((id) => featurePicks.value.includes(id)) ? [] : shown;
}

const pickedFeatures = (): FeatureRow[] => featureView.value.rows.filter((row) => featurePicks.value.includes(row.id));

/** Flies the preview to one feature, framing the whole of it. */
export function goToFeature(row: FeatureRow): void {
  const polygons = featurePolygons(row, featureSources());
  if (!polygons || !polygons.length) {
    log(`no outline for "${row.name}" in this build`, "muted");
    return;
  }
  const points: { lat: number; lng: number }[] = [];
  for (const polygon of polygons) for (const point of polygon[0] ?? []) points.push({ lng: point[0], lat: point[1] });
  if (!points.length) return;
  const current = compView();
  showCompView(fitPoints(points, compSize(), { bearing: current?.bearing ?? 0, pitch: 0, padding: 0.1, maxZoom: 12 }), true);
  lastPlaceName.value = row.name;
}

/** Highlights every ticked feature at once: countries by their code, everything else by its outline. */
export const highlightPickedFeatures = () =>
  run("features", async () => {
    const picks = pickedFeatures();
    if (!picks.length) {
      log("tick some features first", "muted");
      return;
    }
    const sources = featureSources();
    let next = highlights.value;
    const geometry: Areas = { ...areas.value };
    const missing: string[] = [];
    let added = 0;
    let full = false;
    for (const row of picks) {
      if (row.source === "country") {
        const code = String(row.props.code ?? "");
        if (code && !next.some((highlight) => highlight.code === code)) {
          next = toggleHighlight(next, code, row.name);
          added++;
        }
        continue;
      }
      const polygons = featurePolygons(row, sources);
      if (!polygons) {
        missing.push(row.name);
        continue;
      }
      const thinned = simplifyPolygons(polygons, AREA_MAX_POINTS);
      if (!thinned.length) {
        missing.push(row.name);
        continue;
      }
      const code = row.source === "import" ? madeAreaCode(row.name, thinned) : `${AREA_PREFIX}${row.id.slice(row.id.indexOf(":") + 1)}`;
      const id = code.slice(AREA_PREFIX.length);
      if (!geometry[id] && Object.keys(geometry).length >= MAX_AREAS) {
        full = true;
        break;
      }
      geometry[id] = thinned;
      if (!next.some((highlight) => highlight.code === code)) {
        next = toggleHighlight(next, code, row.name);
        added++;
      }
    }
    await setHighlights(next, geometry);
    const notes = [missing.length ? `${missing.length} had no outline in this build` : "", full ? `the map holds up to ${MAX_AREAS} areas` : ""].filter(Boolean).join("; ");
    log(added ? `${added} highlighted${notes ? ` (${notes})` : ""}. Render to get them as layers above the basemap` : notes || "those features are highlighted already", added ? "ok" : "muted");
  });

/** Every ticked feature as its own editable shape layer. */
export const shapePickedFeatures = () =>
  run("features", async () => {
    const picks = pickedFeatures();
    const entry = (await readMaps()).find((m) => m.mapId === selectedId.value);
    if (!entry || !picks.length) {
      log(entry ? "tick some features first" : "create or select a map first", "muted");
      return;
    }
    const sources = featureSources();
    const style = currentLayerStyle.value;
    const wanted = picks.slice(0, MAX_FEATURE_SHAPES);
    let made = 0;
    const missing: string[] = [];
    // A large outline takes a moment to build, so the panel says how far it is and can be stopped.
    const stopper = new AbortController();
    const label = "Adding shape layers";
    progress.value = { label, done: 0, total: wanted.length, cancel: () => stopper.abort() };
    try {
      for (const row of wanted) {
        if (stopper.signal.aborted) break;
        const polygons = featurePolygons(row, sources);
        if (!polygons) {
          missing.push(row.name);
          continue;
        }
        await addFeatureShape(
          entry.mapId,
          { name: row.name, polygons, code: row.id },
          { color: style.accent, fill: 0, outline: style.stroke, startFrame: currentMapFrame(entry), drawFrames: shapeDrawOn.value ? Math.round(4 * entry.frameRate) : 0, terrain: terrain.value }
        );
        made++;
        progress.value = { label, done: made, total: wanted.length, cancel: () => stopper.abort() };
      }
    } finally {
      progress.value = null;
    }
    const left = picks.length - wanted.length;
    const notes = [
      missing.length ? `${missing.length} had no outline` : "",
      left ? `${left} left out (${MAX_FEATURE_SHAPES} at a time)` : "",
      stopper.signal.aborted ? "stopped" : ""
    ]
      .filter(Boolean)
      .join("; ");
    log(made ? `${made} shape ${made === 1 ? "layer" : "layers"} added${notes ? ` (${notes})` : ""}. They follow the map; restyle them like any shape layer` : notes || "nothing to add", made ? "ok" : "muted");
  });

/** The outline of every ticked feature as one area, with the borders between the touching ones gone. */
export const mergePickedFeatures = () =>
  run("features", async () => {
    const picks = pickedFeatures();
    if (picks.length < 2) {
      log("tick at least two features to merge them", "muted");
      return;
    }
    const sources = featureSources();
    const parts = picks.map((row) => ({ row, polygons: featurePolygons(row, sources) })).filter((part): part is { row: FeatureRow; polygons: AreaGeometry } => !!part.polygons);
    if (parts.length < 2) {
      log("this build has outlines for fewer than two of those", "fail");
      return;
    }
    const name = combinedName(parts.map((part) => part.row.name));
    const merged = mergeAreas(parts.map((part) => part.polygons));
    const kept = await addMadeArea(name, merged, highlights.value, undefined);
    if (kept) log(`"${name}" made from ${parts.length} features (${Math.round(areaKm2(kept)).toLocaleString("en-US")} km2). Render to see it, or add it as a shape layer`, "ok");
  });

/** How many points fell inside each feature, the last time they were counted. */
export const featureCounts = signal<Record<string, number>>({});

/** Every part of a ticked outline as an area of its own: a mainland away from its islands. */
export const explodePickedFeatures = () =>
  run("features", async () => {
    const picks = pickedFeatures();
    if (picks.length !== 1) {
      log("tick one feature to break it into its parts", "muted");
      return;
    }
    const polygons = featurePolygons(picks[0], featureSources());
    if (!polygons) {
      log(`no outline for "${picks[0].name}" in this build`, "fail");
      return;
    }
    const parts = explodeArea(polygons);
    if (parts.length < 2) {
      log(`"${picks[0].name}" is one piece already`, "muted");
      return;
    }
    let next = highlights.value;
    const geometry: Areas = { ...areas.value };
    let added = 0;
    for (let i = 0; i < parts.length; i++) {
      const thinned = simplifyPolygons(parts[i].polygons, AREA_MAX_POINTS);
      if (!thinned.length) continue;
      if (Object.keys(geometry).length >= MAX_AREAS) break;
      const name = `${picks[0].name} ${i + 1}`;
      const code = madeAreaCode(name, thinned);
      geometry[code.slice(AREA_PREFIX.length)] = thinned;
      if (!next.some((highlight) => highlight.code === code)) next = toggleHighlight(next, code, name);
      added++;
    }
    await setHighlights(next, geometry);
    const left = parts.length - added;
    log(`"${picks[0].name}" broken into ${added} ${added === 1 ? "part" : "parts"}, largest first${left > 0 ? `, ${left} left out (a map holds ${MAX_AREAS} areas)` : ""}`, added ? "ok" : "fail");
  });

/** The ticked areas taken out of the first one, as holes. */
export const cutPickedFeatures = () =>
  run("features", async () => {
    const picks = pickedFeatures();
    if (picks.length < 2) {
      log("tick the area to cut from first, then the ones to take out of it", "muted");
      return;
    }
    const sources = featureSources();
    const host = featurePolygons(picks[0], sources);
    if (!host) {
      log(`no outline for "${picks[0].name}" in this build`, "fail");
      return;
    }
    let result = host;
    let cut = 0;
    let clipped = 0;
    let outside = 0;
    for (const row of picks.slice(1)) {
      const polygons = featurePolygons(row, sources);
      if (!polygons) continue;
      const step = cutHole(result, polygons);
      result = step.polygons;
      cut += step.cut;
      clipped += step.clipped;
      outside += step.outside;
    }
    if (!cut) {
      log(`nothing was cut: none of the shapes touches "${picks[0].name}"`, "fail");
      return;
    }
    const name = `${picks[0].name} without ${picks.length - 1} ${picks.length === 2 ? "shape" : "shapes"}`;
    const kept = await addMadeArea(name, result, highlights.value, undefined);
    if (!result.length) {
      log(`nothing is left of "${picks[0].name}": the shapes cover all of it`, "fail");
      return;
    }
    const holes = cut - clipped;
    const said = [holes ? `${holes} ${holes === 1 ? "hole" : "holes"} cut` : "", clipped ? `${clipped} overlapping ${clipped === 1 ? "shape" : "shapes"} clipped off` : "", outside ? `${outside} left alone (${outside === 1 ? "it does" : "they do"} not touch it)` : ""].filter(Boolean).join(", ");
    if (kept) log(`"${name}" made: ${said}${result.length > 1 ? `, in ${result.length} pieces` : ""}`, "ok");
  });

/** How many of the imported points fall inside each ticked feature, as a property to sort and filter on. */
export const countPointsInPicked = () =>
  run("features", async () => {
    const picks = pickedFeatures();
    const places = imported.value?.places ?? [];
    if (!picks.length || !places.length) {
      log(picks.length ? "import a file of points first (KML, GeoJSON, CSV or a shapefile)" : "tick some features first", "muted");
      return;
    }
    const sources = featureSources();
    const counts: Record<string, number> = { ...featureCounts.value };
    let counted = 0;
    let missing = 0;
    for (const row of picks) {
      const polygons = featurePolygons(row, sources);
      if (!polygons) {
        missing++;
        continue;
      }
      counts[row.id] = pointsInside(polygons, places).length;
      counted++;
    }
    featureCounts.value = counts;
    const busiest = picks
      .filter((row) => counts[row.id] !== undefined)
      .sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0))
      .slice(0, 3)
      .map((row) => `${row.name} ${counts[row.id]}`)
      .join(", ");
    log(
      counted
        ? `${places.length} imported ${places.length === 1 ? "point" : "points"} counted in ${counted} ${counted === 1 ? "feature" : "features"} (${busiest}). Sort or filter on "inside"${missing ? `; ${missing} had no outline` : ""}`
        : "none of those has an outline in this build",
      counted ? "ok" : "fail"
    );
  });

/** A line between every pair of ticked features, drawing on together: a network map. */
export const connectPickedFeatures = () =>
  run("features", async () => {
    const picks = pickedFeatures();
    const entry = (await readMaps()).find((m) => m.mapId === selectedId.value);
    if (!entry || picks.length < 2) {
      log(entry ? "tick at least two features to join them" : "create or select a map first", "muted");
      return;
    }
    const sources = featureSources();
    const places = picks
      .map((row) => ({ row, centre: featureCentre(row, sources) }))
      .filter((place): place is { row: FeatureRow; centre: { lat: number; lng: number } } => !!place.centre)
      .map((place) => ({ name: place.row.name, lat: place.centre.lat, lng: place.centre.lng }));
    if (places.length < 2) {
      log("this build has outlines for fewer than two of those", "fail");
      return;
    }
    const start = currentMapFrame(entry);
    const made = await addMesh(entry.mapId, places, {
      startFrame: start,
      endFrame: start + Math.max(1, Math.round(flowSeconds.value * entry.frameRate)),
      theme: currentTheme.value,
      style: currentLayerStyle.value,
      terrain: terrain.value,
      neighbours: meshNeighbours.value > 0 ? meshNeighbours.value : undefined
    });
    if (made.expressionErrors.length) log(`connection expression problems: ${made.expressionErrors.join("; ")}`, "fail");
    else log(`${made.lines} ${made.lines === 1 ? "line" : "lines"} drawn between ${places.length} places, all drawing on from ${entry.time.toFixed(2)} s${made.dropped ? `; ${made.dropped} left out` : ""}`, made.lines ? "ok" : "muted");
  });

/** How many nearest neighbours each place joins; 0 joins every pair. */
export const meshNeighbours = signal(0);

/**
 * Live numbers: the table is read from a file on disk, and the panel re-reads it whenever that file
 * changes, so a map can be left open while the numbers behind it are edited elsewhere.
 */
export type WatchedTable = { path: string; name: string; changes: number; at: number; error: string | null };
export const watchedTable = signal<WatchedTable | null>(null);
export const WATCH_EVERY_MS = 2000;

let watchTimer: ReturnType<typeof setInterval> | null = null;
let watchStamp = "";

const stampOf = (path: string): string => {
  try {
    const stat = nodeFs().statSync(path) as { mtimeMs?: number; mtime?: Date; size: number };
    const when = stat.mtimeMs ?? (stat.mtime ? stat.mtime.getTime() : 0);
    return `${when}:${stat.size}`;
  } catch {
    return "";
  }
};

/** Stops watching, leaving the numbers already on the map as they are. */
export function stopWatchingTable(): void {
  if (watchTimer !== null) clearInterval(watchTimer);
  watchTimer = null;
  watchStamp = "";
  watchedTable.value = null;
}

/** Reads the watched file again, keeping the columns the user picked when the headings still fit. */
async function rereadWatchedTable(first: boolean): Promise<void> {
  const watched = watchedTable.value;
  if (!watched) return;
  let text = "";
  try {
    text = nodeFs().readFileSync(watched.path, "utf8") as string;
  } catch (error) {
    watchedTable.value = { ...watched, error: error instanceof Error ? error.message : String(error) };
    return;
  }
  let table: DataTable | undefined;
  try {
    table = importCsvText(text, watched.name).table;
  } catch (error) {
    watchedTable.value = { ...watched, error: error instanceof Error ? error.message : String(error) };
    return;
  }
  if (!table) {
    watchedTable.value = { ...watched, error: `${watched.name} holds no column of numbers to colour places by` };
    return;
  }
  const before = dataTable.value;
  const sameShape = !first && !!before && before.headings.length === table.headings.length && before.headings.every((heading, i) => heading === table.headings[i]);
  if (sameShape) dataTable.value = table;
  else openDataTable(table);
  watchedTable.value = { ...watched, changes: watched.changes + (first ? 0 : 1), at: Date.now(), error: null };
  // Numbers already on the map follow the file; a table that has not been used yet only waits.
  if (!first && dataFill.value) await applyDataFillNow();
}

/** Watches a file of numbers: reads it now, then re-reads it whenever it changes on disk. */
export const watchTableFile = (path: string) => run("live numbers", () => startWatching(path));

/**
 * The watching itself, without the busy flag: pickTableToWatch already holds it while the file
 * dialog is open, and run() does nothing at all while the panel is busy.
 */
async function startWatching(path: string): Promise<void> {
  stopWatchingTable();
  const name = path.split(/[\\/]/).pop() || "table.csv";
  watchedTable.value = { path, name, changes: 0, at: Date.now(), error: null };
  watchStamp = stampOf(path);
  await rereadWatchedTable(true);
  const failed = watchedTable.value?.error;
  if (failed) {
    log(`${name}: ${failed}`, "fail");
    stopWatchingTable();
    return;
  }
  watchTimer = setInterval(() => {
    const stamp = stampOf(path);
    if (!stamp || stamp === watchStamp) return;
    watchStamp = stamp;
    void rereadWatchedTable(false).then(() => {
      const state = watchedTable.value;
      if (state?.error) log(`${state.name}: ${state.error}`, "fail");
      else if (state) log(`${state.name} changed: ${dataTable.value?.rows.length ?? 0} rows read again${dataFill.value ? " and the map coloured again" : ""}`, "ok");
    });
  }, WATCH_EVERY_MS);
  log(`watching ${name} (${dataTable.value?.rows.length ?? 0} rows). Edit and save it anywhere and the map follows`, "ok");
}

/** Picks a file of numbers to watch. */
export const pickTableToWatch = () =>
  run("live numbers", async () => {
    const picked = await callHost<{ path: string; text: string } | null>("openTextFile", { title: "Watch a table of numbers" });
    if (!picked) return;
    await startWatching(picked.path);
  });

/**
 * A camera from Google Earth Studio: the panel builds a scene the size and length of that render and
 * keys this map's camera to theirs, so the panel's layers sit on their footage.
 */
export const earthStudioPins = signal(true);

export const importEarthStudioFile = (path?: string) =>
  run("Earth Studio", async () => {
    let text = "";
    let name = "";
    if (path) {
      text = nodeFs().readFileSync(path, "utf8") as string;
      name = path.split(/[\\/]/).pop() ?? "";
    } else {
      const picked = await callHost<{ path: string; text: string } | null>("openTextFile", { title: "Open an Earth Studio 3D tracking file (JSON)" });
      if (!picked) return;
      text = picked.text;
      name = picked.path.split(/[\\/]/).pop() ?? "";
    }
    const label = "Reading the Earth Studio camera";
    progress.value = { label, done: 0, total: 1 };
    let made;
    try {
      made = await importEarthStudio(text, {
        pinTrackPoints: earthStudioPins.value,
        onProgress: (done, total) => (progress.value = { label, done, total })
      });
    } catch (error) {
      log(`${name || "that file"}: ${error instanceof Error ? error.message : String(error)}`, "fail");
      return;
    } finally {
      progress.value = null;
    }
    selectedId.value = made.map.id;
    screen.value = "main";
    const list = await readMaps();
    const entry = list.find((m) => m.mapId === made.map.id) ?? null;
    if (entry) showMap(entry);
    for (const listener of mapListeners) listener(entry);
    const tilted = made.mostPitch > 25 ? `. The camera tilts to ${Math.round(made.mostPitch)} degrees; a tilted view of hills or towers will not line up as closely as a flat one` : "";
    log(
      `"${made.project.name}" read: ${made.keys} camera keys at ${made.project.frameRate} fps, ${made.project.width}x${made.project.height}${made.pins ? `, ${made.pins} track ${made.pins === 1 ? "point" : "points"} pinned` : ""}. Import your Earth Studio footage and drop it under the map layer${tilted}`,
      "ok"
    );
  });

/**
 * Satellite areas built from Sentinel-2: the European Union photographs the whole world every few
 * days and gives the pictures away, so the panel can build a real satellite basemap for an area with
 * nobody signing up for anything.
 */
export const satellitePacks = signal<SatellitePackInfo[]>([]);
export const satelliteSheet = signal<{ name: string; maxZoom: number; months: number; plan: SatellitePlan | null; looking: boolean; message: string | null } | null>(null);

export async function refreshSatellitePacks(): Promise<void> {
  try {
    satellitePacks.value = await listSatellitePacks();
  } catch (error) {
    fail("reading the satellite areas", error);
  }
}

/** Opens the sheet for the area in the preview, and asks the catalogue what there is. */
export const openSatelliteSheet = () =>
  run("satellite", async () => {
    const view = compView();
    if (!view) {
      log("move the preview over the area you want first", "muted");
      return;
    }
    const suggested = safeRegionName(lastPlaceName.value ?? "satellite");
    satelliteSheet.value = { name: suggested, maxZoom: 14, months: 14, plan: null, looking: true, message: null };
    await planSatelliteNow();
  });

async function planSatelliteNow(): Promise<void> {
  const sheet = satelliteSheet.value;
  const bbox = previewArea();
  if (!sheet || !bbox) return;
  satelliteSheet.value = { ...sheet, looking: true, message: null };
  try {
    const plan = await planSatellite(bbox, { maxZoom: sheet.maxZoom, months: sheet.months });
    const now = satelliteSheet.value;
    if (!now) return;
    satelliteSheet.value = {
      ...now,
      plan,
      looking: false,
      message: plan.scenes.length
        ? `${plan.scenes.length} clear ${plan.scenes.length === 1 ? "scene" : "scenes"} found, newest ${plan.scenes[0].date.slice(0, 10)}. ${plan.tiles.length} tiles to build, about ${(plan.estimateBytes / 1048576).toFixed(0)} MB to download.`
        : "no clear Sentinel-2 scene covers this area in that window. Try more months, or a smaller area."
    };
  } catch (error) {
    const now = satelliteSheet.value;
    if (now) satelliteSheet.value = { ...now, looking: false, plan: null, message: error instanceof Error ? error.message : String(error) };
  }
}

export const changeSatelliteSheet = (change: Partial<{ name: string; maxZoom: number; months: number }>) =>
  run("satellite", async () => {
    const sheet = satelliteSheet.value;
    if (!sheet) return;
    satelliteSheet.value = { ...sheet, ...change };
    if (change.maxZoom !== undefined || change.months !== undefined) await planSatelliteNow();
  });

/** Builds the archive for the area, and gives it to this map as its imagery. */
export const buildSatelliteArea = () =>
  run("satellite", async () => {
    const sheet = satelliteSheet.value;
    if (!sheet?.plan) return;
    const name = safeRegionName(sheet.name);
    if (!isSatelliteName(name)) {
      log("give the area a name of small letters, numbers, dashes or underscores", "muted");
      return;
    }
    const stopper = new AbortController();
    const label = `Building the satellite picture of ${name}`;
    progress.value = { label, done: 0, total: sheet.plan.tiles.length, cancel: () => stopper.abort() };
    const started = performance.now();
    try {
      const made = await buildSatellite(name, sheet.plan, {
        signal: stopper.signal,
        onProgress: (p) => (progress.value = { label: `${label} (${(p.bytes / 1048576).toFixed(1)} MB)`, done: p.done, total: p.total, cancel: () => stopper.abort() }),
        encode: encodeSatelliteTile
      });
      await refreshSatellitePacks();
      satelliteSheet.value = null;
      const seconds = ((performance.now() - started) / 1000).toFixed(0);
      log(
        `"${name}" built: ${made.tiles} tiles from ${made.scenes.length} ${made.scenes.length === 1 ? "scene" : "scenes"} in ${seconds} s, ${(made.downloaded / 1048576).toFixed(1)} MB downloaded, ${(made.bytes / 1048576).toFixed(1)} MB kept${made.cancelled ? " (stopped early)" : ""}`,
        "ok"
      );
      await useSatelliteArea(name);
    } catch (error) {
      fail("building the satellite picture", error);
    } finally {
      progress.value = null;
    }
  });

/** Draws a built area on this map, as imagery over the ground and under the lines. */
export const useSatelliteArea = (name: string) =>
  run("satellite", async () => {
    const pack = satellitePacks.value.find((entry) => entry.name === name) ?? (await listSatellitePacks()).find((entry: SatellitePackInfo) => entry.name === name);
    if (!pack) {
      log(`there is no satellite area called "${name}"`, "fail");
      return;
    }
    await changeOwnImagery({
      url: satelliteAddress(name),
      attribution: pack.attribution ?? `${SENTINEL_CREDIT}`,
      opacity: 1,
      tileSize: 256,
      minZoom: pack.minZoom,
      maxZoom: pack.maxZoom
    });
  });

export const removeSatelliteArea = (name: string) =>
  run("satellite", async () => {
    try {
      nodeFs().unlinkSync(satellitePath(name));
    } catch (error) {
      fail("removing the satellite area", error);
      return;
    }
    if (ownImagery.value && satelliteNameOf(ownImagery.value.url) === name) await changeOwnImagery({ url: "" });
    await refreshSatellitePacks();
    log(`the satellite area "${name}" is off this computer`, "ok");
  });

/** Where the legend of the numbers sits in the frame. */
export const legendCorner = signal<LegendCorner>("bottomLeft");

let joinLookup: ReturnType<typeof buildLookup> | null = null;
const provinceLookups = new Map<string, ReturnType<typeof buildLookup>>();

/** Every way of naming a country, built once and kept. */
function countryLookup() {
  if (!joinLookup) joinLookup = buildLookup(countryJoinTargets());
  return joinLookup;
}

/** Every way of naming a province: of one country, or of the whole world when none is given. */
function provinceLookup(country: string | null) {
  const key = country ?? "*";
  const had = provinceLookups.get(key);
  if (had) return had;
  const built = buildLookup(provinceJoinTargets(country));
  provinceLookups.set(key, built);
  return built;
}

const districtLookups = new Map<string, ReturnType<typeof buildLookup>>();

/** Every way of naming a district of a country whose districts are downloaded (rebuilt after a new download). */
function districtLookup(country: string) {
  const key = `${country}:${districtSetOf(country)?.downloaded ?? ""}`;
  const had = districtLookups.get(key);
  if (had) return had;
  const built = buildLookup(districtJoinTargets(country));
  districtLookups.set(key, built);
  return built;
}

type JoinLevel = "country" | "province" | "district";

/** "Bangladesh provinces: " or "Bangladesh districts: " before what the join found; nothing for countries. */
const levelPrefix = (found: { level: JoinLevel; country: string | null }) => (found.level === "country" ? "" : `${countryName(found.country)} ${found.level === "province" ? "provinces" : "districts"}: `);

/**
 * Where a table's rows belong: countries, the provinces of one country, or its downloaded districts.
 * Province names alone decide which country it is about; once that is known, the short codes of that
 * country's provinces (CA, US-CA) are joined too, which they could not be while every province in the
 * world was in play. Districts are tried for that country, or for every country whose districts are
 * downloaded when the rows name no province; left to itself, the level with the most rows wins.
 */
function joinTable<T = number>(rows: { key: string; value: T }[]): { level: JoinLevel; country: string | null; result: ReturnType<typeof joinValues<T>> } {
  const wanted = dataLevel.value;
  const byCountry = joinValues(rows, countryLookup());
  if (wanted === "country") return { level: "country", country: null, result: byCountry };
  // Which country the provinces belong to: the one most rows point at, or the one the user picked.
  let country = dataCountry.value;
  if (!country) {
    const votes = new Map<string, number>();
    for (const row of joinValues(rows, provinceLookup(null)).matched) {
      const of = countryOfProvince(row.code);
      if (of) votes.set(of, (votes.get(of) ?? 0) + 1);
    }
    country = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }
  const byProvince = country ? joinValues(rows, provinceLookup(country)) : null;
  let byDistrict: { country: string; result: ReturnType<typeof joinValues<T>> } | null = null;
  if (wanted !== "province") {
    for (const code of country ? [country] : installedDistricts().map((set) => set.country)) {
      if (!districtSetOf(code)) continue;
      const result = joinValues(rows, districtLookup(code));
      if (result.matched.length && (!byDistrict || result.matched.length > byDistrict.result.matched.length)) byDistrict = { country: code, result };
    }
  }
  const provinces = byProvince?.matched.length ?? 0;
  if (wanted === "district" && byDistrict) return { level: "district", country: byDistrict.country, result: byDistrict.result };
  if (wanted === "province") return byProvince && provinces && country ? { level: "province", country, result: byProvince } : { level: "country", country: null, result: byCountry };
  // Left to itself: the level with the most rows, and the coarser one when they tie.
  if (byDistrict && byDistrict.result.matched.length > Math.max(byCountry.matched.length, provinces)) return { level: "district", country: byDistrict.country, result: byDistrict.result };
  if (byProvince && country && provinces > byCountry.matched.length) return { level: "province", country, result: byProvince };
  return { level: "country", country: null, result: byCountry };
}

/** The rows the sheet would join: amounts of one column, categories, or a series of years. */
function sheetRows(table: DataTable): { key: string; value: unknown }[] {
  const shape = dataSeriesShape.value;
  if (dataIsCategory(table)) return columnCategories(table, dataKeyColumn.value, dataValueColumn.value);
  if (shape && dataAnimate.value) return readSeries(table, shape, dataKeyColumn.value, dataValueColumn.value).rows.map((row) => ({ key: row.key, value: row.values }));
  return columnValues(table, dataKeyColumn.value, dataValueColumn.value);
}

/** Opens the Data sheet for a table of numbers (a CSV with names and values, not coordinates). */
export function openDataTable(table: DataTable): void {
  dataTable.value = table;
  dataKeyColumn.value = table.keyColumn;
  dataValueColumn.value = table.valueColumn;
  const flows = guessFlowColumns(table);
  flowFrom.value = flows?.from ?? -1;
  flowTo.value = flows?.to ?? -1;
  flowValue.value = flows?.value ?? -1;
  dataMessage.value = null;
  dataSeriesShape.value = detectSeries(table);
  // A long table's value is the number column that is not the year.
  const shape = dataSeriesShape.value;
  if (shape?.kind === "long" && dataValueColumn.value === shape.timeColumn) {
    const other = table.columns.find((column) => column.kind === "number" && column.index !== shape.timeColumn);
    if (other) dataValueColumn.value = other.index;
  }
  dataSheetOpen.value = true;
  importSheetOpen.value = false;
  // What the table would join to, before anything is coloured.
  const rows = sheetRows(table);
  const found = joinTable(rows);
  dataCountry.value = found.country;
  const years = shape ? `. Years ${describeSeries(readSeries(table, shape, dataKeyColumn.value, dataValueColumn.value))}` : "";
  dataMessage.value = `${levelPrefix(found)}${describeJoin(found.result, rows.length)}${years}`;
}

/** The countries a table of provinces may be about, by name; for districts, the countries whose districts are downloaded. */
export const countryChoices = (level: DataLevelChoice = dataLevel.value): { code: string; name: string }[] =>
  (level === "district" ? installedDistricts().map((set) => ({ code: set.country, name: set.countryName })) : countryCodeRows().map((row) => ({ code: row.code, name: row.names[0] ?? row.code }))).sort((a, b) => a.name.localeCompare(b.name));

/** A country's name from its map code, for the messages. */
function countryName(code: string | null): string {
  if (!code) return "";
  const row = countryCodeRows().find((entry) => entry.code === code);
  return row?.names[0] ?? code;
}

/** Colours the map by the chosen column, and keeps the numbers with the map. */
export const applyDataFill = () => run("data on the map", applyDataFillNow);

async function applyDataFillNow(): Promise<void> {
  const table = dataTable.value;
  if (!table) return;
  const category = dataIsCategory(table);
  const shape = category ? null : dataSeriesShape.value;
  const series = shape && dataAnimate.value ? readSeries(table, shape, dataKeyColumn.value, dataValueColumn.value) : null;
  const rows = sheetRows(table);
  const found = joinTable(rows);
  const result = found.result;
  dataCountry.value = found.country;
  dataMessage.value = `${levelPrefix(found)}${describeJoin(result, rows.length)}`;
  if (!result.matched.length) {
    log(`nothing in "${table.headings[dataKeyColumn.value]}" matched a country or a province`, "fail");
    return;
  }
  const byCode = (value: unknown) => Object.fromEntries(result.matched.map((row) => [row.code, value === undefined ? row.value : value]));
  const fill: DataFill = {
    // A wide table's value is every year column: the legend is titled by the table instead.
    column: series && shape?.kind === "wide" ? table.name.replace(/\.[a-z0-9]+$/i, "") : table.headings[dataValueColumn.value] || "Value",
    level: found.level,
    country: found.country,
    values: category || series ? {} : (byCode(undefined) as Record<string, number>),
    categories: category ? (byCode(undefined) as Record<string, string>) : null,
    palette: dataPalette.value,
    series: series ? { times: series.times, values: byCode(undefined) as Record<string, (number | null)[]> } : null,
    ramp: dataRamp.value,
    steps: dataSteps.value,
    method: dataMethod.value,
    opacity: dataOpacity.value,
    outline: 0,
    outlineColor: DEFAULT_DATA_FILL.outlineColor,
    noData: dataNoData.value,
    // A dark map reads a pale country as "much"; the ramp is turned over so it does not.
    reverse: dataReverse.value ?? currentTheme.value.dark
  };
  dataFill.value = normaliseDataFill(fill);
  if (selectedId.value) {
    await callHost("setMapSettings", { mapId: selectedId.value, dataFill: dataFill.value });
    await readMaps();
  }
  const colours = dataFillColors(dataFill.value!);
  // The years move with the comp: the "Data Time" slider on the map layer runs from the first year at
  // the start to the last at the end, and can be retimed like any other keyframes.
  if (dataFill.value?.series && selectedId.value) {
    const times = dataFill.value.series.times;
    const info = await callHost<{ frames: number; frameRate: number }>("renderInfo", { mapId: selectedId.value });
    const end = Math.max(0, (info.frames - 1) / info.frameRate);
    await callHost("setControlKeys", { mapId: selectedId.value, name: "Data Time", times: [0, end], values: [times[0], times[times.length - 1]] });
  }
  const moving = dataFill.value?.series ? `. The years run over the comp on the map layer's "Data Time" slider; Add the year puts the year on screen` : "";
  log(`${describeDataFill(dataFill.value!, colours)}${moving}. Render to get it as its own layer above the basemap${result.unmatched.length ? `; ${result.unmatched.length} rows found no country` : ""}`, "ok");
}

/** The year the map shows, as a text layer that counts with the "Data Time" slider. */
export const addDataYear = () =>
  run("year", async () => {
    if (!selectedId.value || !dataFill.value?.series) {
      log("colour the map by a table with years first", "muted");
      return;
    }
    const template = currentLabelTemplate.value;
    const made = await callHost<{ name: string; expressionErrors: string[] }>("addDataYear", {
      mapId: selectedId.value,
      corner: legendCorner.value === "bottomLeft" ? "bottomRight" : "bottomLeft",
      fonts: templateFonts(template, SCRIPT_FONTS.latin.bold, "latin"),
      color: hexToRgb(template.countryColor),
      haloColor: hexToRgb(template.haloColor),
      halo: template.halo
    });
    log(made.expressionErrors.length ? `the year layer has expression errors: ${made.expressionErrors.join("; ")}` : `"${made.name}" added: it counts the years with the Data Time slider`, made.expressionErrors.length ? "fail" : "ok");
  });

/** Changes how the numbers are coloured, and redraws them at once. */
/** Changes what the rows are taken to be about, and joins again. */
/** Joins the table again after the level, the country or the districts on this computer changed. */
function rejoinTable(): void {
  const table = dataTable.value;
  if (!table) return;
  const rows = sheetRows(table);
  const found = joinTable(rows);
  // A country chosen for its districts stays chosen while they are still to be downloaded.
  const waiting = dataLevel.value === "district" && !!dataCountry.value && found.level !== "district";
  if (!waiting) dataCountry.value = found.country;
  dataMessage.value = `${levelPrefix(found)}${describeJoin(found.result, rows.length)}${waiting ? `. The districts of ${countryName(dataCountry.value)} are not on this computer yet: download them below` : ""}`;
}

export const changeDataLevel = (level: DataLevelChoice, country?: string | null) =>
  run("data on the map", async () => {
    dataLevel.value = level;
    if (country !== undefined) dataCountry.value = country;
    if (level === "auto" || level === "country") dataCountry.value = null;
    // Districts a country does not have on this computer yet are offered for download, right here.
    if (level === "district" && dataCountry.value && !districtSetOf(dataCountry.value)) {
      const row = countryCodeRows().find((entry) => entry.code === dataCountry.value);
      if (row) void offerDistricts({ code: row.code, name: row.names[0] ?? row.code, iso: row.iso3 ?? row.code });
    }
    rejoinTable();
  });

export const changeDataFill = (next: Partial<Pick<DataFill, "ramp" | "steps" | "method" | "opacity" | "noData" | "reverse">>) =>
  run("data colours", async () => {
    if (next.reverse !== undefined) dataReverse.value = next.reverse;
    if (next.ramp) dataRamp.value = next.ramp;
    if (next.steps) dataSteps.value = next.steps;
    if (next.method) dataMethod.value = next.method;
    if (next.opacity !== undefined) dataOpacity.value = next.opacity;
    if (next.noData !== undefined) dataNoData.value = next.noData;
    if (heat.value && selectedId.value) {
      // The heat follows the same ramp and opacity as the colours.
      heat.value = normaliseHeat({ ...heat.value, ramp: dataRamp.value, opacity: dataOpacity.value, reverse: dataReverse.value ?? currentTheme.value.dark });
      await callHost("setMapSettings", { mapId: selectedId.value, heat: heat.value });
    }
    if (dataFill.value) dataFill.value = normaliseDataFill({ ...dataFill.value, ...next });
    if (selectedId.value && (dataFill.value || heat.value)) {
      if (dataFill.value) await callHost("setMapSettings", { mapId: selectedId.value, dataFill: dataFill.value });
      await readMaps();
    }
  });

/** Colours the categories with another palette, at once. */
export const changeDataPalette = (palette: CategoryPaletteId) =>
  run("data colours", async () => {
    dataPalette.value = palette;
    if (!dataFill.value?.categories) return;
    dataFill.value = normaliseDataFill({ ...dataFill.value, palette });
    if (selectedId.value) {
      await callHost("setMapSettings", { mapId: selectedId.value, dataFill: dataFill.value });
      await readMaps();
    }
  });

/** Takes the numbers off the map again. */
export const clearDataFill = () =>
  run("data on the map", async () => {
    dataFill.value = null;
    if (selectedId.value) {
      await callHost("setMapSettings", { mapId: selectedId.value, dataFill: null });
      await readMaps();
    }
    log("the numbers are off the map", "ok");
  });

/** How big the largest bubble is, in 1080-line pixels, and whether the bubbles take the ramp's colours. */
export const bubbleSize = signal(44);
export const bubbleColoured = signal(false);
/** Whether this map has bubbles now, so the legend can show their sizes too. */
export const bubblesOn = signal(false);
/** How tall the tallest spike is, in 1080-line pixels, and whether the spikes take the ramp's colours. */
export const spikeHeight = signal(160);
export const spikeColoured = signal(false);
/** Whether this map has spikes now, so the legend can show their heights too. */
export const spikesOn = signal(false);

/** Where each value sits on the map: a country's label point, or a province's. */
function placesOfFill(fill: DataFill): BubblePlace[] {
  const places: BubblePlace[] = [];
  if (fill.level === "district" && fill.country) {
    for (const [id, value] of Object.entries(fill.values)) {
      const point = districtPoint(fill.country, id);
      if (point) places.push({ id, name: point.name, lat: point.lat, lng: point.lng, value });
    }
    return places;
  }
  if (fill.level === "province") {
    for (const [id, value] of Object.entries(fill.values)) {
      const point = provincePoint(id);
      if (point) places.push({ id, name: point.name, lat: point.lat, lng: point.lng, value });
    }
    return places;
  }
  const byCode = new Map<string, { lat: number; lng: number; name: string }>();
  try {
    for (const record of placeIndex().records) {
      if (record.kind !== "country" || byCode.has(record.country)) continue;
      byCode.set(record.country, { lat: record.lat, lng: record.lng, name: record.names.en ?? record.country });
    }
  } catch {
    // Without the place index there is nowhere to put a bubble.
  }
  for (const [code, value] of Object.entries(fill.values)) {
    const point = byCode.get(code);
    if (point) places.push({ id: code, name: point.name, lat: point.lat, lng: point.lng, value });
  }
  return places;
}

/** Numbers as circles on the map, as one editable layer. */
export const addDataBubbles = () =>
  run("bubbles", async () => {
    const fill = dataFill.value;
    if (!fill || !selectedId.value) {
      log("colour the map by a table first", "muted");
      return;
    }
    const places = placesOfFill(fill);
    if (!places.length) {
      log("none of these places has a point to put a bubble on", "fail");
      return;
    }
    const made = await addBubbles(selectedId.value, fill, places, {
      theme: currentTheme.value,
      style: currentLayerStyle.value,
      byColour: bubbleColoured.value,
      maxRadius: bubbleSize.value
    });
    bubblesOn.value = true;
    const dropped = made.set.dropped ? `, ${made.set.dropped} smaller ones left out` : "";
    log(
      `"${made.name}": ${made.bubbles} circles, the largest standing for ${made.set.legend[0]?.label ?? ""}${dropped}. They follow the map; restyle or animate each one in the layer`,
      made.expressionErrors.length ? "fail" : "ok"
    );
  });

export const removeDataBubbles = () =>
  run("bubbles", async () => {
    if (!selectedId.value) return;
    const gone = await removeBubbles(selectedId.value);
    bubblesOn.value = false;
    log(gone.removed ? "the bubbles are off the map" : "this map has no bubbles", gone.removed ? "ok" : "muted");
  });

/** Numbers as spikes on the map, as one editable layer: the height of a spike stands for its value. */
export const addDataSpikes = () => run("spikes", addDataSpikesNow);

async function addDataSpikesNow(): Promise<void> {
  const fill = dataFill.value;
  if (!fill || !selectedId.value) {
    log("colour the map by a table first", "muted");
    return;
  }
  const places = placesOfFill(fill);
  if (!places.length) {
    log("none of these places has a point to put a spike on", "fail");
    return;
  }
  const made = await addSpikes(selectedId.value, fill, places, {
    theme: currentTheme.value,
    style: currentLayerStyle.value,
    byColour: spikeColoured.value,
    maxHeight: spikeHeight.value
  });
  spikesOn.value = true;
  const dropped = made.set.dropped ? `, ${made.set.dropped} smaller ones left out` : "";
  log(
    `"${made.name}": ${made.spikes} spikes, the tallest standing for ${made.set.legend[0]?.label ?? ""}${dropped}. They follow the map; restyle or animate each one in the layer`,
    made.expressionErrors.length ? "fail" : "ok"
  );
}

export const removeDataSpikes = () =>
  run("spikes", async () => {
    if (!selectedId.value) return;
    const gone = await removeSpikes(selectedId.value);
    spikesOn.value = false;
    log(gone.removed ? "the spikes are off the map" : "this map has no spikes", gone.removed ? "ok" : "muted");
  });

/** How many bars the chart of the numbers shows, and where it sits. */
export const chartBars = signal(8);
export const chartCorner = signal<LegendCorner>("bottomRight");

/** The numbers as a chart in the scene: a bar per place, longest first, each growing in turn. */
/** Bars of one year, or lines or areas over the years (for a table with years). */
export const chartKind = signal<"bars" | "lines" | "area">("bars");

export const addDataChart = () =>
  run("chart", async () => {
    const fill = dataFill.value;
    const entry = (await readMaps()).find((map) => map.mapId === selectedId.value);
    if (!fill || !entry) {
      log("colour the map by a table first", "muted");
      return;
    }
    if (chartKind.value !== "bars" && fill.series) {
      const codes = Object.keys(fill.series.values);
      const made = await addLineChart(entry.mapId, fill, codes.map((code) => ({ code, name: nameOfPlace(fill, code) })), {
        theme: currentTheme.value,
        style: currentLayerStyle.value,
        template: currentLabelTemplate.value,
        corner: chartCorner.value,
        limit: Math.min(8, chartBars.value),
        area: chartKind.value === "area"
      });
      const dropped = made.dropped ? `, ${made.dropped} smaller ones left out` : "";
      log(
        made.expressionErrors.length ? `the chart has expression errors: ${made.expressionErrors.join("; ")}` : `"${made.name}" added to the scene (${made.lines} ${chartKind.value === "area" ? "areas" : "lines"}${dropped}). It follows the map's Data Time slider, however you key it`,
        made.expressionErrors.length ? "fail" : "ok"
      );
      return;
    }
    const places = Object.entries(fill.values).map(([code, value]) => ({ code, name: nameOfPlace(fill, code), value }));
    const made = await addChart(entry.mapId, fill, places, {
      theme: currentTheme.value,
      style: currentLayerStyle.value,
      template: currentLabelTemplate.value,
      corner: chartCorner.value,
      limit: chartBars.value,
      startFrame: currentMapFrame(entry)
    });
    const dropped = made.dropped ? `, ${made.dropped} smaller ones left out` : "";
    log(`"${made.name}" added to the scene (${made.bars} bars${dropped}). The bars grow one after another from the current time; it is an ordinary precomp: move it, restyle it, animate it`, "ok");
  });

export const removeDataChart = () =>
  run("chart", async () => {
    if (!selectedId.value) return;
    const gone = await removeChart(selectedId.value);
    log(gone.removed ? "the chart is off the scene" : "this map has no chart", gone.removed ? "ok" : "muted");
  });

/** How strongly the shapes of a data map are filled and stroked (the largest value's values). */
export const shapeFillMost = signal(DEFAULT_DATA_SHAPES.fillMost);
export const shapeStrokeMost = signal(DEFAULT_DATA_SHAPES.strokeMost);
export const shapesByValue = signal(true);

/** What a place with a number is called: the name its own data carries. */
function nameOfPlace(fill: DataFill, code: string): string {
  if (fill.level === "country") return countryCodeRows().find((row) => row.code === code)?.names[0] ?? code;
  if (fill.level === "district" && fill.country) return districtPoint(fill.country, code)?.name ?? code;
  return provincePoint(code)?.name ?? code;
}

/** The outline of a place a data fill names: a country, a province of one, or a district. */
function outlineOfPlace(fill: DataFill, code: string): number[][][][] | null {
  if (fill.level === "country") return countryOutline(code)?.polygons ?? null;
  if (!fill.country) return null;
  const units = fill.level === "province" ? provincesOf(fill.country) : districtsOf(fill.country);
  return units.find((unit) => unit.id === code)?.polygons ?? null;
}

/** Every place with a number as its own editable shape layer, filled and stroked by that number. */
export const addDataShapes = () =>
  run("shapes from the numbers", async () => {
    const fill = dataFill.value;
    const entry = (await readMaps()).find((map) => map.mapId === selectedId.value);
    if (!fill || !entry) {
      log("colour the map by a table first", "muted");
      return;
    }
    const set = dataShapes(fill, { fillMost: shapeFillMost.value, strokeMost: shapeStrokeMost.value, colorByValue: shapesByValue.value, color: currentLayerStyle.value.accent, limit: MAX_DATA_SHAPES });
    const start = currentMapFrame(entry);
    const draw = shapeDrawOn.value ? Math.round(4 * entry.frameRate) : 0;
    let made = 0;
    let missing = 0;
    const errors: string[] = [];
    for (const [index, shape] of set.shapes.entries()) {
      const polygons = outlineOfPlace(fill, shape.code);
      if (!polygons) {
        missing++;
        continue;
      }
      progress.value = { label: `Drawing ${set.shapes.length} shapes`, done: index, total: set.shapes.length };
      const name = `${nameOfPlace(fill, shape.code)} (${formatValue(shape.value)})`;
      const built = await addFeatureShape(entry.mapId, { name, polygons, code: shape.code }, { color: shape.color, fill: shape.fill, outline: shape.outline, startFrame: start, drawFrames: draw, terrain: terrain.value });
      errors.push(...built.expressionErrors);
      made++;
    }
    const dropped = set.dropped ? `, ${set.dropped} smaller ones left out` : "";
    const gone = missing ? `, ${missing} without an outline in this build` : "";
    log(
      `${made} shape layers from ${fill.column}${dropped}${gone}. Each is an ordinary shape layer: restyle or animate it, and it follows the map`,
      errors.length ? "fail" : "ok"
    );
  });

/** Heat on the map: the table's places warm it by their numbers, or the last import's places do, alike. */
export const addDataHeat = () =>
  run("heat", async () => {
    if (!selectedId.value) {
      log("create or select a map first", "muted");
      return;
    }
    const fill = dataFill.value;
    const fromTable = fill ? placesOfFill(fill) : [];
    const fromImport = imported.value?.places ?? [];
    const source = fromTable.length ? "table" : fromImport.length ? "import" : null;
    if (!source) {
      log("colour the map by a table, or import a file with places, first", "muted");
      return;
    }
    const column = source === "table" ? fill!.column : imported.value!.fileName;
    const next = normaliseHeat({ ...DEFAULT_HEAT, column, points: heatPoints(source === "table" ? fromTable : fromImport), radius: heatRadius.value, ramp: dataRamp.value, opacity: dataOpacity.value, reverse: dataReverse.value ?? currentTheme.value.dark });
    if (!next) {
      log("none of these places can warm the map", "fail");
      return;
    }
    heat.value = next;
    await callHost("setMapSettings", { mapId: selectedId.value, heat: next });
    await readMaps();
    log(`${describeHeat(next)}. Render to get it as its own layer above the basemap`, "ok");
  });

/** Changes how far each place's warmth reaches, on the map as well when it has heat. */
export const changeHeatRadius = (radius: number) =>
  run("heat", async () => {
    heatRadius.value = Math.max(4, Math.min(300, radius || DEFAULT_HEAT.radius));
    if (!heat.value || !selectedId.value) return;
    heat.value = normaliseHeat({ ...heat.value, radius: heatRadius.value });
    await callHost("setMapSettings", { mapId: selectedId.value, heat: heat.value });
    await readMaps();
  });

export const removeDataHeat = () =>
  run("heat", async () => {
    if (!selectedId.value) return;
    const had = !!heat.value;
    heat.value = null;
    await callHost("setMapSettings", { mapId: selectedId.value, heat: null });
    await readMaps();
    log(had ? "the heat is off the map" : "this map has no heat", had ? "ok" : "muted");
  });

/** Whether the copies of a layer are sized by their numbers. */
export const copiesByValue = signal(true);

/** The layer selected in After Effects, copied onto every place of the table (or of the last import). */
export const addDataCopies = () =>
  run("copies on places", async () => {
    const mapId = selectedId.value;
    if (!mapId) {
      log("create or select a map first", "muted");
      return;
    }
    const fill = dataFill.value;
    const fromTable = fill ? placesOfFill(fill) : [];
    const fromImport = (imported.value?.places ?? []).map((place, i) => ({ id: String(i), name: place.name, lat: place.lat, lng: place.lng, value: 1 }));
    const places = fromTable.length ? fromTable : fromImport;
    if (!places.length) {
      log("colour the map by a table, or import a file with places, first", "muted");
      return;
    }
    const byValue = copiesByValue.value && fromTable.length > 0;
    const made = await copyToPlaces(mapId, places, { byValue, terrain: terrain.value, scaleWithMap: attachScale.value, rotateWithMap: attachRotate.value });
    await refreshSelection();
    if (made.expressionErrors.length) {
      log(`copy problems: ${made.expressionErrors.slice(0, 3).join("; ")}`, "fail");
      return;
    }
    const smallest = made.set.copies.reduce((least, copy) => Math.min(least, copy.factor), 1);
    const sized = byValue ? `, sized by ${fill!.column} (the largest at the layer's own size, the smallest at ${Math.round(smallest * 100)} %)` : "";
    const dropped = made.set.dropped ? `; ${made.set.dropped} smaller places left out` : "";
    log(
      `"${made.template}" copied onto ${made.layers.length} places${sized}${dropped}. The original is left as it is; every copy has the controls an attached layer has, and Unlink puts a selected copy back to plain`,
      "ok"
    );
  });

/** What the renders take on disk, and how much of it belongs to unsaved projects that are gone. */
export const renderDisk = signal<RenderDiskReport | null>(null);
export const renderDiskBusy = signal(false);

/** Walks the render folders and reports what is there (a moment on a big cache). */
export async function checkRenderDisk(): Promise<void> {
  if (renderDiskBusy.value) return;
  renderDiskBusy.value = true;
  try {
    const list = await readMaps();
    let projectFolder: string | null = null;
    if (selectedId.value) {
      try {
        projectFolder = (await callHost<{ projectFolder: string | null }>("renderInfo", { mapId: selectedId.value })).projectFolder;
      } catch {
        projectFolder = null;
      }
    }
    let inUse: string[] = [];
    try {
      inUse = await callHost<string[]>("footageInUse");
    } catch {
      inUse = [];
    }
    renderDisk.value = renderDiskReport(list.map((entry) => entry.mapId), projectFolder, inUse);
  } catch (error) {
    fail("checking the renders on disk", error);
  } finally {
    renderDiskBusy.value = false;
  }
}

/** Removes the renders of unsaved projects that are no longer open. */
export const removeOldRenders = () =>
  run("old renders", async () => {
    const report = renderDisk.value;
    if (!report) return;
    const gone = removeOldLooseRenders(report);
    log(
      gone.removed ? `${gone.removed} ${gone.removed === 1 ? "folder" : "folders"} of old renders removed, ${formatBytes(gone.bytes)} freed${gone.failed.length ? `; ${gone.failed.length} could not be removed (open in After Effects?)` : ""}` : "nothing to remove",
      gone.failed.length ? "fail" : "ok"
    );
    await checkRenderDisk();
  });

/** Changes a colour of the map's own look, and redraws at once. */
export const changeLook = (next: Partial<LookOverride>) =>
  run("look", async () => {
    lookOverride.value = normaliseLook({ ...lookOverride.value, ...next });
    if (selectedId.value) {
      await callHost("setMapSettings", { mapId: selectedId.value, look: lookOverride.value });
      await readMaps();
    }
  });

/** Turns a detail of the look - line or road width, how many names - and redraws at once. */
export const changeLookDetails = (next: Partial<LookDetails>) =>
  run("look details", async () => {
    lookDetails.value = normaliseDetails({ ...lookDetails.value, ...next });
    if (selectedId.value) {
      await callHost("setMapSettings", { mapId: selectedId.value, lookDetails: lookDetails.value });
      await readMaps();
    }
  });

/** Sets, changes or clears the user's own tiles; an empty address switches them off. */
export const changeOwnImagery = (next: Partial<OwnImagery>) =>
  run("own imagery", async () => {
    const current = ownImagery.value;
    const url = (next.url ?? current?.url ?? "").trim();
    if (url && !isTileAddress(url)) {
      log("that is not a tile address: it needs https://…/{z}/{x}/{y}… or a .pmtiles file on the web", "fail");
      return;
    }
    ownImagery.value = url ? normaliseOwnImagery({ ...(current ?? {}), ...next, url }) : null;
    ownImageryDraft.value = ownImagery.value?.url ?? "";
    if (selectedId.value) {
      await callHost("setMapSettings", { mapId: selectedId.value, ownImagery: ownImagery.value });
      await readMaps();
    }
    log(ownImagery.value ? `the map draws ${describeOwnImagery(ownImagery.value)}; its terms are yours to keep, and the credit goes on the credit line` : "the map draws its own data again", "ok");
  });

/** One of the open services the panel knows: its address, credit and zooms, in one go. */
export const useImageryService = (id: string) =>
  run("own imagery", async () => {
    const service = imageryService(id);
    if (!service) return;
    ownImagery.value = normaliseOwnImagery(ownImageryFromService(service));
    ownImageryDraft.value = ownImagery.value?.url ?? "";
    if (selectedId.value) {
      await callHost("setMapSettings", { mapId: selectedId.value, ownImagery: ownImagery.value });
      await readMaps();
    }
    log(`the map draws ${service.name} (${service.country}): ${service.licence}; credit "${service.attribution}" goes on the credit line. Terms: ${service.terms}`, "ok");
  });

/**
 * Every other map in the project takes this map's look (the look, its colours, details, layer style,
 * relief, sky and imagery) or its names (the label template and the keep-out zones); names already
 * placed on those maps are restyled too.
 */
export const shareWithAllMaps = (what: "look" | "names") =>
  run("share with every map", async () => {
    const from = selectedId.value;
    if (!from) return;
    const others = maps.value.filter((map) => map.mapId !== from);
    if (!others.length) {
      log("this project has no other map", "muted");
      return;
    }
    const settings = what === "look"
      ? { theme: themeId.value, look: lookOverride.value, lookDetails: lookDetails.value, layerStyle: layerStyle.value, relief: reliefOn.value, sky: skyOn.value, ownImagery: ownImagery.value }
      : { labelTemplate: labelTemplate.value, keepOut: keepOut.value };
    let restyled = 0;
    for (const map of others) {
      await callHost("setMapSettings", { mapId: map.mapId, ...settings });
      if (what === "names") {
        // The other map's own look decides what a null field of the template falls back to.
        const template = resolveLabelTemplate(applyLook(themeById(map.theme), normaliseLook(map.look)), labelTemplate.value);
        for (const kind of ["label", "value"]) restyled += (await restyleLabels(map.mapId, { template, kind })).labels;
        // Sizes differ, so that map's names are placed again over its own move.
        await repositionLabels(map.mapId, { template, terrain: normaliseTerrain(map.terrain), zones: normaliseKeepOut(map.keepOut) });
      }
    }
    await readMaps();
    log(`${others.length} other ${others.length === 1 ? "map takes" : "maps take"} this map's ${what === "look" ? "look" : "names"} now${restyled ? ` (${restyled} placed names restyled)` : ""}`, "ok");
  });

/** Takes the colours of a picture and makes a look of them. */
export const lookFromImage = (file: File) =>
  run("look from a picture", async () => {
    const bitmap = await createImageBitmap(file);
    // A small copy is enough to find the colours, and costs nothing to read.
    const width = Math.max(1, Math.min(160, bitmap.width));
    const height = Math.max(1, Math.round((bitmap.height / bitmap.width) * width));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      log("this build cannot read pictures", "fail");
      return;
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const found = lookFromPicture(context.getImageData(0, 0, width, height).data, { colours: 6 });
    if (lookFollows(found)) {
      log(`${file.name} has no colours to make a look from`, "fail");
      return;
    }
    lookOverride.value = found;
    if (selectedId.value) {
      await callHost("setMapSettings", { mapId: selectedId.value, look: lookOverride.value });
      await readMaps();
    }
    log(`the look now follows ${file.name}: sea ${found.ocean}, land ${found.land}, lines ${found.accent}`, "ok");
  });

/** Writes the map's look to a file, to keep or to share. */
export const saveLook = () =>
  run("save the look", async () => {
    const name = `${themeById(themeId.value).label}${lookFollowsTheme.value ? "" : " (yours)"}`;
    const text = writeLookFile(name, themeId.value, lookOverride.value);
    const written = await callHost<string | null>("saveTextFile", { text, suggestedName: lookFileName(name) });
    if (written) log(`the look is saved as ${written}`, "ok");
  });

/** Opens a look someone saved, or a palette from Illustrator or Photoshop (.ase, .act). */
export const openLookFile = (file: File) =>
  run("open a look", async () => {
    const kind = (file.name.split(".").pop() ?? "").toLowerCase();
    if (kind === "ase" || kind === "act") {
      const swatches = readSwatchFile(file.name, new Uint8Array(await file.arrayBuffer()));
      if (!swatches.length) {
        log(`${file.name} holds no colours this build can read`, "fail");
        return;
      }
      const found = lookFromPalette(swatches.map((swatch) => swatch.hex));
      lookOverride.value = found;
      if (selectedId.value) {
        await callHost("setMapSettings", { mapId: selectedId.value, look: found });
        await readMaps();
      }
      log(`${swatches.length} colours from ${file.name}: sea ${found.ocean}, land ${found.land}, lines ${found.accent}`, "ok");
      return;
    }
    const read = readLookFile(await file.text());
    if (!read) {
      log(`${file.name} is not a look file or a palette`, "fail");
      return;
    }
    themeId.value = themeById(read.base).id;
    lookOverride.value = read.colours;
    if (selectedId.value) {
      await callHost("setMapSettings", { mapId: selectedId.value, theme: themeId.value, look: read.colours });
      await readMaps();
    }
    log(`the look "${read.name}" is on this map`, "ok");
  });

/** Whether the numbers are written next to the places, and whether their names come too. */
export const valuesWithNames = signal(false);

/** Writes every value onto the map as a text layer, under its bubble when there is one. */
export const addDataValues = () =>
  run("values on the map", async () => {
    const fill = dataFill.value;
    if (!fill || !selectedId.value) {
      log("colour the map by a table first", "muted");
      return;
    }
    const places = placesOfFill(fill);
    if (!places.length) {
      log("none of these places has a point to write a number on", "fail");
      return;
    }
    const made = await addValueLabels(selectedId.value, fill, places, {
      theme: currentTheme.value,
      template: currentLabelTemplate.value,
      withNames: valuesWithNames.value,
      belowBubbles: bubblesOn.value,
      maxRadius: bubbleSize.value
    });
    const dropped = made.dropped ? `, ${made.dropped} smaller ones left out` : "";
    log(`${made.labels} numbers written on the map${dropped}. They are ordinary text layers: restyle or animate them as you like`, made.expressionErrors.length ? "fail" : "ok");
  });

export const removeDataValues = () =>
  run("values on the map", async () => {
    if (!selectedId.value) return;
    const gone = await removeValueLabels(selectedId.value);
    log(gone.removed ? "the numbers are off the map" : "this map has no numbers written on it", gone.removed ? "ok" : "muted");
  });

/** Builds the legend of the numbers as a precomp in the scene, where the designer can move it. */
export const addDataLegend = () => run("legend", addDataLegendNow);

async function addDataLegendNow(): Promise<void> {
  const fill = dataFill.value;
  if ((!fill && !heat.value) || !selectedId.value) {
    log("colour the map by a table, or add heat, first", "muted");
    return;
  }
  const compHeight = (await readMaps()).find((m) => m.mapId === selectedId.value)?.height ?? 1080;
  const withBubbles = fill && bubblesOn.value ? bubbleSet(placesOfFill(fill), { maxRadius: bubbleSize.value, height: compHeight }).legend : [];
  const withSpikes = fill && spikesOn.value ? spikeSet(placesOfFill(fill), { maxHeight: spikeHeight.value, height: compHeight }) : null;
  const made = await addLegend(selectedId.value, fill, {
    theme: currentTheme.value,
    style: currentLayerStyle.value,
    template: currentLabelTemplate.value,
    corner: legendCorner.value,
    heat: heat.value,
    sizes: [
      ...withBubbles.map((step) => ({ radius: step.radius, label: step.label })),
      ...(withSpikes ? withSpikes.legend.map((step) => ({ spike: { width: withSpikes.width, height: step.height }, label: step.label })) : [])
    ]
  });
  log(`"${made.name}" added to the scene (${made.rows} steps). It is an ordinary precomp: move it, restyle it, animate it`, "ok");
}

export const removeDataLegend = () =>
  run("legend", async () => {
    if (!selectedId.value) return;
    const gone = await removeLegend(selectedId.value);
    log(gone.removed ? "the legend is off the scene" : "this map has no legend", gone.removed ? "ok" : "muted");
  });

/** The search for OpenStreetMap features: what the user typed and what to look for. */
export const osmSheetOpen = signal(false);
export const osmText = signal("");
export const osmKindId = signal<OsmKind>("any");
export const osmMessage = signal<string | null>(null);

/**
 * Asks OpenStreetMap about the area the preview shows and hands the features to the import sheet,
 * where they are drawn, highlighted or turned into shape layers like anything else imported.
 */
export const findOsm = () =>
  run("OpenStreetMap", async () => {
    const map = previewMap();
    if (!map) return;
    const bounds = map.getBounds();
    const bbox: OsmBbox = [Math.max(-85, bounds.getSouth()), Math.max(-180, bounds.getWest()), Math.min(85, bounds.getNorth()), Math.min(180, bounds.getEast())];
    const refusal = checkBbox(bbox);
    if (refusal) {
      osmMessage.value = refusal;
      return;
    }
    const kind = osmKindId.value;
    const text = osmText.value.trim();
    if (!text && kind === "any") {
      osmMessage.value = "Type a name, or pick what to look for.";
      return;
    }
    osmMessage.value = "Asking OpenStreetMap...";
    progress.value = { label: "OpenStreetMap", done: 0, total: 1 };
    try {
      const found = await searchOsm({ text, kind, bbox });
      const name = text || osmKind(kind).name;
      const data = importGeoJson(osmGeoJson(found.features), `OpenStreetMap: ${name}`);
      if (!found.features.length) {
        osmMessage.value = "Nothing of that kind is named here. Try another word, or move the preview.";
        return;
      }
      imported.value = { fileName: `OpenStreetMap: ${name}`, ...data };
      setPreviewImport({ lines: data.lines, places: data.places });
      osmMessage.value = null;
      osmSheetOpen.value = false;
      importSheetOpen.value = true;
      if (!osmData.value && selectedId.value) {
        osmData.value = true;
        await callHost("setMapSettings", { mapId: selectedId.value, osmData: true });
        await readMaps();
      }
      log(
        `${found.features.length} from OpenStreetMap: ${data.areas.length} ${data.areas.length === 1 ? "area" : "areas"}, ${data.lines.length} ${data.lines.length === 1 ? "line" : "lines"}, ${data.places.length} ${data.places.length === 1 ? "place" : "places"}${found.cached ? " (already downloaded)" : ` (${mb(found.bytes)})`} · © OpenStreetMap contributors`,
        "ok"
      );
    } catch (error) {
      osmMessage.value = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      progress.value = null;
    }
  });

/** The ground the preview is showing, which is what a download or a build covers. */
export function previewArea(): Bbox | null {
  const map = previewMap();
  if (!map) return null;
  const b = map.getBounds();
  return { west: Math.max(-180, b.getWest()), south: Math.max(-85, b.getSouth()), east: Math.min(180, b.getEast()), north: Math.min(85, b.getNorth()) };
}

export function openRegionSheet(): void {
  const map = previewMap();
  if (!map) return;
  const b = map.getBounds();
  const bbox = { west: Math.max(-180, b.getWest()), south: Math.max(-85, b.getSouth()), east: Math.min(180, b.getEast()), north: Math.min(85, b.getNorth()) };
  // Start with the most detail that stays around a city-sized download (a few thousand tiles).
  const maxZoom = [...DETAIL_ZOOMS].reverse().find((z) => tilesUpTo(bbox, z) <= 3000) ?? DETAIL_ZOOMS[0];
  regionSheet.value = { kind: "region", name: safeRegionName(suggestName() ?? ""), maxZoom, bbox };
}

/** The same sheet for an elevation pack of the area in the preview. */
export function openTerrainSheet(): void {
  const map = previewMap();
  if (!map) return;
  const b = map.getBounds();
  const bbox = { west: Math.max(-180, b.getWest()), south: Math.max(-85, b.getSouth()), east: Math.min(180, b.getEast()), north: Math.min(85, b.getNorth()) };
  // Elevation tiles are heavy (about 150 KB each): start where the download stays around 50 MB.
  const maxZoom = [...TERRAIN_DETAIL_ZOOMS].reverse().find((z) => tilesUpTo(bbox, z) <= 350) ?? TERRAIN_DETAIL_ZOOMS[0];
  regionSheet.value = { kind: "terrain", name: safeRegionName(suggestName() ?? ""), maxZoom, bbox };
}

export const checkRegionSize = () =>
  run("check size", async () => {
    const sheet = regionSheet.value;
    if (!sheet) return;
    progress.value = { label: "Checking size", done: 0, total: 1 };
    const planned = sheet.kind === "terrain" ? { ...(await planTerrain(sheet.bbox, sheet.maxZoom)), build: "Mapterhorn" } : await planRegion(sheet.bbox, sheet.maxZoom);
    regionSheet.value = { ...sheet, planned };
  });

export const startRegionDownload = () =>
  run("download", async () => {
    const sheet = regionSheet.value;
    if (!sheet?.planned) return;
    const name = safeRegionName(sheet.name || `region-${Date.now()}`);
    if (sheet.kind === "terrain") {
      progress.value = { label: "Downloading elevation", done: 0, total: sheet.planned.plan.tileBytes };
      await downloadTerrain(name, sheet.planned, (done, total) => (progress.value = { label: "Downloading elevation", done, total }));
      log(`downloaded elevation pack "${name}" (${mb(sheet.planned.plan.tileBytes)}) · © Mapterhorn (open elevation data)`, "ok");
      regionSheet.value = null;
      await refreshTerrainPacks();
      terrain.value = normaliseTerrain({ pack: name, shade: terrain.value?.shade ?? DEFAULT_SHADE });
      setPreviewStyle(basemap.value, projection.value, look());
      if (selectedId.value) await callHost("setMapSettings", { mapId: selectedId.value, terrain: terrain.value });
      return;
    }
    progress.value = { label: "Downloading", done: 0, total: sheet.planned.plan.tileBytes };
    await downloadRegion(name, sheet.planned, (done, total) => (progress.value = { label: "Downloading", done, total }));
    log(`downloaded region "${name}" (${mb(sheet.planned.plan.tileBytes)}) · © OpenStreetMap contributors`, "ok");
    regionSheet.value = null;
    await refreshRegions();
    const source: BasemapSource = { kind: "region", name };
    basemap.value = source;
    setPreviewStyle(source, projection.value);
    if (selectedId.value) await callHost("setMapSettings", { mapId: selectedId.value, basemap: source });
  });

/** Goes to a search result: a country is framed whole, a place at a zoom that suits its size. */
export function goToResult(result: SearchResult): void {
  const size = compSize();
  const current = compView();
  const bearing = current?.bearing ?? 0;
  let target: View;
  // An address from the online search can be a single building: it may come much closer.
  if (result.bbox) target = fitBounds(result.bbox, size, { bearing, pitch: 0, padding: 0.08, maxZoom: result.kind === "address" ? 17 : 12 });
  else {
    const zoom = result.kind === "coordinates" ? Math.max(current?.zoom ?? 0, 11 + Math.log2(size.height / 1080)) : (result.zoom ?? zoomForPlace(result.population)) + Math.log2(size.height / 1080);
    target = { center: { lat: result.lat, lng: result.lng }, zoom, bearing, pitch: current?.pitch ?? 0 };
  }
  lastPlaceName.value = result.kind === "coordinates" ? null : result.name;
  showCompView(target, true);
}

/** The version of the panel that is running, as the host reports it. */
export const panelVersion = signal("");
/** A newer release than the one running, when one is known and not waved away. */
export const updateAvailable = signal<Update | null>(null);
/** Whether the panel looks for a newer release once a day. */
/**
 * The scripting API: off unless the user turns it on. main.tsx hands in the starter, so the store
 * does not have to know what the calls are.
 */
export const scriptingOn = signal(readPrefs().scripting);
let startApi: (() => () => void) | null = null;
let stopApi: (() => void) | null = null;

export function registerScriptingApi(start: () => () => void): void {
  startApi = start;
  if (scriptingOn.value && !stopApi) stopApi = start();
}

export const setScriptingOn = (on: boolean): void => {
  scriptingOn.value = on;
  writePrefs({ scripting: on });
  if (!on) {
    stopApi?.();
    stopApi = null;
    log("scripts can no longer drive the panel", "muted");
    return;
  }
  if (startApi && !stopApi) stopApi = startApi();
  log("scripts can drive the panel: leave a request in the api folder inside your LazyMapLayers folder (docs/SCRIPTING.md)", "ok");
};

export const updatesOn = signal(readPrefs().updates);

export const setUpdatesOn = (on: boolean): void => {
  updatesOn.value = on;
  writePrefs({ updates: on });
  if (!on) updateAvailable.value = null;
  else if (panelVersion.value) void checkForUpdate();
};

/** Asks the release list (once a day) and shows a newer version, quietly when there is none. */
export async function checkForUpdate(): Promise<void> {
  try {
    const found = await newerVersion(panelVersion.value);
    updateAvailable.value = found;
    if (found) log(`LazyMapLayers ${found.version} is out (this is ${panelVersion.value}): open Maps for the download`, "ok");
  } catch {
    updateAvailable.value = null;
  }
}

/** "Later": this version is not mentioned again. */
export const dismissUpdate = (): void => {
  if (updateAvailable.value) writePrefs({ dismissedVersion: updateAvailable.value.version });
  updateAvailable.value = null;
};

export const openUpdate = (): void => openUrl(updateAvailable.value?.url ?? RELEASES_URL);

/** Writes a problem report next to the panel's data and opens a new issue with the versions filled in. */
export const reportProblem = () =>
  run("problem report", async () => {
    const report = writeProblemReport(logLines.value.map((line) => line.text), hostInfo.value);
    openUrl(issueUrl(hostInfo.value));
    log(`the problem report is at ${report.file}: paste it into the issue that opened in your browser`, "ok");
  });

export function startStore(): () => void {
  if (!isInCep()) return () => undefined;
  callHost<{ appVersion: string; lml: string }>("ping")
    .then((info) => {
      hostInfo.value = `After Effects ${info.appVersion} · LazyMapLayers ${info.lml}`;
      panelVersion.value = info.lml;
      log(hostInfo.value, "muted");
      if (updatesOn.value) void checkForUpdate();
    })
    .catch((error) => fail("host not ready", error));
  void refreshMaps(true);
  void refreshRegions();
  void refreshTerrainPacks();
  void refreshSatellitePacks();
  renderQueue.load();
  jobs.value = [...renderQueue.jobs];
  const stopQueue = renderQueue.subscribe((event) => {
    jobs.value = [...renderQueue.jobs];
    if (!event) return;
    const { job, result } = event;
    if (job.status === "done" && result) {
      log(`${job.mapName}: ${describeSpec(job.spec)} · ${job.summary}`, "ok");
      if (result.imported.attribution.state === "added") log("added a data credit layer (© OpenStreetMap contributors) to the scene; keep it, or credit OpenStreetMap in your video", "muted");
      void refreshMaps();
    } else if (job.status === "failed") log(`${job.mapName}: render failed: ${job.error}`, "fail");
    else if (job.status === "cancelled") log(`${job.mapName}: render cancelled (rendered frames are kept; Resume continues)`, "muted");
  });
  const onFocus = () => {
    void refreshMaps();
    if (tool.value === "attach") void refreshSelection();
  };
  window.addEventListener("focus", onFocus);
  // The file listed in the Import sheet is drawn over the preview while the sheet is open.
  const stopImportOverlay = effect(() => setPreviewImport(importSheetOpen.value ? imported.value : null));
  return () => {
    stopQueue();
    stopImportOverlay();
    window.removeEventListener("focus", onFocus);
  };
}
