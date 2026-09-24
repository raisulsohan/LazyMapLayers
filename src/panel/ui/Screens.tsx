// Full-panel screens behind the header's list and gear buttons: the maps of the project, a new map,
// and the selected map's settings.

import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { callHost, isInCep } from "../cep.ts";
import { compSize } from "../preview.ts";
import { allRegions, basemap, buildSample, busy, changeBasemap, changeProjection, createMap, fail, maps, mb, openRegionSheet, projection, regions, renameMap, screen, selectMap, selected, selectedId, sourceKey, suggestName } from "../store.ts";
import { buildNumbersSample, hostInfo, reportProblem, scriptingOn, setScriptingOn, setUpdatesOn, updatesOn } from "../store.ts";
import { earthStudioPins, importEarthStudioFile } from "../store.ts";
import { openUrl } from "../cep.ts";
import { RELEASES_URL } from "../updates.ts";
import { formatTime } from "../shots/shotsStore.ts";
import { Icon, IconButton } from "./icons.tsx";

function ScreenHeader(props: { title: string }): JSX.Element {
  return (
    <div class="bar header">
      <IconButton icon="chevronLeft" title="Back to the map" id="back" onClick={() => (screen.value = "main")} />
      <span class="bar-title">{props.title}</span>
    </div>
  );
}

export function BasemapPicker(): JSX.Element {
  return (
    <select data-id="basemap" value={sourceKey(basemap.value)} disabled={busy.value} onChange={(e) => void changeBasemap((e.target as HTMLSelectElement).value)} title="What the map is drawn from">
      <option value="world">World (offline)</option>
      {regions.value.map((r) => (
        <option key={r.name} value={`region:${r.name}`}>
          {r.name} ({mb(r.sizeBytes)})
        </option>
      ))}
      {regions.value.length > 1 && <option value={sourceKey(allRegions(regions.value))}>World + all {regions.value.length} regions</option>}
    </select>
  );
}

export function MapsScreen(): JSX.Element {
  return (
    <div class="screen">
      <ScreenHeader title="Maps in this project" />
      <div class="screen-body">
        {maps.value.length === 0 && <div class="empty muted">No maps yet. A map is a comp that draws the basemap, with camera controls on its layer.</div>}
        {maps.value.map((m) => (
          <div key={m.mapId} class={`map-card ${m.mapId === selectedId.value ? "selected" : ""}`} data-id="map-card" onClick={() => (selectMap(m.mapId), (screen.value = "main"))}>
            <Icon name={m.projection === "globe" ? "globe" : "image"} size={18} />
            <div class="shot-text">
              <div class="shot-name">{m.mapCompName}</div>
              <div class="muted small">
                {m.width}×{m.height} · {Math.round(m.frameRate * 100) / 100} fps · {formatTime(m.duration)} · in {m.sceneCompName}
              </div>
            </div>
            {m.hasShots && <span class="tag">Shots</span>}
            {m.hasCamera && <span class="tag">3D camera</span>}
          </div>
        ))}
        <button class="primary wide" data-id="new-map" disabled={busy.value} onClick={() => (screen.value = "newMap")}>
          <Icon name="plus" size={12} /> New map
        </button>
        <div class="section-title">Sample</div>
        <button class="wide" disabled={busy.value} onClick={() => void buildSample()} title="A globe-to-Paris-to-Tokyo flight with borders, labels, pins, callouts and a route">
          <Icon name="plane" size={12} /> Build the world flight sample
        </button>
        <button class="wide" data-id="sample-numbers" disabled={busy.value} onClick={() => void buildNumbersSample()} title="A world map of every country by its population, from the bundled data: the colours, spikes for the numbers and a legend, ready to render">
          <Icon name="download" size={12} /> Build the numbers sample
        </button>
        <div class="section-title">About</div>
        <div class="muted small" data-id="about-versions">{hostInfo.value || "LazyMapLayers"}</div>
        <div class="field-row">
          <button class="small-button" data-id="about-releases" onClick={() => openUrl(RELEASES_URL)} title="Every release, with what changed, on GitHub">
            Releases
          </button>
          <button class="small-button" data-id="about-website" onClick={() => openUrl("https://raisulsohan.com")} title="Raisul Sohan's site">
            raisulsohan.com
          </button>
          <button class="small-button" data-id="about-report" disabled={busy.value} onClick={() => void reportProblem()} title="Writes a report with the panel's last messages to your LazyMapLayers folder and opens a new issue on GitHub for you to paste it into. Nothing is sent by itself.">
            Report a problem
          </button>
        </div>
        <label class="check" title="One request to GitHub's release list a day, sending nothing but the request. Off, the panel never goes online by itself.">
          <input type="checkbox" data-id="about-updates" checked={updatesOn.value} onChange={(e) => setUpdatesOn((e.target as HTMLInputElement).checked)} />
          Look for new versions once a day
        </label>
        <label class="check" title="Lets a script on this computer drive the panel: it leaves a request in the api folder inside your LazyMapLayers folder and the panel answers beside it. Only the calls listed in docs/SCRIPTING.md can be asked for. Off by default.">
          <input type="checkbox" data-id="about-scripting" checked={scriptingOn.value} onChange={(e) => setScriptingOn((e.target as HTMLInputElement).checked)} />
          Let scripts on this computer drive the panel
        </label>
      </div>
    </div>
  );
}

type ActiveComp = { name: string; width: number; height: number; frameRate: number; duration: number } | null;

const SIZES: [number, number][] = [
  [1920, 1080],
  [3840, 2160],
  [1080, 1920],
  [1080, 1080]
];

export function NewMapScreen(): JSX.Element {
  const [active, setActive] = useState<ActiveComp>(null);
  const [intoActive, setIntoActive] = useState(true);
  const [name, setName] = useState(() => {
    const place = suggestName();
    return place ? `${place} Map` : "Map";
  });
  const [width, setWidth] = useState(compSize().width);
  const [height, setHeight] = useState(compSize().height);
  const [frameRate, setFrameRate] = useState(25);
  const [duration, setDuration] = useState(30);

  useEffect(() => {
    if (!isInCep()) return;
    callHost<ActiveComp>("activeComp")
      .then((comp) => {
        setActive(comp);
        if (comp) {
          setWidth(comp.width);
          setHeight(comp.height);
          setFrameRate(comp.frameRate);
          setDuration(comp.duration);
        }
      })
      .catch((error) => fail("reading the active comp", error));
  }, []);

  const useActive = !!active && intoActive;
  const numberInput = (value: number, set: (n: number) => void, min: number, step = 1) => (
    <input
      type="number"
      min={min}
      step={step}
      disabled={useActive}
      value={Math.round(value * 1000) / 1000}
      onChange={(e) => {
        const n = Number((e.target as HTMLInputElement).value);
        if (Number.isFinite(n) && n >= min) set(n);
      }}
    />
  );

  return (
    <div class="screen">
      <ScreenHeader title="New map" />
      <div class="screen-body">
        <div class="muted small">The map starts on the view in the preview. Go back to frame it first, or search a place.</div>
        <label class="form-field">
          <span>Name</span>
          <input data-id="new-map-name" type="text" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </label>
        {active && (
          <label class="check">
            <input type="checkbox" checked={intoActive} onChange={(e) => setIntoActive((e.target as HTMLInputElement).checked)} />
            Put it into the open comp "{active.name}" (same size, frame rate and duration)
          </label>
        )}
        <div class="form-field">
          <span>Size</span>
          <div class="field-row">
            {numberInput(width, setWidth, 16)}
            <span class="muted">×</span>
            {numberInput(height, setHeight, 16)}
            <select
              disabled={useActive}
              value=""
              onChange={(e) => {
                const [w, h] = (e.target as HTMLSelectElement).value.split("x").map(Number);
                if (w && h) {
                  setWidth(w);
                  setHeight(h);
                }
              }}
            >
              <option value="">Presets</option>
              {SIZES.map(([w, h]) => (
                <option key={`${w}x${h}`} value={`${w}x${h}`}>
                  {w} × {h}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div class="field-row">
          <label class="form-field grow">
            <span>Frame rate</span>
            {numberInput(frameRate, setFrameRate, 1, 0.001)}
          </label>
          <label class="form-field grow">
            <span>Duration (s)</span>
            {numberInput(duration, setDuration, 1)}
          </label>
        </div>
        <label class="form-field">
          <span>Basemap</span>
          <BasemapPicker />
        </label>
        <label class="check" title="A planet at low zoom that becomes the flat map by zoom 8">
          <input type="checkbox" checked={projection.value === "globe"} onChange={(e) => void changeProjection((e.target as HTMLInputElement).checked ? "globe" : "mercator")} />
          Globe
        </label>
        <button
          class="primary wide"
          data-id="create-map"
          disabled={busy.value || !name.trim()}
          onClick={() => void createMap({ name: name.trim(), width, height, frameRate, duration, newScene: !useActive })}
        >
          Create map
        </button>
        <div class="section-title">From Google Earth Studio</div>
        <div class="muted small">
          Render your animation in Earth Studio, then export its camera there with <b>File &gt; Export &gt; 3D Tracking Data</b> as <b>JSON</b>. The panel makes a scene the size and length of that render and keys this map's camera to
          theirs, so names, pins, routes and outlines sit on your footage. Import the footage yourself and drop it under the map layer.
        </div>
        <label class="check" title="A pin on each track point you set in Earth Studio, with its name">
          <input type="checkbox" data-id="earth-studio-pins" checked={earthStudioPins.value} onChange={(e) => (earthStudioPins.value = (e.target as HTMLInputElement).checked)} />
          Pin the track points
        </label>
        <button class="wide" data-id="earth-studio-import" disabled={busy.value} onClick={() => void importEarthStudioFile()}>
          Open a tracking file…
        </button>
      </div>
    </div>
  );
}

export function SettingsScreen(): JSX.Element {
  const entry = selected.value;
  const [name, setName] = useState(entry?.mapCompName ?? "");
  useEffect(() => setName(entry?.mapCompName ?? ""), [entry?.mapCompName]);
  if (!entry) {
    return (
      <div class="screen">
        <ScreenHeader title="Map settings" />
        <div class="screen-body">
          <div class="empty muted">No map is selected.</div>
        </div>
      </div>
    );
  }
  return (
    <div class="screen">
      <ScreenHeader title="Map settings" />
      <div class="screen-body">
        <label class="form-field">
          <span>Name</span>
          <div class="field-row">
            <input type="text" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
            <button disabled={busy.value || !name.trim() || name.trim() === entry.mapCompName} onClick={() => void renameMap(name)} title="Renaming is safe: pins, labels and routes are linked through effects, not names">
              Rename
            </button>
          </div>
        </label>
        <div class="muted small">
          {entry.width}×{entry.height} · {Math.round(entry.frameRate * 100) / 100} fps · {formatTime(entry.duration)} · in {entry.sceneCompName}
        </div>
        <div class="section-title">Basemap</div>
        <div class="field-row">
          <BasemapPicker />
          <button
            disabled={busy.value}
            onClick={() => {
              screen.value = "main";
              openRegionSheet();
            }}
            title="Download OpenStreetMap detail for the area in the preview, once, for offline use"
          >
            <Icon name="download" size={12} /> Download this area
          </button>
        </div>
        <label class="check" title="A planet at low zoom that becomes the flat map by zoom 8">
          <input type="checkbox" checked={projection.value === "globe"} disabled={busy.value} onChange={(e) => void changeProjection((e.target as HTMLInputElement).checked ? "globe" : "mercator")} />
          Globe
        </label>
      </div>
    </div>
  );
}
