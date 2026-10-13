// The panel: header, tool row, search, the preview with its strip, and the Shots and Render tabs.

import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { initPreview, resetNorth, setCompZoom, setPreviewOverlay, setPreviewReadable, zoomPreviewBy } from "../preview.ts";
import { play, playing, startShots, stop as stopPlayback } from "../shots/shotsStore.ts";
import {
  addCamera,
  animateBorders,
  armTool,
  basemap,
  busy,
  exactLook,
  flightSeconds,
  flyHere,
  hostInfo,
  importPicked,
  importSheetOpen,
  imported,
  jobs,
  keepOut,
  dataSheetOpen,
  dataTable,
  osmData,
  streetDetailOn,
  ownImagery,
  osmSheetOpen,
  keyframeView,
  liveLink,
  log,
  logLines,
  logOpen,
  matchAe,
  exportGeoJson,
  openRegionSheet,
  dismissUpdate,
  hereText,
  openUpdate,
  previewClicked,
  previewHovered,
  previewMoved,
  progress,
  projection,
  changeProjection,
  renderBasemap,
  screen,
  selected,
  startStore,
  tab,
  themeId,
  tool,
  type Tool,
  updateAvailable,
  view, importDrawing } from "../store.ts";
import { themeById } from "../../core/style/themes.ts";
import { hasImagery } from "../imagery/packs.ts";
import { installedWorld } from "../osmTiles.ts";
import { Icon, IconButton, type IconName } from "./icons.tsx";
import { ToolMenu } from "./ToolMenu.tsx";
import { openUrl } from "../cep.ts";
import { RenderTab } from "./RenderTab.tsx";
import { BasemapPicker, MapsScreen, NewMapScreen, SettingsScreen } from "./Screens.tsx";
import { SearchBar } from "./SearchBar.tsx";
import { AttachSheetView, DataSheetView, FeatureSheetView, HighlightSheetView, ImportSheetView, LabelsSheetView, LookSheetView, OsmSheetView, RegionSheetView, SatelliteSheetView, ToolSheetView, labelsSheetOpen, lookSheetOpen } from "./Sheets.tsx";
import { IMPORT_ACCEPT } from "../data/importFile.ts";
import { ShotsTab } from "./ShotsTab.tsx";

function Header(): JSX.Element {
  const entry = selected.value;
  return (
    <div class="bar header">
      <IconButton icon="list" title="Maps in this project, new map, sample" id="maps" onClick={() => (screen.value = "maps")} />
      <span class="bar-title" title={entry ? `${entry.mapCompName} in ${entry.sceneCompName}` : undefined}>
        {entry ? entry.mapCompName : "LazyMapLayers"}
      </span>
      {entry && <IconButton icon="sliders" title="Map settings: name, basemap, globe" id="settings" onClick={() => (screen.value = "settings")} />}
      <span class="spacer" />
      {entry ? (
        <>
          <button data-id="render-preview" onClick={() => renderBasemap("preview")} title="Half resolution without supersampling: fast. Becomes an After Effects proxy once a final render exists.">
            Preview
          </button>
          <button class="primary" data-id="render" onClick={() => renderBasemap("final")} title="Full resolution with the render settings (Render tab). Only frames that changed are drawn again.">
            <Icon name="check" size={12} /> Render
          </button>
        </>
      ) : (
        <button class="primary" data-id="new-map-header" disabled={busy.value} onClick={() => (screen.value = "newMap")}>
          <Icon name="plus" size={12} /> New map
        </button>
      )}
    </div>
  );
}

const PLACE_TOOLS: Tool[] = ["pin", "pin3d", "callout", "route", "highlight", "attach"];
const TOOL_ICONS: Record<Tool, IconName> = { none: "pin", pin: "pin", pin3d: "pin3d", callout: "callout", route: "route", highlight: "highlight", attach: "attach" };

/** The tool row (D106): two menus for what goes on the map and what comes in or out, then the look. */
function ToolRow(): JSX.Element {
  const filePicker = useRef<HTMLInputElement>(null);
  const entry = selected.value;
  const off = busy.value || !entry;
  const armed = tool.value;
  return (
    <div class="bar tools">
      <ToolMenu
        id="menu-add"
        icon={TOOL_ICONS[armed]}
        label="Add"
        title="Add to the map: pins, callouts, routes, highlighted countries, your own layers, labels, borders, a 3D camera"
        armed={PLACE_TOOLS.includes(armed) || labelsSheetOpen.value}
        items={[
          { id: "tool-pin", icon: "pin", label: "Pin", hint: "Alt+click", title: "Pin: click, then click a place on the map (or Alt+click the map any time)", disabled: off, on: armed === "pin", onClick: () => armTool("pin") },
          { id: "tool-pin3d", icon: "pin3d", label: "3D pin", hint: "Alt+Shift+click", title: "3D pin that lies on the ground under the matched 3D camera (or Alt+Shift+click the map)", disabled: off, on: armed === "pin3d", onClick: () => armTool("pin3d") },
          { id: "tool-callout", icon: "callout", label: "Callout", title: "Callout: a leader line with a title box next to a place", disabled: off, on: armed === "callout", onClick: () => armTool("callout") },
          { id: "tool-route", icon: "route", label: "Route", title: "Route: a great-circle line between two places that draws on", disabled: off, on: armed === "route", onClick: () => armTool("route") },
          {
            id: "tool-highlight",
            icon: "highlight",
            label: "Highlight countries",
            title: "Highlight countries: click, then click countries on the map. They render as their own layer above the basemap. With a year under Historical borders, a click picks what lay there then, and Shift+click every land of its ruling power.",
            disabled: busy.value,
            on: armed === "highlight",
            onClick: () => armTool("highlight")
          },
          {
            id: "tool-attach",
            icon: "attach",
            label: "Attach your layers",
            title: "Attach your own layers to a place: select them in After Effects, then click the place on the map. They stay on it while the camera moves.",
            disabled: busy.value,
            on: armed === "attach",
            onClick: () => armTool("attach")
          },
          { id: "tool-labels", icon: "text", label: "Auto labels", title: "Auto labels: country and city names over the whole timeline", disabled: off, on: labelsSheetOpen.value, divider: true, onClick: () => (labelsSheetOpen.value = !labelsSheetOpen.value) },
          { id: "tool-borders", icon: "borders", label: "Animate borders", title: "Animate borders: country borders draw on over 4 seconds from the current time", disabled: off, onClick: () => void animateBorders() },
          {
            id: "tool-camera",
            icon: "camera",
            label: "3D camera",
            title: entry?.hasCamera ? "This map has its matched 3D camera" : "3D camera: an After Effects camera that matches the map, so 3D layers sit on the ground",
            disabled: off || !!entry?.hasCamera,
            on: !!entry?.hasCamera,
            onClick: () => void addCamera()
          }
        ]}
      />
      <ToolMenu
        id="menu-data"
        icon="import"
        label="Data"
        title="Bring data in and take it out: files, numbers, OpenStreetMap, your own drawing, offline areas, GeoJSON"
        armed={importSheetOpen.value || dataSheetOpen.value || osmSheetOpen.value}
        items={[
          {
            id: "tool-import",
            icon: "import",
            label: imported.value ? "Imported file" : "Import a file…",
            title: "Import a GPX, TCX, KML, KMZ, GeoJSON, CSV or zipped shapefile: draw its lines as routes, run an arrow or the camera along them, pin its places, highlight its areas",
            disabled: busy.value,
            on: importSheetOpen.value,
            onClick: () => {
              if (imported.value) importSheetOpen.value = !importSheetOpen.value;
              else filePicker.current?.click();
            }
          },
          {
            id: "tool-data",
            icon: "chart",
            label: "Numbers on the map",
            title: "Numbers on the map: import a CSV with a country column and a column of numbers, and every country is filled with the colour of its step",
            disabled: busy.value,
            on: dataSheetOpen.value,
            onClick: () => {
              if (dataTable.value) dataSheetOpen.value = !dataSheetOpen.value;
              else filePicker.current?.click();
            }
          },
          {
            id: "tool-osm",
            icon: "osm",
            label: "Find on OpenStreetMap",
            title: "Find features on OpenStreetMap: rivers, lakes, parks, islands, airports, district boundaries, buildings - anything named, in the area the preview shows",
            disabled: busy.value,
            on: osmSheetOpen.value,
            onClick: () => (osmSheetOpen.value = !osmSheetOpen.value)
          },
          {
            id: "tool-drawing",
            icon: "pen",
            label: "Your own drawing",
            title: "Your own drawing: draw over the map with the Pen tool (a shape layer or masks), select it, then click. Open paths become routes and closed ones areas that follow the map.",
            disabled: off,
            onClick: () => void importDrawing()
          },
          { id: "download-area", icon: "download", label: "Download this area", title: "Download OpenStreetMap detail for the area in the preview (once, then it works offline)", disabled: busy.value, divider: true, onClick: openRegionSheet },
          { id: "export-geojson", icon: "copy", label: "Save as GeoJSON", title: "Save what is on this map (pins, routes, outlines, callouts and highlighted areas) as a GeoJSON file", disabled: busy.value || !selected.value, onClick: () => void exportGeoJson() }
        ]}
      />
      <input
        ref={filePicker}
        type="file"
        accept={IMPORT_ACCEPT}
        style={{ display: "none" }}
        onChange={(e) => {
          const input = e.target as HTMLInputElement;
          const file = input.files?.[0];
          input.value = "";
          if (file) void importPicked(file);
        }}
      />
      <span class="spacer" />
      <button
        class={`menu-button ${lookSheetOpen.value ? "active" : ""}`}
        data-id="look"
        title="Look: ready looks or your own colours, sky, shaded relief, imagery, terrain, historical borders, scale bar, north arrow and inset map"
        onClick={() => (lookSheetOpen.value = !lookSheetOpen.value)}
      >
        <Icon name="palette" size={15} />
        <span>Look</span>
      </button>
      <BasemapPicker />
      <IconButton
        icon="globe"
        id="globe"
        title="Globe: a planet at low zoom that becomes the flat map by zoom 8"
        disabled={busy.value}
        active={projection.value === "globe"}
        onClick={() => void changeProjection(projection.value === "globe" ? "mercator" : "globe")}
      />
    </div>
  );
}

function Strip(): JSX.Element {
  const entry = selected.value;
  const off = busy.value || !entry;
  const v = view.value;
  return (
    <div class="bar strip">
      <IconButton icon="key" id="keyframe" filled title="Keyframe the view in the preview at the current time" disabled={off} onClick={() => void keyframeView()} />
      <IconButton icon="link" id="live-link" title="Live link: while on, moving the preview moves the map at the current time" disabled={!entry} active={liveLink.value} onClick={() => (liveLink.value = !liveLink.value)} />
      <IconButton icon="plane" id="fly-here" title="Fly here: key a smooth flight from the camera at the current time to the view in the preview" disabled={off} onClick={() => void flyHere()} />
      <select class="compact" value={flightSeconds.value} disabled={off} onChange={(e) => (flightSeconds.value = Number((e.target as HTMLSelectElement).value))} title="Duration of Fly here">
        {[2, 3, 4, 6, 8, 10, 12, 15, 20].map((n) => (
          <option key={n} value={n}>
            {n} s
          </option>
        ))}
      </select>
      <span class="divider" />
      <IconButton icon="minus" title="Zoom out" onClick={() => zoomPreviewBy(-0.5)} />
      <input class="zoom-slider" type="range" min={0} max={20} step={0.01} value={v ? Math.max(0, Math.min(20, v.zoom)) : 0} onInput={(e) => setCompZoom(Number((e.target as HTMLInputElement).value))} title="Zoom" />
      <IconButton icon="plus" title="Zoom in" onClick={() => zoomPreviewBy(0.5)} />
      <IconButton icon="compass" title="North up (Alt+click also looks straight down)" onClick={(e) => resetNorth(e.altKey)} />
    </div>
  );
}

const MANUAL_URL = "https://raisulsohan.com/en/portfolio/lazymaplayers/documentation/manual/";

function StatusLine(): JSX.Element {
  const lines = logLines.value;
  const last = lines[lines.length - 1];
  const p = progress.value;
  return (
    <>
      {logOpen.value && (
        <div class="log" data-id="log">
          {lines.map((line, i) => (
            <div key={i} class={line.kind ?? ""}>
              {line.text}
            </div>
          ))}
        </div>
      )}
      <div class={`status ${last?.kind ?? ""}`} data-id="status" onClick={() => (logOpen.value = !logOpen.value)} title="Click to show or hide the log">
        {p ? (
          <div class="progress">
            <div class="bar-fill" style={{ width: `${Math.round((100 * p.done) / Math.max(1, p.total))}%` }} />
            <span>
              {p.label} {p.total <= 1 ? "…" : p.total > 1000 ? `${Math.round((100 * p.done) / p.total)}%` : `${p.done} of ${p.total}`}
            </span>
          </div>
        ) : (
          <span class="status-text">{busy.value ? "Working…" : last?.text ?? hostInfo.value}</span>
        )}
        <a
          class="made-by"
          data-id="made-by"
          href={MANUAL_URL}
          title="The LazyMapLayers manual on raisulsohan.com (opens in your browser)"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            openUrl(MANUAL_URL);
          }}
        >
          Created by <span class="made-by-name">Raisul Sohan</span>
        </a>
        {p?.cancel && (
          <button
            class="small-button"
            data-id="cancel-progress"
            onClick={(e) => {
              e.stopPropagation();
              p.cancel?.();
            }}
          >
            Cancel
          </button>
        )}
        <Icon name={logOpen.value ? "chevronDown" : "chevronRight"} size={11} />
      </div>
    </>
  );
}

export function App(): JSX.Element {
  const wrapNode = useRef<HTMLDivElement>(null);
  const boxNode = useRef<HTMLDivElement>(null);
  const zoneNode = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPreviewOverlay(zoneNode.current);
    return () => setPreviewOverlay(null);
  }, []);

  useEffect(() => {
    if (!wrapNode.current || !boxNode.current) return;
    const stopShots = startShots();
    const removePreview = initPreview(wrapNode.current, boxNode.current, {
      onView: (v) => (view.value = v),
      onMoveEnd: (v, byUser) => {
        if (!playing.value) previewMoved(v, byUser);
      },
      onClick: previewClicked,
      onHover: previewHovered,
      onError: (message) => log(`map error: ${message}`, "fail")
    });
    const stopStore = startStore();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        tool.value = "none";
        stopPlayback();
      } else if (event.key === " " && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLSelectElement) && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        play();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      stopStore();
      stopShots();
      removePreview();
    };
  }, []);

  const v = view.value;
  const running = jobs.value.filter((j) => j.status === "running" || j.status === "queued").length;
  const current = screen.value;

  return (
    <>
      {/* The main screen stays mounted (the preview map lives in it); other screens cover it. */}
      <div class="main" style={{ display: current === "main" ? "flex" : "none" }}>
        {updateAvailable.value && (
          <div class="update-banner" data-id="update-banner">
            <span>LazyMapLayers {updateAvailable.value.version} is out</span>
            <button class="small-button" data-id="update-get" onClick={openUpdate} title="Opens the release page in your browser">
              Get it
            </button>
            <button class="small-button" data-id="update-later" onClick={dismissUpdate} title="Not for this version; the next one will be mentioned">
              Later
            </button>
          </div>
        )}
        <Header />
        <ToolRow />
        <SearchBar />
        {/* Open sheets scroll together, so a tall one never pushes the preview and the tabs out of a short panel. */}
        <div class="sheets" data-id="sheets">
          <RegionSheetView />
          <ToolSheetView />
          <DataSheetView />
          <OsmSheetView />
          <ImportSheetView pickFile={() => document.querySelector<HTMLInputElement>('input[type="file"]')?.click()} />
          <SatelliteSheetView />
          <FeatureSheetView />
          <HighlightSheetView />
          <AttachSheetView />
          <LabelsSheetView />
          <LookSheetView />
        </div>
        <div class={`map-wrap ${tool.value !== "none" ? "armed" : ""}`} ref={wrapNode}>
          <div id="map" ref={boxNode} />
          <div class="zones" ref={zoneNode}>
            {keepOut.value.map((zone) => (
              <div
                key={zone.id}
                class="zone"
                style={{ left: `${zone.x * 100}%`, top: `${zone.y * 100}%`, width: `${zone.width * 100}%`, height: `${zone.height * 100}%` }}
              >
                <span>{zone.name}</span>
              </div>
            ))}
          </div>
          <div class="map-overlay top-left">
            <IconButton icon="target" id="match-ae" title="Show the camera of the current time in After Effects" disabled={busy.value || !selected.value} onClick={() => void matchAe()} />
            <IconButton
              icon="frame"
              id="exact-look"
              title="Exact look: show names and lines at the size they render (small in a small panel). Off: enlarged so they stay readable; the framing is exact either way."
              active={exactLook.value}
              onClick={() => {
                exactLook.value = !exactLook.value;
                setPreviewReadable(!exactLook.value);
              }}
            />
          </div>
          <div class="credit" title="Where the map data comes from. A render that draws OpenStreetMap data adds a credit layer to your scene.">
            {[basemap.value.kind === "world" && !osmData.value && !streetDetailOn.value && !installedWorld() ? null : "© OpenStreetMap contributors", themeById(themeId.value).satellite && hasImagery("blue-marble") ? "NASA Blue Marble" : null, ownImagery.value?.attribution || null, "Natural Earth"].filter(Boolean).join(" · ")}
          </div>
          {v && (
            <div class="view-readout" title="Latitude, longitude · zoom · bearing · pitch of the frame">
              {v.center.lat.toFixed(4)}, {v.center.lng.toFixed(4)} · z {v.zoom.toFixed(2)} · b {v.bearing.toFixed(1)}° · p {v.pitch.toFixed(1)}°
            </div>
          )}
          {hereText.value && (
            <div class="here-readout" data-id="here-readout" title="What is under the pointer: the nearest place, its district and province, and the country">
              {hereText.value}
            </div>
          )}
        </div>
        <Strip />
        <div class="tabs">
          <button class={`tab ${tab.value === "shots" ? "on" : ""}`} data-id="tab-shots" onClick={() => (tab.value = "shots")}>
            Shots
          </button>
          <button class={`tab ${tab.value === "render" ? "on" : ""}`} data-id="tab-render" onClick={() => (tab.value = "render")}>
            Render{running ? ` (${running})` : ""}
          </button>
        </div>
        <div class="tab-body">{tab.value === "shots" ? <ShotsTab /> : <RenderTab />}</div>
        <StatusLine />
      </div>
      {current === "maps" && <MapsScreen />}
      {current === "newMap" && <NewMapScreen />}
      {current === "settings" && <SettingsScreen />}
    </>
  );
}
