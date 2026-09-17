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
import { hasImagery } from "../imagery/packs.ts";
import { highlightLevel } from "../store.ts";
import { areaCode, changeRelief, changeTheme, drawImportedLine, fitLine, highlights, importSheetOpen, imported, pinImportedPlaces, reliefOn, selected, setHighlights, themeId, toggleAreaHighlight } from "../store.ts";
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
  const satellitePack = hasImagery("blue-marble");
  const reliefPack = hasImagery("relief");
  const current = THEMES.find((t) => t.id === themeId.value);
  return (
    <div class="sheet" data-id="look-sheet">
      <div class="sheet-title">Look</div>
      <div class="theme-grid">
        {THEMES.map((t) => (
          <button
            key={t.id}
            class={`theme-card ${themeId.value === t.id ? "on" : ""}`}
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
      <label class="check" title={reliefPack ? "Mountains and valleys as soft shadows over the land (Natural Earth shaded relief)" : "Needs the shaded relief pack, which is not installed yet"}>
        <input type="checkbox" checked={reliefOn.value && !current?.satellite} disabled={busy.value || !reliefPack || !!current?.satellite} onChange={(e) => void changeRelief((e.target as HTMLInputElement).checked)} />
        Shaded relief {current?.satellite ? "(the satellite picture has its own)" : ""}
      </label>
      <div class="muted small">The look is saved with the map. Render again to see it in the comp; labels made from now on match it.</div>
    </div>
  );
}

export function RegionSheetView(): JSX.Element | null {
  const sheet = regionSheet.value;
  if (!sheet) return null;
  const taken = !!sheet.name && regions.value.some((r) => r.name === safeRegionName(sheet.name));
  const bytes = sheet.planned?.plan.tileBytes ?? 0;
  return (
    <div class="sheet" data-id="region-sheet">
      <div class="sheet-title">Download the area in the preview</div>
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
          {DETAIL_ZOOMS.map((z) => (
            <option key={z} value={z}>
              Detail to zoom {z} (≈{compactNumber(tilesUpTo(sheet.bbox, z))} tiles)
            </option>
          ))}
        </select>
      </div>
      <div class="muted small">
        Area {sheet.bbox.west.toFixed(3)}, {sheet.bbox.south.toFixed(3)} → {sheet.bbox.east.toFixed(3)}, {sheet.bbox.north.toFixed(3)} · OpenStreetMap data (© OpenStreetMap contributors) from the newest Protomaps planet build
      </div>
      {sheet.planned && (
        <div class="small">
          {sheet.planned.plan.tiles.length} tiles · <strong>{mb(bytes)}</strong> to download (build {sheet.planned.build})
        </div>
      )}
      {sheet.planned && bytes > MAX_DOWNLOAD_BYTES && <div class="warning small">Too large to download in one go ({mb(bytes)}). Zoom the preview in to the area you need, or pick less detail.</div>}
      {sheet.planned && bytes > LARGE_DOWNLOAD_BYTES && bytes <= MAX_DOWNLOAD_BYTES && (
        <div class="warning small">This is a large download ({mb(bytes)}). For one city, zoom the preview in until the city fills it, or pick less detail.</div>
      )}
      {taken && <div class="warning small">A region named "{safeRegionName(sheet.name)}" already exists. Downloading replaces it.</div>}
      <div class="sheet-row">
        {!sheet.planned ? (
          <button disabled={busy.value} onClick={() => void checkRegionSize()}>
            Check size
          </button>
        ) : (
          <button class={taken || bytes > LARGE_DOWNLOAD_BYTES ? "danger" : "primary"} disabled={busy.value || bytes > MAX_DOWNLOAD_BYTES} onClick={() => void startRegionDownload()}>
            {taken ? "Replace existing region" : "Download"}
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
export function ImportSheetView(props: { pickFile: () => void }): JSX.Element | null {
  const [seconds, setSeconds] = useState(5);
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
          <button class="small-button" disabled={busy.value || !hasMap} title="A route layer that follows the map and draws on from the current time" onClick={() => void drawImportedLine(line, seconds, false)}>
            Draw
          </button>
          <button class="small-button" disabled={busy.value || !hasMap} title="The route, plus an arrow that travels along it and turns with it. Parent your own artwork to the Traveller layer." onClick={() => void drawImportedLine(line, seconds, true)}>
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
        {data.places.length > 0 && (
          <button class="small-button" disabled={busy.value || !hasMap} onClick={() => void pinImportedPlaces(data.places)}>
            Pin {data.places.length} {data.places.length === 1 ? "place" : "places"}
          </button>
        )}
        <span class="spacer" />
        <button class="small-button" disabled={busy.value} onClick={props.pickFile}>
          Another file…
        </button>
        <button class="small-button" onClick={() => (importSheetOpen.value = false)}>
          Close
        </button>
      </div>
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
      </div>
      <div class="muted small">Click a country or province on the map to highlight it, click it again to remove it (or use the highlight button next to a search result). Districts or any shape of your own: import a KML or GeoJSON file and press Highlight next to the area. Render to get the highlights as one layer above the basemap: fade it, colour it or add a glow in After Effects.</div>
      {list.map((h) => (
        <div key={h.code} class="sheet-row highlight-row">
          <input type="color" value={h.color} title="Colour" onChange={(e) => void setHighlights(list.map((x) => (x.code === h.code ? { ...x, color: (e.target as HTMLInputElement).value } : x)))} />
          <span class="grow">{h.name}</span>
          <button class="small-button" title="Remove this highlight" onClick={() => void setHighlights(list.filter((x) => x.code !== h.code))}>
            ✕
          </button>
        </div>
      ))}
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
      <div class="sheet-row">
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
    if (tool.value === "none" || tool.value === "highlight") return null;
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
      <div class="sheet-row">
        <button class="primary" disabled={busy.value} onClick={() => void confirmToolSheet()}>
          Add {sheet.kind}
        </button>
        <button onClick={() => (toolSheet.value = null)}>Cancel</button>
      </div>
    </div>
  );
}

export function LabelsSheetView(): JSX.Element | null {
  if (!labelsSheetOpen.value) return null;
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
