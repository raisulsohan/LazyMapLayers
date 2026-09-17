// LazyMapLayers panel entry: mounts the interface, keeps a small log file for bug reports, and (in
// development builds only) exposes handles for the automated in-AE tests.

import "./polyfills.ts";
import { render } from "preact";
import type { RenderSettings } from "../core/render/plan.ts";
import { fs, isInCep, path } from "./cep.ts";
import { startDevAutomation } from "./devAutomation.ts";
import { previewMap, showCompView, compView, countryAt, compSize } from "./preview.ts";
import { renderQueue } from "./render/renderQueue.ts";
import * as shots from "./shots/shotsStore.ts";
import { spikeDir } from "./spikes.ts";
import * as store from "./store.ts";
import { App } from "./ui/App.tsx";

function logToFile(text: string) {
  if (!isInCep()) return;
  try {
    const dir = path().join(spikeDir(), "..");
    fs().mkdirSync(dir, { recursive: true });
    fs().appendFileSync(path().join(dir, "panel.log"), `${new Date().toISOString()} ${text}\n`, "utf8");
  } catch {
    // Never let logging break the panel.
  }
}

window.addEventListener("error", (event) => logToFile(`error: ${event.message} at ${event.filename}:${event.lineno}`));
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason instanceof Error ? event.reason.stack ?? event.reason.message : String(event.reason);
  logToFile(`unhandled rejection: ${reason}`);
});
logToFile(`panel start: ${navigator.userAgent}`);

// Handle for UI tests driven through DevTools (tools/ae-spikes.mjs --ui).
(window as unknown as { lmlDebug: unknown }).lmlDebug = {
  map: () => previewMap(),
  compView,
  showCompView,
  /** The country in the middle of the preview (for the UI test of the highlight tool). */
  countryAtCentre: () => countryAt({ x: compSize().width / 2, y: compSize().height / 2 }),
  addPin: (lat: number, lng: number, threeD = false) => store.addPinAt({ lat, lng }, threeD),
  addCamera: () => store.addCamera(),
  selectedMapId: () => store.selectedId.value,
  busy: () => store.busy.value,
  log: () => store.logLines.value.map((line) => line.text),
  queue: renderQueue,
  queueIdle: () => renderQueue.whenIdle().then(() => true),
  setRenderSettings: (settings: Partial<RenderSettings>) => store.updateRenderSettings(settings),
  store,
  shots
};

const root = document.getElementById("app");
if (root) render(<App />, root);

// Test automation only exists in development builds: a release never acts on request files.
if (process.env.NODE_ENV === "development" && isInCep()) startDevAutomation(store.log, (value) => (store.busy.value = value));
