// What the scripting API can ask for. Every call here is one a person can do in the panel: the table
// is the whole of it, so a request file can never reach anything else.

import { flagArg, listArg, numberArg, textArg } from "../core/data/apiRequest.ts";
import type { ApiHandlers } from "./scripting.ts";
import { compView, showCompView } from "./preview.ts";
import * as store from "./store.ts";

/** The version of the request format, so a script can tell what it is talking to. */
export const API_VERSION = 1;

/**
 * Runs one panel action and reports what the panel said about it. The panel does one thing at a
 * time, so a call that arrives while it is busy is refused rather than queued behind the user.
 */
async function act(what: string, task: () => Promise<void> | void): Promise<{ log: string[] }> {
  if (store.busy.value) throw new Error(`the panel is busy; ${what} was not done`);
  const before = store.logLines.value.length;
  await task();
  const lines = store.logLines.value.slice(before);
  const failed = lines.find((line) => line.kind === "fail");
  if (failed) throw new Error(failed.text);
  return { log: lines.map((line) => line.text) };
}

function currentMapId(args: Record<string, unknown>): string {
  const wanted = textArg(args, "mapId");
  if (wanted) return wanted;
  if (!store.selectedId.value) throw new Error("no map is selected; call select first, or make one with newMap");
  return store.selectedId.value;
}

const corner = (args: Record<string, unknown>, fallback: string) => {
  const wanted = textArg(args, "corner", fallback);
  const known = ["bottomLeft", "bottomRight", "topLeft", "topRight"];
  if (!known.includes(wanted)) throw new Error(`corner is one of ${known.join(", ")}`);
  return wanted as "bottomLeft" | "bottomRight" | "topLeft" | "topRight";
};

export function apiHandlers(): ApiHandlers {
  return {
    /** What is running, and what this panel can be asked for. */
    version: () => ({ version: store.panelVersion.value, api: API_VERSION, calls: Object.keys(apiHandlers()).sort() }),

    /** The maps in the project. */
    maps: async () => {
      const list = await store.readMaps();
      return list.map((entry) => ({ mapId: entry.mapId, name: entry.mapCompName, scene: entry.sceneCompName, width: entry.width, height: entry.height, frameRate: entry.frameRate, selected: entry.mapId === store.selectedId.value }));
    },

    /** Works on this map from now on. */
    select: async (args) => {
      const mapId = textArg(args, "mapId");
      if (!mapId) throw new Error("select needs a mapId (maps lists them)");
      const list = await store.readMaps();
      if (!list.some((entry) => entry.mapId === mapId)) throw new Error(`no map with the id ${mapId}`);
      store.selectMap(mapId);
      return { mapId };
    },

    /** Where the selected map is looking. */
    view: () => {
      const view = compView();
      if (!view) throw new Error("no map is selected");
      return { lat: view.center.lat, lng: view.center.lng, zoom: view.zoom, bearing: view.bearing, pitch: view.pitch };
    },

    /** Moves the map, and keyframes the camera there when asked to. */
    setView: async (args) => {
      const now = compView();
      if (!now) throw new Error("no map is selected");
      const next = {
        center: { lat: numberArg(args, "lat", now.center.lat, -85, 85), lng: numberArg(args, "lng", now.center.lng, -180, 180) },
        zoom: numberArg(args, "zoom", now.zoom, 0, 22),
        bearing: numberArg(args, "bearing", now.bearing, -360, 360),
        pitch: numberArg(args, "pitch", now.pitch, 0, 85)
      };
      showCompView(next, flagArg(args, "glide", false));
      if (flagArg(args, "keyframe", false)) await act("setView", () => store.keyframeView());
      return next;
    },

    /** A new map, at the view the panel is showing. */
    newMap: (args) =>
      act("newMap", () =>
        store.createMap({
          name: textArg(args, "name", "Map"),
          width: args.width === undefined ? undefined : numberArg(args, "width", 1920, 16, 8192),
          height: args.height === undefined ? undefined : numberArg(args, "height", 1080, 16, 8192),
          frameRate: args.frameRate === undefined ? undefined : numberArg(args, "frameRate", 25, 1, 120),
          duration: args.duration === undefined ? undefined : numberArg(args, "duration", 10, 0.1, 3600),
          newScene: flagArg(args, "newScene", false)
        })
      ),

    /** A pin on a place. */
    addPin: (args) => {
      currentMapId(args);
      const lat = numberArg(args, "lat", NaN, -90, 90);
      const lng = numberArg(args, "lng", NaN, -180, 180);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("addPin needs lat and lng");
      return act("addPin", () => store.addPinAt({ lat, lng }, flagArg(args, "threeD", false)));
    },

    /** The names of the places in view, placed over the whole timeline. */
    labels: (args) => {
      currentMapId(args);
      return act("labels", () => store.runAutoLabels());
    },

    removeLabels: (args) => {
      currentMapId(args);
      return act("removeLabels", () => store.removeLabels());
    },

    /** Highlights countries by their code (IND, FRA, BRA). */
    highlight: (args) => {
      const codes = listArg(args, "codes", 60).map((code) => code.toUpperCase());
      if (!codes.length) throw new Error("highlight needs codes, like {\"codes\": [\"IND\", \"FRA\"]}");
      return act("highlight", async () => {
        for (const code of codes) {
          if (!store.highlights.value.some((highlight) => highlight.code === code)) store.toggleCountryHighlight(code, code);
        }
      });
    },

    clearHighlights: () => act("clearHighlights", () => store.setHighlights([], {})),

    /** One of the bundled looks, by its id (midnight, daylight, ...). */
    look: (args) => {
      const theme = textArg(args, "theme");
      if (!theme) throw new Error("look needs a theme id; version lists none, the panel's Look sheet shows them");
      return act("look", () => store.changeTheme(theme));
    },

    /** Renders the selected map: "preview" is quick, "final" is every frame at full quality. */
    render: (args) => {
      currentMapId(args);
      const quality = textArg(args, "quality", "final");
      if (quality !== "preview" && quality !== "final") throw new Error('quality is "preview" or "final"');
      store.renderBasemap(quality);
      return { quality, note: "the render runs in the background; watch the panel's Render tab" };
    },

    /** Reads a table of numbers from a file and keeps reading it as it changes. */
    csv: (args) => {
      const file = textArg(args, "path", "");
      if (!file) throw new Error("csv needs the path of a file");
      return act("csv", () => store.watchTableFile(file));
    },

    /** Colours the map by the table that is open. */
    colour: () => act("colour", () => store.applyDataFill()),

    scaleBar: (args) => {
      currentMapId(args);
      store.scaleBarCorner.value = corner(args, "bottomLeft");
      const units = textArg(args, "units", "metric");
      if (units !== "metric" && units !== "imperial") throw new Error('units is "metric" or "imperial"');
      store.scaleBarUnits.value = units;
      return act("scaleBar", () => store.addMapScaleBar());
    },

    northArrow: (args) => {
      currentMapId(args);
      store.northCorner.value = corner(args, "topRight");
      store.northLetter.value = flagArg(args, "letter", true);
      return act("northArrow", () => store.addMapNorthArrow());
    },

    inset: (args) => {
      currentMapId(args);
      store.minimapCorner.value = corner(args, "topLeft");
      store.minimapZoomOut.value = numberArg(args, "zoomOut", 4, 1, 12);
      return act("inset", () => store.addMapMinimap());
    },

    chart: (args) => {
      currentMapId(args);
      store.chartCorner.value = corner(args, "bottomRight");
      store.chartBars.value = numberArg(args, "bars", 8, 2, 30);
      return act("chart", () => store.addDataChart());
    },

    legend: (args) => {
      currentMapId(args);
      store.legendCorner.value = corner(args, "bottomLeft");
      return act("legend", () => store.addDataLegend());
    }
  };
}
