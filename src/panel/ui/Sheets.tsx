// Small sheets that open under the tool row: the region download, the callout and route tools, and
// auto labels.

import type { JSX } from "preact";
import {
  DETAIL_ZOOMS,
  LABEL_LANGUAGES,
  LARGE_DOWNLOAD_BYTES,
  MAX_DOWNLOAD_BYTES,
  busy,
  checkRegionSize,
  compactNumber,
  confirmToolSheet,
  LABEL_DENSITIES,
  labelDensity,
  labelLanguage,
  mb,
  removeLabels,
  regionSheet,
  regions,
  runAutoLabels,
  startRegionDownload,
  tilesUpTo,
  tool,
  toolFirstPoint,
  toolSheet
} from "../store.ts";
import { safeRegionName } from "../regions.ts";
import { signal } from "@preact/signals";
import { THEMES, type Theme } from "../../core/style/themes.ts";
import { hasImagery, IMAGERY_INFO } from "../imagery/packs.ts";
import { addHighlightShape, attachRotate, attachScale, changeHighlightLayers, detachSelected, districtPrompt, downloadDistricts, highlightLayers, highlightLevel, listDistrictSets, refreshSelection, removeDistrictSet, selection, shapeDrawOn } from "../store.ts";
import { hasZone, KEEP_OUT_PRESETS } from "../../core/labels/keepOut.ts";
import { OSM_KINDS, type OsmKind } from "../../core/data/overpass.ts";
import { dataFillColors } from "../../core/style/dataFill.ts";
import { RAMPS, type RampId, type ScaleMethod } from "../../core/style/valueScale.ts";
import type { LegendCorner } from "../../core/style/legend.ts";
import { drawFlows, flowArrows, flowFrom, flowSeconds, flowTo, flowValue, flowWidth } from "../store.ts";
import { addDataBubbles, addDataLegend, addDataValues, applyDataFill, bubbleColoured, bubbleSize, removeDataBubbles, removeDataValues, valuesWithNames, changeDataFill, changeDataLevel, clearDataFill, countryChoices, dataCountry, dataFill, dataKeyColumn, dataLevel, dataMessage, dataMethod, dataOpacity, dataRamp, dataSheetOpen, dataSteps, dataTable, dataValueColumn, legendCorner, removeDataLegend } from "../store.ts";
import { addCircleArea, combineKm, findOsm, growHighlights, mergeHighlights, osmKindId, osmMessage, osmSheetOpen, osmText } from "../store.ts";
import { changeLabelTemplate, currentLabelTemplate, keepOut, keepOutFromLayers, labelTemplateFollows, pickUpLabelStyle, removeKeepOut, toggleKeepOutPreset } from "../store.ts";
import { changeLook, currentTheme, lookFollowsTheme, lookFromImage, lookOverride, openLookFile, saveLook } from "../store.ts";
import { changeLayerStyle, changeSky, changeTerrain, currentLayerStyle, downloadImageryPack, groundAtCentre, imageryVersion, layerStyleFollowsLook, openTerrainSheet, pickUpLayerStyle, skyOn, terrain, terrainPacks, TERRAIN_DETAIL_ZOOMS } from "../store.ts";
import { DEFAULT_SHADE, MAX_HEIGHT } from "../../core/style/terrain.ts";
import { areaCode, changeRelief, changeTheme, drawImportedLine, fitLine, highlights, importSheetOpen, imported, pinImportedPlaces, reliefOn, selected, setHighlights, themeId, toggleAreaHighlight } from "../store.ts";
import { routeArrow, routeComet, routeDashed } from "../store.ts";
import { addRouteShot } from "../shots/shotsStore.ts";
import { useState } from "preact/hooks";

export const labelsSheetOpen = signal(false);
export const lookSheetOpen = signal(false);

/** A tiny map in a theme's colours. */
function ThemeSwatch(props: { theme: Theme }): JSX.Element {
  const t = props.theme;
  const fills = t.countryFills;
  return (
    <svg width="64" height="36" viewBox="0 0 64 36" class="swatch" aria-hidden="true">
      <rect width="64" height="36" fill={t.ocean} />
      <path d="M0 24C10 12 18 22 28 14S50 4 64 10V36H0z" fill={fills ? fills[0] : t.land} stroke={t.coast} stroke-width="1" />
      {fills && <path d="M28 14C36 9 46 6 64 10V36H34z" fill={fills[4]} />}
      {fills && <path d="M0 24C6 17 12 19 18 19L26 36H0z" fill={fills[2]} />}
      <path d="M18 19 26 36M28 14l6 22" stroke={t.border} stroke-width="1" fill="none" />
      <path d="M4 32 22 25l14 3 24-14" stroke={t.highway} stroke-width="1.6" fill="none" stroke-linecap="round" />
      <circle cx="36" cy="28" r="1.8" fill={t.text} />
    </svg>
  );
}

/** The map's look: six themes that colour the world map, regions, the globe's haze and new labels. */
export function LookSheetView(): JSX.Element | null {
  if (!lookSheetOpen.value) return null;
  void imageryVersion.value;
  const satellitePack = hasImagery("blue-marble");
  const reliefPack = hasImagery("relief");
  const current = THEMES.find((t) => t.id === themeId.value);
  const own = lookOverride.value;
  const drawn = currentTheme.value;
  const terrainSetting = terrain.value;
  const style = currentLayerStyle.value;
  return (
    <div class="sheet" data-id="look-sheet">
      <div class="sheet-title">Look</div>
      <div class="theme-grid">
        {THEMES.map((t) => (
          <button
            key={t.id}
            class={`theme-card ${themeId.value === t.id && lookFollowsTheme.value ? "on" : ""}`}
            data-id={`theme-${t.id}`}
            disabled={busy.value || (!!t.satellite && !satellitePack)}
            title={t.satellite && !satellitePack ? "Needs the satellite imagery pack, which is not installed yet" : t.hint}
            onClick={() => void changeTheme(t.id)}
          >
            <ThemeSwatch theme={t} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <div class="section-title">Your own colours</div>
      <div class="sheet-row import-row">
        <label class="swatch-field" title="The sea">
          <input type="color" data-id="look-ocean" value={drawn.ocean} disabled={busy.value} onChange={(e) => void changeLook({ ocean: (e.target as HTMLInputElement).value })} />
          <span>Sea</span>
        </label>
        <label class="swatch-field" title="The land. The roads, buildings and borders are worked out from it, and the names are kept readable on it.">
          <input type="color" data-id="look-land" value={drawn.land} disabled={busy.value} onChange={(e) => void changeLook({ land: (e.target as HTMLInputElement).value })} />
          <span>Land</span>
        </label>
        <label class="swatch-field" title="The colour of the pins, routes and callouts this map makes, and of its brightest roads">
          <input type="color" data-id="look-accent" value={drawn.accent} disabled={busy.value} onChange={(e) => void changeLook({ accent: (e.target as HTMLInputElement).value })} />
          <span>Lines</span>
        </label>
        <label class="swatch-field" title="The names on the map (pushed until they can be read on the land)">
          <input type="color" data-id="look-text" value={drawn.text} disabled={busy.value} onChange={(e) => void changeLook({ text: (e.target as HTMLInputElement).value })} />
          <span>Names</span>
        </label>
      </div>
      <div class="sheet-row">
        <button class="small-button" data-id="look-from-picture" disabled={busy.value} title="Takes the colours of a picture - a still from your film - and makes a map look of them" onClick={() => document.querySelector<HTMLInputElement>('input[data-id="look-picture-file"]')?.click()}>
          From a picture
        </button>
        <input
          type="file"
          data-id="look-picture-file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
          style={{ display: "none" }}
          onChange={(e) => {
            const input = e.target as HTMLInputElement;
            const file = input.files?.[0];
            input.value = "";
            if (file) void lookFromImage(file);
          }}
        />
        <button class="small-button" data-id="look-open" disabled={busy.value} title="Opens a look someone saved, or a palette from Illustrator or Photoshop (.ase, .act)" onClick={() => document.querySelector<HTMLInputElement>('input[data-id="look-open-file"]')?.click()}>
          Open a look
        </button>
        <input
          type="file"
          data-id="look-open-file"
          accept=".json,.lmllook,.ase,.act"
          style={{ display: "none" }}
          onChange={(e) => {
            const input = e.target as HTMLInputElement;
            const file = input.files?.[0];
            input.value = "";
            if (file) void openLookFile(file);
          }}
        />
        <button class="small-button" data-id="look-save" disabled={busy.value} title="Writes this look to a file you can keep or share" onClick={() => void saveLook()}>
          Save the look
        </button>
        <button class="small-button" data-id="look-reset" disabled={busy.value || lookFollowsTheme.value} title="Back to the colours of the look above" onClick={() => void changeLook({ ocean: null, land: null, accent: null, border: null, text: null })}>
          Back to {current?.label ?? "the look"}
        </button>
      </div>
      {(["blue-marble", "relief"] as const)
        .filter((pack) => !hasImagery(pack))
        .map((pack) => (
          <div key={pack} class="sheet-row import-row">
            <span class="grow" title={`${IMAGERY_INFO[pack].attribution}. Downloaded once from the project's GitHub page into your data folder; then it works offline.`}>
              {pack === "blue-marble" ? "Satellite pictures" : "Shaded relief"} <span class="muted">· {mb(IMAGERY_INFO[pack].bytes)}, once</span>
            </span>
            <button class="small-button" data-id={`imagery-${pack}`} disabled={busy.value} onClick={() => void downloadImageryPack(pack)}>
              Download
            </button>
          </div>
        ))}
      <label class="check" title={reliefPack ? "Mountains and valleys as soft shadows over the land (Natural Earth shaded relief)" : "Needs the shaded relief pack, which is not installed yet"}>
        <input type="checkbox" checked={reliefOn.value && !current?.satellite} disabled={busy.value || !reliefPack || !!current?.satellite} onChange={(e) => void changeRelief((e.target as HTMLInputElement).checked)} />
        Shaded relief {current?.satellite ? "(the satellite picture has its own)" : ""}
      </label>
      <label class="check" title="Fills what lies above the horizon of a tilted map with this look's sky. Off leaves it transparent, for a sky of your own in After Effects. The globe always has its atmosphere.">
        <input type="checkbox" data-id="sky" checked={skyOn.value} disabled={busy.value} onChange={(e) => void changeSky((e.target as HTMLInputElement).checked)} />
        Sky above the horizon
      </label>
      <div class="sheet-row import-row">
        <span title="Shaded slopes from real elevation data, sharp at any zoom. An elevation pack is downloaded once for an area (open data through Mapterhorn) and then works offline.">Terrain</span>
        <select
          class="grow"
          data-id="terrain-pack"
          value={terrainSetting?.pack ?? ""}
          disabled={busy.value}
          onChange={(e) => {
            const pack = (e.target as HTMLSelectElement).value;
            void changeTerrain(pack ? { pack, shade: terrainSetting?.shade ?? DEFAULT_SHADE, height: terrainSetting?.height ?? 0, ground: 0 } : null);
          }}
        >
          <option value="">Flat (no elevation pack)</option>
          {terrainSetting && !terrainPacks.value.some((p) => p.name === terrainSetting.pack) && <option value={terrainSetting.pack}>{terrainSetting.pack} (not on this computer)</option>}
          {terrainPacks.value.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name} ({mb(p.sizeBytes)})
            </option>
          ))}
        </select>
        <button class="small-button" data-id="terrain-download" disabled={busy.value} title="Downloads an elevation pack for the area in the preview" onClick={() => { lookSheetOpen.value = false; openTerrainSheet(); }}>
          Download…
        </button>
      </div>
      {terrainSetting && (
        <label class="num-field" title="How strongly slopes are shaded (0 switches the shading off)">
          <span>Shaded slopes</span>
          <input type="range" min={0} max={100} step={5} value={Math.round(terrainSetting.shade * 100)} disabled={busy.value} onChange={(e) => void changeTerrain({ ...terrainSetting, shade: Number((e.target as HTMLInputElement).value) / 100 })} />
          <span class="muted">{Math.round(terrainSetting.shade * 100)} %</span>
        </label>
      )}
      {terrainSetting && (
        <label class="num-field" title="Mountains rise in 3D: 1 is true to scale, more exaggerates them, 0 keeps the map flat. Pins, labels and routes made with this pack sit on the ground. The value lives in the map layer's Terrain Height slider, which can be keyed.">
          <span>3D height</span>
          <input type="range" min={0} max={MAX_HEIGHT * 10} step={1} data-id="terrain-height" value={Math.round(terrainSetting.height * 10)} disabled={busy.value} onChange={(e) => void changeTerrain({ ...terrainSetting, height: Number((e.target as HTMLInputElement).value) / 10 })} />
          <span class="muted">{terrainSetting.height > 0 ? `${terrainSetting.height.toFixed(1)}×` : "flat"}</span>
        </label>
      )}
      {terrainSetting && terrainSetting.height > 0 && (
        <div class="sheet-row import-row">
          <label class="num-field grow" title="The elevation the camera counts from (the map layer's Ground Level slider). Set it to the ground at the map's centre, so the camera keeps its usual height above the ground there.">
            <span>Ground level</span>
            <input type="number" min={-500} max={9000} step={10} data-id="terrain-ground" value={terrainSetting.ground} disabled={busy.value} onChange={(e) => void changeTerrain({ ...terrainSetting, ground: Number((e.target as HTMLInputElement).value) || 0 })} />
            <span class="muted">m</span>
          </label>
          <button class="small-button" disabled={busy.value} title="Reads the ground's elevation at the map's centre from the elevation pack" onClick={() => void groundAtCentre().then((ground) => changeTerrain({ ...terrainSetting, ground }))}>
            From the centre
          </button>
        </div>
      )}
      <div class="section-title">Pins, routes and callouts</div>
      <div class="sheet-row import-row">
        <input type="color" data-id="layer-accent" value={style.accent} disabled={busy.value} title="The colour of the layers the panel makes from now on" onChange={(e) => void changeLayerStyle({ accent: (e.target as HTMLInputElement).value })} />
        <label class="num-field" title="Line width in 1080-line pixels, scaled to the comp">
          <span>Line</span>
          <input type="number" min={0} max={40} step={0.5} data-id="layer-stroke" value={style.stroke} disabled={busy.value} onChange={(e) => void changeLayerStyle({ stroke: Number((e.target as HTMLInputElement).value) })} />
          <span class="muted">px</span>
        </label>
        <label class="check" title="A soft glow around routes and callout leaders (it reads on dark maps, less on light ones)">
          <input type="checkbox" data-id="layer-glow" checked={style.glow} disabled={busy.value} onChange={(e) => void changeLayerStyle({ glow: (e.target as HTMLInputElement).checked })} />
          <span>Glow</span>
        </label>
      </div>
      <div class="sheet-row">
        <button class="small-button" data-id="layer-style-pick" disabled={busy.value} title="Takes the colour and line width of the layer selected in After Effects" onClick={() => void pickUpLayerStyle()}>
          From the selected layer
        </button>
        <button class="small-button" data-id="layer-style-reset" disabled={busy.value || layerStyleFollowsLook.value} title="Back to the colours of this look" onClick={() => void changeLayerStyle({ accent: null, stroke: null, glow: null })}>
          Follow the look
        </button>
      </div>
      <div class="muted small">The look is saved with the map. Render again to see it in the comp; labels, pins, routes and callouts made from now on match it.</div>
    </div>
  );
}

export function RegionSheetView(): JSX.Element | null {
  const sheet = regionSheet.value;
  if (!sheet) return null;
  const isTerrain = sheet.kind === "terrain";
  const taken = !!sheet.name && (isTerrain ? terrainPacks.value : regions.value).some((r) => r.name === safeRegionName(sheet.name));
  const bytes = sheet.planned?.plan.tileBytes ?? 0;
  return (
    <div class="sheet" data-id="region-sheet">
      <div class="sheet-title">{isTerrain ? "Download elevation for the area in the preview" : "Download the area in the preview"}</div>
      <div class="sheet-row">
        <input
          placeholder="Region name, e.g. paris"
          value={sheet.name}
          onInput={(e) => (regionSheet.value = { ...sheet, name: (e.target as HTMLInputElement).value })}
          onBlur={(e) => {
            // Show the name the file will really get ("New York" becomes "new-york").
            const typed = (e.target as HTMLInputElement).value;
            if (typed.trim()) regionSheet.value = { ...sheet, name: safeRegionName(typed) };
          }}
        />
        <select value={sheet.maxZoom} onChange={(e) => (regionSheet.value = { ...sheet, maxZoom: Number((e.target as HTMLSelectElement).value), planned: undefined })}>
          {(isTerrain ? TERRAIN_DETAIL_ZOOMS : DETAIL_ZOOMS).map((z) => (
            <option key={z} value={z}>
              Detail to zoom {z} (≈{compactNumber(tilesUpTo(sheet.bbox, z))} tiles)
            </option>
          ))}
        </select>
      </div>
      <div class="muted small">
        Area {sheet.bbox.west.toFixed(3)}, {sheet.bbox.south.toFixed(3)} → {sheet.bbox.east.toFixed(3)}, {sheet.bbox.north.toFixed(3)} · {isTerrain ? "Open elevation data (Copernicus 30 m model and national surveys) through Mapterhorn, © Mapterhorn" : "OpenStreetMap data (© OpenStreetMap contributors) from the newest Protomaps planet build"}
      </div>
      {sheet.planned && (
        <div class="small">
          {sheet.planned.plan.tiles.length} tiles · <strong>{mb(bytes)}</strong> to download ({isTerrain ? "from " : "build "}{sheet.planned.build})
        </div>
      )}
      {sheet.planned && bytes > MAX_DOWNLOAD_BYTES && <div class="warning small">Too large to download in one go ({mb(bytes)}). Zoom the preview in to the area you need, or pick less detail.</div>}
      {sheet.planned && bytes > LARGE_DOWNLOAD_BYTES && bytes <= MAX_DOWNLOAD_BYTES && (
        <div class="warning small">This is a large download ({mb(bytes)}). For one city, zoom the preview in until the city fills it, or pick less detail.</div>
      )}
      {taken && <div class="warning small">{isTerrain ? "An elevation pack" : "A region"} named "{safeRegionName(sheet.name)}" already exists. Downloading replaces it.</div>}
      <div class="sheet-row">
        {!sheet.planned ? (
          <button disabled={busy.value} onClick={() => void checkRegionSize()}>
            Check size
          </button>
        ) : (
          <button class={taken || bytes > LARGE_DOWNLOAD_BYTES ? "danger" : "primary"} disabled={busy.value || bytes > MAX_DOWNLOAD_BYTES} onClick={() => void startRegionDownload()}>
            {taken ? (isTerrain ? "Replace existing pack" : "Replace existing region") : "Download"}
          </button>
        )}
        <button disabled={busy.value} onClick={() => (regionSheet.value = null)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** What an imported file holds: every line can be framed, drawn as a route, given a traveller, or flown along. */
/** Numbers on the map: which column names the country, which holds the value, and how it is coloured. */
export function DataSheetView(): JSX.Element | null {
  if (!dataSheetOpen.value) return null;
  const table = dataTable.value;
  if (!table) return null;
  const fill = dataFill.value;
  const colours = fill ? dataFillColors(fill) : null;
  return (
    <div class="sheet" data-id="data-sheet">
      <div class="sheet-title">{table.name}</div>
      <div class="muted small">
        {table.rows.length} rows. Every country - or every province of one country - that has a number is filled with the colour of its step, as one layer above the basemap. They are found by name in
        any language, by ISO code, by a state's short code, or by the number.
      </div>
      <div class="sheet-row">
        <label class="num-field grow" title="The column that names the country">
          <span>Country</span>
          <select data-id="data-key" value={String(dataKeyColumn.value)} disabled={busy.value} onChange={(e) => (dataKeyColumn.value = Number((e.target as HTMLSelectElement).value))}>
            {table.columns.map((column) => (
              <option key={column.index} value={String(column.index)}>
                {column.name}
              </option>
            ))}
          </select>
        </label>
        <label class="num-field grow" title="The column of numbers to colour by">
          <span>Colour by</span>
          <select data-id="data-value" value={String(dataValueColumn.value)} disabled={busy.value} onChange={(e) => (dataValueColumn.value = Number((e.target as HTMLSelectElement).value))}>
            {table.columns
              .filter((column) => column.kind === "number")
              .map((column) => (
                <option key={column.index} value={String(column.index)}>
                  {column.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      <div class="sheet-row import-row">
        <label class="num-field" title="What the rows are about. Left alone, the panel works it out from the table itself.">
          <span>Match</span>
          <select data-id="data-level" value={dataLevel.value} disabled={busy.value} onChange={(e) => void changeDataLevel((e.target as HTMLSelectElement).value as "auto" | "country" | "province")}>
            <option value="auto">Whatever fits</option>
            <option value="country">Countries</option>
            <option value="province">Provinces</option>
          </select>
        </label>
        {(dataLevel.value === "province" || dataCountry.value) && (
          <label class="num-field grow" title="The country whose provinces, states or divisions the rows name">
            <select data-id="data-country" value={dataCountry.value ?? ""} disabled={busy.value} onChange={(e) => void changeDataLevel("province", (e.target as HTMLSelectElement).value || null)}>
              {countryChoices().map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {flowFrom.value >= 0 && (
        <>
          <div class="section-title">Flows</div>
          <div class="muted small">A row with a place at each end and an amount becomes an arc whose width follows the amount, all drawing on together from the current time.</div>
          <div class="sheet-row">
            <label class="num-field" title="The column that says where a flow starts">
              <span>From</span>
              <select data-id="flow-from" value={String(flowFrom.value)} disabled={busy.value} onChange={(e) => (flowFrom.value = Number((e.target as HTMLSelectElement).value))}>
                {table.columns.filter((column) => column.kind === "text").map((column) => (
                  <option key={column.index} value={String(column.index)}>{column.name}</option>
                ))}
              </select>
            </label>
            <label class="num-field" title="The column that says where it ends">
              <span>To</span>
              <select data-id="flow-to" value={String(flowTo.value)} disabled={busy.value} onChange={(e) => (flowTo.value = Number((e.target as HTMLSelectElement).value))}>
                {table.columns.filter((column) => column.kind === "text").map((column) => (
                  <option key={column.index} value={String(column.index)}>{column.name}</option>
                ))}
              </select>
            </label>
            <label class="num-field" title="The amount, which sets the width of the arc">
              <span>Amount</span>
              <select data-id="flow-value" value={String(flowValue.value)} disabled={busy.value} onChange={(e) => (flowValue.value = Number((e.target as HTMLSelectElement).value))}>
                {table.columns.filter((column) => column.kind === "number").map((column) => (
                  <option key={column.index} value={String(column.index)}>{column.name}</option>
                ))}
              </select>
            </label>
          </div>
          <div class="sheet-row">
            <label class="num-field" title="The widest arc, in pixels at 1080 lines">
              <span>Widest</span>
              <input type="number" min={2} max={60} step={1} data-id="flow-width" value={flowWidth.value} disabled={busy.value} onChange={(e) => (flowWidth.value = Math.max(2, Math.min(60, Number((e.target as HTMLInputElement).value) || 14)))} />
              <span class="muted">px</span>
            </label>
            <label class="num-field" title="How long the arcs take to draw on">
              <span>Over</span>
              <input type="number" min={0.5} step={0.5} data-id="flow-seconds" value={flowSeconds.value} disabled={busy.value} onChange={(e) => (flowSeconds.value = Math.max(0.5, Number((e.target as HTMLInputElement).value) || 4))} />
              <span class="muted">s</span>
            </label>
            <label class="check" title="An arrow rides every arc">
              <input type="checkbox" data-id="flow-arrows" checked={flowArrows.value} disabled={busy.value} onChange={(e) => (flowArrows.value = (e.target as HTMLInputElement).checked)} />
              <span>Arrows</span>
            </label>
            <button class="primary" data-id="flow-draw" disabled={busy.value} title="Draws every row as an arc between its two places" onClick={() => void drawFlows()}>
              Draw flows
            </button>
          </div>
          <div class="section-title">Colours</div>
        </>
      )}
      <div class="sheet-row">
        <label class="num-field" title="The colours the steps run through">
          <select data-id="data-ramp" value={dataRamp.value} disabled={busy.value} onChange={(e) => void changeDataFill({ ramp: (e.target as HTMLSelectElement).value as RampId })}>
            {RAMPS.map((ramp) => (
              <option key={ramp.id} value={ramp.id}>
                {ramp.name}
              </option>
            ))}
          </select>
        </label>
        <label class="num-field" title="How many steps the numbers are put into">
          <span>Steps</span>
          <input type="number" min={3} max={9} step={1} data-id="data-steps" value={dataSteps.value} disabled={busy.value} onChange={(e) => void changeDataFill({ steps: Number((e.target as HTMLInputElement).value) })} />
        </label>
        <label class="num-field" title="Even steps keep the distances honest; equal counts give every step about as many countries, which shows the order when a few large numbers would flatten the rest.">
          <select data-id="data-method" value={dataMethod.value} disabled={busy.value} onChange={(e) => void changeDataFill({ method: (e.target as HTMLSelectElement).value as ScaleMethod })}>
            <option value="equal">Even steps</option>
            <option value="quantile">Equal counts</option>
          </select>
        </label>
        <label class="check" title="Which end of the ramp means the larger numbers. A dark map starts turned over, because a pale country reads as more on it.">
          <input type="checkbox" data-id="data-reverse" checked={!!fill?.reverse} disabled={busy.value || !fill} onChange={(e) => void changeDataFill({ reverse: (e.target as HTMLInputElement).checked })} />
          <span>Flip</span>
        </label>
        <label class="num-field" title="How solid the fill is">
          <input type="range" min={10} max={100} step={5} data-id="data-opacity" value={Math.round(dataOpacity.value * 100)} disabled={busy.value} onChange={(e) => void changeDataFill({ opacity: Number((e.target as HTMLInputElement).value) / 100 })} />
          <span class="muted">{Math.round(dataOpacity.value * 100)} %</span>
        </label>
      </div>
      {colours && (
        <div class="legend" data-id="data-legend" title={`${colours.codes.length} countries coloured by ${fill!.column}`}>
          {colours.legend.map((step) => (
            <span key={step.color} class="legend-step">
              <span class="legend-swatch" style={{ background: step.color }} />
              {step.label}
            </span>
          ))}
        </div>
      )}
      {dataMessage.value && <div class="muted small">{dataMessage.value}</div>}
      <div class="sheet-row">
        <button class="small-button" data-id="data-bubbles-add" disabled={busy.value || !fill} title="Numbers as circles on the map, as one layer: the area of a circle stands for its value. Every circle has its own transform to animate." onClick={() => void addDataBubbles()}>
          Add bubbles
        </button>
        <label class="num-field" title="The largest circle, in pixels at 1080 lines">
          <input type="number" min={6} max={200} step={2} data-id="bubble-size" value={bubbleSize.value} disabled={busy.value} onChange={(e) => (bubbleSize.value = Math.max(6, Math.min(200, Number((e.target as HTMLInputElement).value) || 44)))} />
          <span class="muted">px</span>
        </label>
        <label class="check" title="Colour each circle by its step as well, instead of the one accent colour">
          <input type="checkbox" data-id="bubble-coloured" checked={bubbleColoured.value} disabled={busy.value} onChange={(e) => (bubbleColoured.value = (e.target as HTMLInputElement).checked)} />
          <span>In step colours</span>
        </label>
        <button class="small-button" data-id="data-bubbles-remove" disabled={busy.value} title="Takes the circles off the map" onClick={() => void removeDataBubbles()}>
          Remove bubbles
        </button>
      </div>
      <div class="sheet-row">
        <button class="small-button" data-id="data-values-add" disabled={busy.value || !fill} title="Writes every number onto the map as a text layer, under its circle when there is one" onClick={() => void addDataValues()}>
          Add numbers
        </button>
        <label class="check" title="Put the name of the place above its number">
          <input type="checkbox" data-id="values-with-names" checked={valuesWithNames.value} disabled={busy.value} onChange={(e) => (valuesWithNames.value = (e.target as HTMLInputElement).checked)} />
          <span>With names</span>
        </label>
        <button class="small-button" data-id="data-values-remove" disabled={busy.value} title="Takes the numbers off the map" onClick={() => void removeDataValues()}>
          Remove numbers
        </button>
      </div>
      <div class="sheet-row">
        <button class="small-button" data-id="data-legend-add" disabled={busy.value || !fill} title="Adds the legend to the scene as a precomp: a background, the title and one row per step. Move it, restyle it or animate it like any layer." onClick={() => void addDataLegend()}>
          Add legend
        </button>
        <label class="num-field" title="Which corner of the frame the legend starts in">
          <select data-id="legend-corner" value={legendCorner.value} disabled={busy.value} onChange={(e) => (legendCorner.value = (e.target as HTMLSelectElement).value as LegendCorner)}>
            <option value="bottomLeft">Bottom left</option>
            <option value="bottomRight">Bottom right</option>
            <option value="topLeft">Top left</option>
            <option value="topRight">Top right</option>
          </select>
        </label>
        <button class="small-button" data-id="data-legend-remove" disabled={busy.value} title="Takes the legend off the scene" onClick={() => void removeDataLegend()}>
          Remove legend
        </button>
      </div>
      <div class="sheet-row">
        <button class="primary" data-id="data-apply" disabled={busy.value} title="Colours every country that has a number" onClick={() => void applyDataFill()}>
          {fill ? "Colour again" : "Colour the map"}
        </button>
        <button class="small-button" data-id="data-clear" disabled={busy.value || !fill} title="Takes the numbers off the map" onClick={() => void clearDataFill()}>
          Remove
        </button>
        <button data-id="data-close" onClick={() => (dataSheetOpen.value = false)}>
          Close
        </button>
      </div>
    </div>
  );
}

export function OsmSheetView(): JSX.Element | null {
  if (!osmSheetOpen.value) return null;
  return (
    <div class="sheet" data-id="osm-sheet">
      <div class="sheet-title">Find on OpenStreetMap</div>
      <div class="muted small">
        Anything OpenStreetMap holds for the area the preview shows: rivers, lakes, parks, islands, airports, district boundaries, buildings. What is found arrives as an import, so you can draw it,
        highlight it or add it as a shape layer. Free for commercial work, with credit to OpenStreetMap.
      </div>
      <div class="sheet-row">
        <input
          type="text"
          data-id="osm-text"
          placeholder="A name, or part of one"
          value={osmText.value}
          disabled={busy.value}
          onInput={(e) => (osmText.value = (e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if ((e as KeyboardEvent).key === "Enter") void findOsm();
          }}
        />
        <label class="num-field" title="What to look for. With a kind picked, the name may be left empty.">
          <select data-id="osm-kind" value={osmKindId.value} disabled={busy.value} onChange={(e) => (osmKindId.value = (e.target as HTMLSelectElement).value as OsmKind)}>
            {OSM_KINDS.map((kind) => (
              <option key={kind.id} value={kind.id}>
                {kind.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {osmMessage.value && <div class="muted small">{osmMessage.value}</div>}
      <div class="sheet-row">
        <button class="primary" data-id="osm-find" disabled={busy.value} title="Asks OpenStreetMap about the area the preview shows" onClick={() => void findOsm()}>
          Find in view
        </button>
        <button data-id="osm-close" onClick={() => (osmSheetOpen.value = false)}>
          Close
        </button>
      </div>
    </div>
  );
}

export function ImportSheetView(props: { pickFile: () => void }): JSX.Element | null {
  const [seconds, setSeconds] = useState(5);
  const [recordedPace, setRecordedPace] = useState(false);
  const data = imported.value;
  if (!importSheetOpen.value || !data) return null;
  const hasMap = !!selected.value;
  const lines = data.lines.slice(0, 12);
  return (
    <div class="sheet" data-id="import-sheet">
      <div class="sheet-title">{data.fileName}</div>
      {lines.map((line, i) => (
        <div key={i} class="sheet-row import-row">
          <span class="grow" title={`${line.points.length} points${line.times ? ", with times" : ""}`}>
            {line.name} <span class="muted">· {line.lengthKm >= 10 ? Math.round(line.lengthKm) : line.lengthKm.toFixed(1)} km</span>
          </span>
          <button class="small-button" title="Frame this line in the preview" onClick={() => fitLine(line.points)}>
            Fit
          </button>
          <button class="small-button" disabled={busy.value || !hasMap} title="A route layer that follows the map and draws on from the current time" onClick={() => void drawImportedLine(line, seconds, false, recordedPace)}>
            Draw
          </button>
          <button class="small-button" disabled={busy.value || !hasMap} data-id={`import-arrow-${i}`} title="The route, plus an arrow that travels along it and turns with it. Parent your own artwork to the Traveller layer." onClick={() => void drawImportedLine(line, seconds, true, recordedPace)}>
            Draw + arrow
          </button>
          <button class="small-button" disabled={!hasMap} title="Adds shots that move the camera along this line (Shots tab; Play shows it at once)" onClick={() => addRouteShot(line, seconds)}>
            Camera
          </button>
        </div>
      ))}
      {data.lines.length > lines.length && <div class="muted small">…and {data.lines.length - lines.length} shorter lines.</div>}
      {data.areas.length > 0 && <div class="section-title">Areas</div>}
      {data.areas.slice(0, 40).map((area, i) => {
        const on = highlights.value.some((h) => h.code === areaCode(area));
        return (
          <div key={`area-${i}`} class="sheet-row import-row">
            <span class="grow" title={`${area.points} points`}>
              {area.name}
            </span>
            <button class="small-button" title="Frame this area in the preview" onClick={() => fitLine(area.polygons.flatMap((polygon) => polygon[0].map(([lng, lat]) => ({ lng, lat }))))}>
              Fit
            </button>
            <button
              class={`small-button ${on ? "active" : ""}`}
              disabled={busy.value}
              title="Highlights this area: it renders on the Highlight layer above the basemap, like highlighted countries. Click again to remove it."
              onClick={() => toggleAreaHighlight(area)}
            >
              {on ? "Highlighted" : "Highlight"}
            </button>
          </div>
        );
      })}
      {data.areas.length > 40 && <div class="muted small">…and {data.areas.length - 40} more areas.</div>}
      <div class="sheet-row">
        <label class="num-field" title="How long a route takes to draw on, and a camera move along it">
          <span>Duration</span>
          <input type="number" min={0.5} step={0.5} value={seconds} onChange={(e) => setSeconds(Math.max(0.5, Number((e.target as HTMLInputElement).value) || 5))} />
          <span class="muted">s</span>
        </label>
        <label class="check" title="A bright head runs along the line while it draws on, like a comet.">
          <input type="checkbox" data-id="route-comet" checked={routeComet.value} onChange={(e) => (routeComet.value = (e.target as HTMLInputElement).checked)} />
          <span>Comet</span>
        </label>
        <label class="check" title="Draws the line dashed instead of solid.">
          <input type="checkbox" data-id="route-dashed" checked={routeDashed.value} onChange={(e) => (routeDashed.value = (e.target as HTMLInputElement).checked)} />
          <span>Dashed</span>
        </label>
        {data.lines.some((line) => line.times) && (
          <label class="check" title="Lines that were recorded with times (GPS tracks, flight logs) draw on at the pace of the recording: fast where it was fast, slow where it was slow, with long stops shortened. Off: an even pace.">
            <input type="checkbox" data-id="recorded-pace" checked={recordedPace} onChange={(e) => setRecordedPace((e.target as HTMLInputElement).checked)} />
            <span>Recorded pace</span>
          </label>
        )}
        {data.places.length > 0 && (
          <button class="small-button" disabled={busy.value || !hasMap} onClick={() => void pinImportedPlaces(data.places)}>
            Pin {data.places.length} {data.places.length === 1 ? "place" : "places"}
          </button>
        )}
        <span class="spacer" />
        <button class="small-button" disabled={busy.value} onClick={props.pickFile}>
          Another file…
        </button>
        <button class="small-button" data-id="import-close" onClick={() => (importSheetOpen.value = false)}>
          Close
        </button>
      </div>
    </div>
  );
}

const megabytes = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** Districts come per country as a download: what is installed, and the offer for the country just clicked. */
function DistrictSets(): JSX.Element {
  const sets = listDistrictSets();
  const prompt = districtPrompt.value;
  return (
    <div class="district-sets" data-id="district-sets">
      {sets.length === 0 && !prompt && <div class="muted small">Districts are downloaded per country, once. Click a country on the map to see what is available for it.</div>}
      {sets.map((set) => (
        <div key={set.iso} class="sheet-row import-row">
          <span class="grow" title={`${set.source} · ${set.license} · through geoBoundaries, downloaded ${set.downloaded}`}>
            {set.countryName} <span class="muted">· {set.units.length} {set.unit} boundaries</span>
          </span>
          <button class="small-button" title="Removes this country's district boundaries from this computer (highlights already on maps keep their shapes)" onClick={() => removeDistrictSet(set.iso)}>
            ✕
          </button>
        </div>
      ))}
      {prompt && prompt.state === "looking" && <div class="muted small">Asking geoBoundaries about {prompt.country.name}…</div>}
      {prompt && prompt.state === "none" && <div class="muted small">geoBoundaries has no district boundaries for {prompt.country.name}. Import a KML, GeoJSON or shapefile instead.</div>}
      {prompt && prompt.state === "failed" && <div class="warning small">Could not reach geoBoundaries ({prompt.message}). Check the internet connection and click the country again.</div>}
      {prompt && prompt.state === "offer" && prompt.offer && (
        <div class="sheet-row import-row">
          <span class="grow" title={`${prompt.offer.source || "geoBoundaries"} · ${prompt.offer.license || "open licence"}`}>
            {prompt.country.name} <span class="muted">· {prompt.offer.count} {prompt.offer.unit} boundaries</span>
          </span>
          <button class="small-button" data-id="district-download" disabled={busy.value} title="Downloads this country's boundaries from geoBoundaries (open data) and keeps them on this computer" onClick={() => void downloadDistricts()}>
            Download{prompt.offer.sizeBytes ? ` ${megabytes(prompt.offer.sizeBytes)}` : ""}
          </button>
        </div>
      )}
      {prompt && prompt.state === "offer" && prompt.offer && (
        <div class="muted small">
          From geoBoundaries (open data): {prompt.offer.source || "national sources"}. {prompt.offer.license || "Open licence"}.
        </div>
      )}
    </div>
  );
}

/** The highlighted countries: colour, fill and outline; shown while the highlight tool is on. */
export function HighlightSheetView(): JSX.Element | null {
  if (tool.value !== "highlight") return null;
  const list = highlights.value;
  const first = list[0];
  return (
    <div class="sheet" data-id="highlight-sheet">
      <div class="sheet-title">Highlight</div>
      <div class="chips">
        <button class={`chip ${highlightLevel.value === "country" ? "on" : ""}`} data-id="level-country" onClick={() => (highlightLevel.value = "country")} title="A click on the map picks the whole country">
          Countries
        </button>
        <button class={`chip ${highlightLevel.value === "province" ? "on" : ""}`} data-id="level-province" onClick={() => (highlightLevel.value = "province")} title="A click on the map picks the province, state or division under it">
          Provinces
        </button>
        <button class={`chip ${highlightLevel.value === "district" ? "on" : ""}`} data-id="level-district" onClick={() => (highlightLevel.value = "district")} title="A click on the map picks the district, county or department under it. A country's districts are downloaded once, when you ask for them.">
          Districts
        </button>
      </div>
      {highlightLevel.value === "district" && <DistrictSets />}
      <div class="muted small">Click a country, province or district on the map to highlight it, click it again to remove it (or use the highlight button next to a search result). Any shape of your own: import a KML, GeoJSON or shapefile and press Highlight next to the area. Render to get every highlight as its own layer above the basemap: fade them in one after another, colour them or add a glow in After Effects.</div>
      {list.map((h) => (
        <div key={h.code} class="sheet-row highlight-row">
          <input type="color" value={h.color} title="Colour" onChange={(e) => void setHighlights(list.map((x) => (x.code === h.code ? { ...x, color: (e.target as HTMLInputElement).value } : x)))} />
          <span class="grow">{h.name}</span>
          <button
            class="small-button"
            data-id={`shape-${h.code}`}
            disabled={busy.value}
            title="Adds this outline as an editable After Effects shape layer: real paths that follow the map, with a fill and a stroke you can restyle, animate or trim by hand."
            onClick={() => void addHighlightShape(h)}
          >
            Shape
          </button>
          <button class="small-button" title="Remove this highlight" onClick={() => void setHighlights(list.filter((x) => x.code !== h.code))}>
            ✕
          </button>
        </div>
      ))}
      {list.length > 0 && (
        <label class="check" title="A shape layer's outline draws on with Trim Paths over four seconds from the current time.">
          <input type="checkbox" data-id="shape-draw-on" checked={shapeDrawOn.value} onChange={(e) => (shapeDrawOn.value = (e.target as HTMLInputElement).checked)} />
          <span>Shape layers draw on</span>
        </label>
      )}
      {first && (
        <div class="sheet-row">
          <label class="num-field" title="How solid the fill is (0 for an outline only)">
            <span>Fill</span>
            <input type="range" min={0} max={100} step={5} value={Math.round(first.fill * 100)} onChange={(e) => void setHighlights(list.map((x) => ({ ...x, fill: Number((e.target as HTMLInputElement).value) / 100 })))} />
            <span class="muted">{Math.round(first.fill * 100)} %</span>
          </label>
          <label class="num-field" title="Outline width in comp pixels (0 for none)">
            <span>Outline</span>
            <input type="number" min={0} max={40} step={0.5} value={first.outline} onChange={(e) => void setHighlights(list.map((x) => ({ ...x, outline: Number((e.target as HTMLInputElement).value) })))} />
            <span class="muted">px</span>
          </label>
        </div>
      )}
      {list.length > 1 && (
        <label class="check" title="Off: every highlight renders as its own layer, so each can be timed and styled alone. On: one layer holds them all, which renders faster when a map has many highlights.">
          <input type="checkbox" data-id="highlight-one-layer" checked={highlightLayers.value === "one"} disabled={busy.value} onChange={(e) => void changeHighlightLayers((e.target as HTMLInputElement).checked ? "one" : "each")} />
          <span>One layer for all highlights</span>
        </label>
      )}
      <div class="section-title">Make a new area</div>
      <div class="sheet-row import-row">
        <button
          class="small-button"
          data-id="merge-areas"
          disabled={busy.value || list.length < 2}
          title="One area out of every highlight, with the borders between the ones that touch gone. They are replaced by the new area."
          onClick={() => void mergeHighlights()}
        >
          Merge into one
        </button>
        <label class="num-field" title="How far Grow, Shrink and Circle reach">
          <input type="number" min={1} max={2000} step={5} data-id="combine-km" value={combineKm.value} disabled={busy.value} onChange={(e) => (combineKm.value = Math.max(1, Math.min(2000, Number((e.target as HTMLInputElement).value) || 1)))} />
          <span class="muted">km</span>
        </label>
        <button class="small-button" data-id="grow-areas" disabled={busy.value || !list.length} title="Pushes the edge of every highlighted area out by this distance. Parts that come within it of each other join up." onClick={() => void growHighlights(combineKm.value)}>
          Grow
        </button>
        <button class="small-button" data-id="shrink-areas" disabled={busy.value || !list.length} title="Pulls the edge in by this distance. Parts narrower than it disappear." onClick={() => void growHighlights(-combineKm.value)}>
          Shrink
        </button>
        <button class="small-button" data-id="circle-area" disabled={busy.value} title="A circle of this distance around the middle of the preview: a distance ring around a city, a site or an event" onClick={() => void addCircleArea(combineKm.value)}>
          Circle here
        </button>
      </div>
      <div class="sheet-row">
        <button class="small-button" onClick={() => (tool.value = "none")}>
          Done
        </button>
      </div>
    </div>
  );
}

/** The attach tool: what is selected in After Effects, how it will follow the map, and Unlink. */
export function AttachSheetView(): JSX.Element | null {
  if (tool.value !== "attach") return null;
  const info = selection.value;
  return (
    <div class="sheet" data-id="attach-sheet">
      <div class="sheet-title">Attach your layers to a place</div>
      <div class="muted small">
        Select your own layers in After Effects (icons, photos, precomps, text), then click the place on the map. They get Latitude and Longitude sliders and stay on that place while the camera moves. Everything else about the layer stays yours.
      </div>
      <div class="sheet-row import-row">
        <span class="grow small" data-id="attach-selection">
          {info ? (
            info.usable ? (
              <>
                {info.usable} {info.usable === 1 ? "layer" : "layers"} selected in {info.scene}
                {info.attached ? <span class="muted"> · {info.attached} already attached</span> : null}
              </>
            ) : (
              <span class="muted">Nothing usable selected in {info.scene}</span>
            )
          ) : (
            <span class="muted">Select a map first</span>
          )}
        </span>
        <button class="small-button" data-id="attach-refresh" disabled={busy.value} title="Reads the selection in After Effects again" onClick={() => void refreshSelection()}>
          Refresh
        </button>
      </div>
      <label class="check" title="The layer's own size is multiplied by the map's zoom, so it grows as the camera comes closer (like a pin that scales with the map).">
        <input type="checkbox" data-id="attach-scale" checked={attachScale.value} onChange={(e) => (attachScale.value = (e.target as HTMLInputElement).checked)} />
        <span>Grow with the map</span>
      </label>
      <label class="check" title="The layer turns with the map's bearing, so it keeps its direction on the ground.">
        <input type="checkbox" data-id="attach-rotate" checked={attachRotate.value} onChange={(e) => (attachRotate.value = (e.target as HTMLInputElement).checked)} />
        <span>Turn with the map</span>
      </label>
      <div class="sheet-row">
        <button class="small-button" data-id="attach-detach" disabled={busy.value || !info?.attached} title="Removes the controls and expressions from the selected attached layers and leaves them where they are" onClick={() => void detachSelected()}>
          Unlink selected
        </button>
        <span class="spacer" />
        <button class="small-button" onClick={() => (tool.value = "none")}>
          Done
        </button>
      </div>
    </div>
  );
}

/** The hint while a tool waits for clicks, and the callout and route sheets once it has its places. */
export function ToolSheetView(): JSX.Element | null {
  const sheet = toolSheet.value;
  if (!sheet) {
    if (tool.value === "none" || tool.value === "highlight" || tool.value === "attach") return null;
    const hint =
      tool.value === "route"
        ? toolFirstPoint.value
          ? "Now click where the route ends."
          : "Click where the route starts."
        : tool.value === "callout"
          ? "Click the place the callout points at."
          : "Click the place for the pin.";
    return (
      <div class="sheet hint-sheet">
        <span>{hint}</span>
        <button class="small-button" onClick={() => (tool.value = "none")}>
          Cancel
        </button>
      </div>
    );
  }
  return (
    <div class="sheet" data-id="tool-sheet">
      <div class="sheet-title">{sheet.kind === "callout" ? "Callout" : "Route"}</div>
      {sheet.kind === "callout" && (
        <div class="sheet-row">
          <input placeholder="Title, e.g. Paris" value={sheet.title} onInput={(e) => (toolSheet.value = { ...sheet, title: (e.target as HTMLInputElement).value })} />
          <input placeholder="Subtitle (optional)" value={sheet.subtitle} onInput={(e) => (toolSheet.value = { ...sheet, subtitle: (e.target as HTMLInputElement).value })} />
        </div>
      )}
      <div class="sheet-row">
        <label class="num-field">
          <span>{sheet.kind === "callout" ? "Shows for" : "Draws on over"}</span>
          <input
            type="number"
            min={0.5}
            step={0.5}
            value={sheet.seconds}
            onChange={(e) => {
              const seconds = Number((e.target as HTMLInputElement).value);
              if (Number.isFinite(seconds) && seconds > 0) toolSheet.value = { ...sheet, seconds };
            }}
          />
          <span class="muted">s, from the current time</span>
        </label>
      </div>
      {sheet.kind === "route" && (
        <div class="sheet-row">
          <label class="check" title="An arrow that travels along the route and turns with it. Parent your own artwork (a plane, a car) to the Traveller layer and switch its Contents off.">
            <input type="checkbox" data-id="route-arrow" checked={routeArrow.value} onChange={(e) => (routeArrow.value = (e.target as HTMLInputElement).checked)} />
            <span>Arrow</span>
          </label>
          <label class="check" title="A bright head runs along the line while it draws on, like a comet.">
            <input type="checkbox" data-id="tool-route-comet" checked={routeComet.value} onChange={(e) => (routeComet.value = (e.target as HTMLInputElement).checked)} />
            <span>Comet</span>
          </label>
          <label class="check" title="Draws the line dashed instead of solid.">
            <input type="checkbox" data-id="tool-route-dashed" checked={routeDashed.value} onChange={(e) => (routeDashed.value = (e.target as HTMLInputElement).checked)} />
            <span>Dashed</span>
          </label>
        </div>
      )}
      <div class="sheet-row">
        <button class="primary" data-id="tool-sheet-add" disabled={busy.value} onClick={() => void confirmToolSheet()}>
          Add {sheet.kind}
        </button>
        <button onClick={() => (toolSheet.value = null)}>Cancel</button>
      </div>
    </div>
  );
}

export function LabelsSheetView(): JSX.Element | null {
  if (!labelsSheetOpen.value) return null;
  const labels = currentLabelTemplate.value;
  return (
    <div class="sheet" data-id="labels-sheet">
      <div class="sheet-title">Auto labels</div>
      <div class="muted small">Country and city names as editable text layers, placed over the whole timeline without overlaps or flicker. Running it again replaces the labels it made before.</div>
      <div class="sheet-row">
        <label class="num-field grow">
          <span>Language</span>
          <select value={labelLanguage.value} onChange={(e) => (labelLanguage.value = (e.target as HTMLSelectElement).value)}>
            {LABEL_LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div class="sheet-row">
        <label class="num-field grow" title="The most important names come first: countries, capitals, large cities">
          <span>How many</span>
          <select data-id="label-density" value={labelDensity.value} onChange={(e) => (labelDensity.value = (e.target as HTMLSelectElement).value as keyof typeof LABEL_DENSITIES)}>
            {(Object.keys(LABEL_DENSITIES) as (keyof typeof LABEL_DENSITIES)[]).map((key) => (
              <option key={key} value={key}>
                {LABEL_DENSITIES[key].label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div class="section-title">How the names look</div>
      <div class="sheet-row import-row">
        <input type="color" data-id="label-color" value={labels.color} disabled={busy.value} title="The colour of city names (country names take it too when you pick a style up from a layer)" onChange={(e) => void changeLabelTemplate({ color: (e.target as HTMLInputElement).value, countryColor: (e.target as HTMLInputElement).value })} />
        <label class="num-field" title="City name size in 1080-line pixels; country names are a little larger">
          <span>Size</span>
          <input type="number" min={6} max={200} step={1} data-id="label-size" value={labels.size} disabled={busy.value} onChange={(e) => void changeLabelTemplate({ size: Number((e.target as HTMLInputElement).value) })} />
          <span class="muted">px</span>
        </label>
        <label class="num-field" title="The outline that keeps a name readable over any map (0 for none)">
          <span>Halo</span>
          <input type="number" min={0} max={20} step={0.5} data-id="label-halo" value={labels.halo} disabled={busy.value} onChange={(e) => void changeLabelTemplate({ halo: Number((e.target as HTMLInputElement).value) })} />
          <span class="muted">px</span>
        </label>
      </div>
      <div class="sheet-row import-row">
        <label class="check" title="Country names in capitals, with the letter spacing that suits them (scripts without capitals are left alone)">
          <input type="checkbox" data-id="label-caps" checked={labels.caps} disabled={busy.value} onChange={(e) => void changeLabelTemplate({ caps: (e.target as HTMLInputElement).checked })} />
          <span>Countries in capitals</span>
        </label>
        <label class="check" title="The dot that marks a city next to its name">
          <input type="checkbox" data-id="label-dots" checked={labels.dots} disabled={busy.value} onChange={(e) => void changeLabelTemplate({ dots: (e.target as HTMLInputElement).checked })} />
          <span>Dots</span>
        </label>
      </div>
      <div class="sheet-row">
        <button class="small-button" data-id="label-style-pick" disabled={busy.value} title="Takes the font, size, colour and halo of the text layer selected in After Effects. Latin, Cyrillic and Greek names use that font; other scripts keep fonts that shape them correctly." onClick={() => void pickUpLabelStyle()}>
          From the selected text layer
        </button>
        <button class="small-button" data-id="label-style-reset" disabled={busy.value || labelTemplateFollows.value} title="Back to the names of this look" onClick={() => void changeLabelTemplate({ color: null, countryColor: null, haloColor: null, halo: null, size: null, caps: null, dots: null, font: null })}>
          Follow the look
        </button>
      </div>
      {labels.font && <div class="muted small">Latin names use {labels.font}.</div>}
      <div class="section-title">Keep the names out of</div>
      <div class="sheet-row chips">
        {KEEP_OUT_PRESETS.map((preset) => (
          <button
            key={preset.id}
            class={`chip ${hasZone(keepOut.value, preset.id) ? "on" : ""}`}
            data-id={`keep-out-${preset.id}`}
            disabled={busy.value}
            title={`No name is placed in the ${preset.name.toLowerCase()} of the frame`}
            onClick={() => void toggleKeepOutPreset(preset)}
          >
            {preset.name}
          </button>
        ))}
      </div>
      <div class="sheet-row">
        <button
          class="small-button"
          data-id="keep-out-layers"
          disabled={busy.value}
          title="Takes the bounds of the layers selected in After Effects. Names keep away from them for as long as those layers are on screen."
          onClick={() => void keepOutFromLayers()}
        >
          From the selected layers
        </button>
      </div>
      {keepOut.value
        .filter((zone) => !KEEP_OUT_PRESETS.some((preset) => preset.id === zone.id))
        .map((zone) => (
          <div class="sheet-row" key={zone.id}>
            <span class="grow small" title={`${Math.round(zone.width * 100)} x ${Math.round(zone.height * 100)} % of the frame`}>
              {zone.name}
              {zone.from !== null && <span class="muted"> · {zone.from.toFixed(1)}-{(zone.to ?? 0).toFixed(1)} s</span>}
            </span>
            <button class="small-button" data-id={`keep-out-remove-${zone.id}`} disabled={busy.value} title="Stop keeping names away from this" onClick={() => void removeKeepOut(zone.id)}>
              Remove
            </button>
          </div>
        ))}
      <div class="sheet-row">
        <button
          class="primary"
          data-id="place-labels"
          disabled={busy.value}
          onClick={() => {
            labelsSheetOpen.value = false;
            void runAutoLabels();
          }}
        >
          Place labels
        </button>
        <button disabled={busy.value} onClick={() => void removeLabels()} title="Removes every label Auto labels made for this map, in one undo step">
          Remove labels
        </button>
        <button onClick={() => (labelsSheetOpen.value = false)}>Close</button>
      </div>
    </div>
  );
}
