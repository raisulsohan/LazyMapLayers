// The shot list in the panel: editing, drafts, thumbnails, playback in the preview and "Apply".
//
// After Effects is only touched by Apply (one undo step). Edits in between live in a small draft file
// per map in the user's data folder, so closing the panel loses nothing and the project's undo history
// stays clean. Playback moves only the preview map: no renders and no After Effects calls.

import { computed, signal } from "@preact/signals";
import type { View } from "../../core/camera/camera.ts";
import { DEFAULT_MOVE, bakeShots, buildTimeline, newShotId, normaliseShotList, suggestedMoveSeconds, viewAtFrame, type Move, type Shot, type ShotList } from "../../core/camera/shots.ts";
import { keyOf } from "../../core/render/frameKey.ts";
import { callHost, callHostWithJobFile, fs, isInCep, path, userDataDir } from "../cep.ts";
import { captureThumbnail, compView, showCompView } from "../preview.ts";
import { busy, log, onSelectedMap, readMaps, run, selected, suggestName, type MapEntry } from "../store.ts";

export type ShotState = "none" | "saved" | "applied" | "edited";

const EMPTY: ShotList = { v: 1, start: 0, shots: [] };

export const shotList = signal<ShotList>(EMPTY);
/** What the project holds: nothing, a list never applied, keys that match the list, or keys changed by hand. */
export const hostState = signal<ShotState>("none");
export const appliedHash = signal<string | null>(null);
export const selectedShot = signal<string | null>(null);
export const openMove = signal<string | null>(null);
export const thumbs = signal<Record<string, string>>({});
export const playing = signal(false);
export const playTime = signal<number | null>(null);

let loadedFor = "";

const viewport = () => ({ width: selected.value?.width ?? 1920, height: selected.value?.height ?? 1080 });
const frameRate = () => selected.value?.frameRate ?? 25;

export const timeline = computed(() => buildTimeline(shotList.value, viewport(), frameRate()));
export const listHash = computed(() => keyOf(shotList.value));
/** True when the timeline does not show the list as it is now. */
export const needsApply = computed(() => shotList.value.shots.length > 0 && (hostState.value !== "applied" || appliedHash.value !== listHash.value));
export const endTime = computed(() => timeline.value.endFrame / timeline.value.frameRate);

const draftFile = (mapId: string) => path().join(userDataDir(), "drafts", `${mapId}.json`);
const thumbDir = (mapId: string) => path().join(userDataDir(), "thumbs", mapId);

function writeDraft(): void {
  const mapId = loadedFor;
  if (!mapId || !isInCep()) return;
  try {
    const file = draftFile(mapId);
    if (!shotList.value.shots.length || appliedHash.value === listHash.value) {
      if (fs().existsSync(file)) fs().unlinkSync(file);
      return;
    }
    fs().mkdirSync(path().dirname(file), { recursive: true });
    fs().writeFileSync(file, JSON.stringify(shotList.value), "utf8");
  } catch {
    // A draft is a convenience; the list still lives in the panel.
  }
}

function readDraft(mapId: string): ShotList | null {
  try {
    const file = draftFile(mapId);
    return fs().existsSync(file) ? normaliseShotList(JSON.parse(fs().readFileSync(file, "utf8"))) : null;
  } catch {
    return null;
  }
}

function loadThumbs(mapId: string, list: ShotList): void {
  const found: Record<string, string> = {};
  try {
    for (const shot of list.shots) {
      const file = path().join(thumbDir(mapId), `${shot.id}.jpg`);
      if (fs().existsSync(file)) found[shot.id] = `data:image/jpeg;base64,${fs().readFileSync(file).toString("base64")}`;
    }
  } catch {
    // Thumbnails are optional.
  }
  thumbs.value = found;
}

async function snapThumb(shotId: string): Promise<void> {
  const data = await captureThumbnail();
  if (!data) return;
  thumbs.value = { ...thumbs.value, [shotId]: data };
  if (!isInCep() || !loadedFor) return;
  try {
    fs().mkdirSync(thumbDir(loadedFor), { recursive: true });
    fs().writeFileSync(path().join(thumbDir(loadedFor), `${shotId}.jpg`), Buffer.from(data.split(",")[1], "base64"));
  } catch {
    // Thumbnails are optional.
  }
}

function commit(next: ShotList): void {
  shotList.value = next;
  writeDraft();
}

/** Reads the map's list from the project (and a newer draft, if there is one). */
async function load(entry: MapEntry | null): Promise<void> {
  stop();
  if (!entry) {
    loadedFor = "";
    shotList.value = EMPTY;
    hostState.value = "none";
    appliedHash.value = null;
    thumbs.value = {};
    return;
  }
  const sameMap = loadedFor === entry.mapId;
  try {
    const stored = await callHost<{ list: unknown; state: ShotState; appliedHash: string | null }>("getShots", { mapId: entry.mapId });
    hostState.value = stored.state;
    appliedHash.value = stored.appliedHash;
    // The same map read again (the panel got the focus): keep what the user is editing.
    if (sameMap) return;
    loadedFor = entry.mapId;
    const fromProject = stored.list ? normaliseShotList(stored.list) : EMPTY;
    const draft = readDraft(entry.mapId);
    shotList.value = draft && draft.shots.length ? draft : fromProject;
    selectedShot.value = null;
    openMove.value = null;
    loadThumbs(entry.mapId, shotList.value);
  } catch (error) {
    log(`reading shots: ${error instanceof Error ? error.message : String(error)}`, "fail");
  }
}

export function startShots(): () => void {
  return onSelectedMap((entry) => void load(entry));
}

export function addShotFromPreview(): void {
  const view = compView();
  if (!view || !selected.value) {
    log("create or select a map first", "muted");
    return;
  }
  const list = shotList.value;
  const id = newShotId(list.shots.map((s) => s.id));
  // New shots go after the selected one (or at the end).
  const at = selectedShot.value ? list.shots.findIndex((s) => s.id === selectedShot.value) + 1 : list.shots.length;
  const previous = list.shots[at - 1];
  const from = previous ? timeline.value.shots[at - 1]?.departure ?? previous.view : null;
  const move: Move = { ...DEFAULT_MOVE, easing: { ...DEFAULT_MOVE.easing }, seconds: from ? suggestedMoveSeconds(from, view, viewport()) : DEFAULT_MOVE.seconds };
  const taken = new Set(list.shots.map((s) => s.name));
  let name = suggestName() ?? `Shot ${list.shots.length + 1}`;
  for (let n = 2; taken.has(name); n++) name = `${name.replace(/ \d+$/, "")} ${n}`;
  const shot: Shot = { id, name, view, hold: 2, orbit: 0, push: 0, spin: 0, holdEasing: { id: "smooth" }, move };
  const shots = [...list.shots];
  shots.splice(at, 0, shot);
  // The first shot starts where the time indicator is.
  const start = list.shots.length ? list.start : Math.max(0, selected.value.time);
  commit({ v: 1, start, shots });
  selectedShot.value = id;
  void snapThumb(id);
}

export function updateShotFromPreview(id: string): void {
  const view = compView();
  if (!view) return;
  commit({ ...shotList.value, shots: shotList.value.shots.map((s) => (s.id === id ? { ...s, view } : s)) });
  void snapThumb(id);
}

export function patchShot(id: string, patch: Partial<Shot>): void {
  commit(normaliseShotList({ ...shotList.value, shots: shotList.value.shots.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
}

export function patchMove(id: string, patch: Partial<Move>): void {
  commit(normaliseShotList({ ...shotList.value, shots: shotList.value.shots.map((s) => (s.id === id ? { ...s, move: { ...s.move, ...patch } } : s)) }));
}

export function setStart(seconds: number): void {
  commit(normaliseShotList({ ...shotList.value, start: seconds }));
}

export function removeShot(id: string): void {
  commit({ ...shotList.value, shots: shotList.value.shots.filter((s) => s.id !== id) });
  if (selectedShot.value === id) selectedShot.value = null;
  if (openMove.value === id) openMove.value = null;
}

export function moveShot(id: string, direction: -1 | 1): void {
  const shots = [...shotList.value.shots];
  const from = shots.findIndex((s) => s.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= shots.length) return;
  [shots[from], shots[to]] = [shots[to], shots[from]];
  commit({ ...shotList.value, shots });
}

/** Shows a shot in the preview and moves After Effects' time indicator to it. */
export function goToShot(id: string): void {
  stop();
  const index = shotList.value.shots.findIndex((s) => s.id === id);
  if (index < 0) return;
  selectedShot.value = id;
  const at = timeline.value.shots[index];
  showCompView(at.arrival);
  const entry = selected.value;
  if (entry && isInCep() && !busy.value) void callHost("setSceneTime", { mapId: entry.mapId, time: at.arriveFrame / timeline.value.frameRate }).catch(() => undefined);
}

let raf = 0;

export function stop(): void {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (playing.value) playing.value = false;
  playTime.value = null;
}

/** Plays the camera in the preview in real time, from the move into the selected shot (or the start). */
export function play(): void {
  if (playing.value) {
    stop();
    return;
  }
  const line = timeline.value;
  if (!shotList.value.shots.length) return;
  // With a shot selected, playback starts where the camera leaves the shot before it, so a changed
  // move or view shows at once.
  const index = selectedShot.value ? shotList.value.shots.findIndex((s) => s.id === selectedShot.value) : 0;
  const startFrame = index > 0 ? line.shots[index - 1].leaveFrame : line.startFrame;
  const began = performance.now();
  playing.value = true;
  const tick = () => {
    const frame = startFrame + ((performance.now() - began) / 1000) * line.frameRate;
    const view: View | null = viewAtFrame(line, Math.min(frame, line.endFrame));
    if (view) showCompView(view);
    playTime.value = Math.min(frame, line.endFrame) / line.frameRate;
    if (frame >= line.endFrame) {
      stop();
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

/** Writes the camera to the timeline: keys on the five map controls and a marker per shot. */
export const applyShots = () =>
  run("apply shots", async () => {
    stop();
    const entry = selected.value;
    if (!entry) return;
    const list = shotList.value;
    if (!list.shots.length) return;
    const baked = bakeShots(list, { width: entry.width, height: entry.height }, entry.frameRate);
    // One frame more than the end time, so the last shot's own frame is inside the comp.
    const needed = baked.endTime + 1 / entry.frameRate;
    if (needed > entry.duration + 1e-6) {
      await callHost("extendDuration", { mapId: entry.mapId, duration: needed });
      log(`the map and its scene are now ${needed.toFixed(2)} s long, to fit the shots`, "muted");
    }
    const hash = keyOf(list);
    const result = await callHostWithJobFile<{ keys: number; removed: number; markers: number; ms: number }>("applyShots", {
      mapId: entry.mapId,
      list,
      hash,
      baked: { startTime: baked.startTime, endTime: baked.endTime, controls: baked.controls, holdTimes: baked.holdTimes, markers: baked.markers },
      moveTime: baked.startTime
    });
    hostState.value = "applied";
    appliedHash.value = hash;
    writeDraft();
    log(`camera keyed for ${list.shots.length} ${list.shots.length === 1 ? "shot" : "shots"} (${baked.startTime.toFixed(2)} to ${baked.endTime.toFixed(2)} s, ${result.keys} keys in ${result.ms} ms). Ctrl+Z in After Effects undoes it in one step`, "ok");
    await readMaps();
  });

/** Forgets the list (and with `keys` the camera keys it wrote). */
export const clearShots = (keys: boolean) =>
  run("clear shots", async () => {
    stop();
    const entry = selected.value;
    if (!entry) return;
    await callHost("clearShots", { mapId: entry.mapId, keys });
    shotList.value = EMPTY;
    hostState.value = "none";
    appliedHash.value = null;
    selectedShot.value = null;
    writeDraft();
    log(keys ? "shots and their camera keys removed" : "shot list removed; the camera keys stay", "ok");
  });

export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const minutes = Math.floor(s / 60);
  const rest = s - minutes * 60;
  return `${minutes}:${rest < 10 ? "0" : ""}${rest.toFixed(rest % 1 === 0 ? 0 : 1)}`;
}
