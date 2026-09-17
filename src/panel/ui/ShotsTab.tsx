// The shot list: shot rows with a slim move row between them. A shot opens its hold settings, a move
// opens its type, duration, easing and flight height.

import type { JSX } from "preact";
import { EASING_PRESETS, easingBezier, type Easing, type EasingId } from "../../core/camera/easing.ts";
import { FLIGHT_HEIGHTS, type FlightHeight, type Move, type MoveKind, type Shot } from "../../core/camera/shots.ts";
import { busy, projection, selected } from "../store.ts";
import {
  addShotFromPreview,
  applyShots,
  clearShots,
  endTime,
  formatTime,
  goToShot,
  hostState,
  moveShot,
  needsApply,
  openMove,
  patchMove,
  patchShot,
  play,
  playing,
  playTime,
  removeShot,
  selectedShot,
  setStart,
  shotList,
  thumbs,
  timeline,
  updateShotFromPreview
} from "../shots/shotsStore.ts";
import { Icon, IconButton, type IconName } from "./icons.tsx";

const MOVE_LABELS: Record<MoveKind, { label: string; icon: IconName; hint: string }> = {
  fly: { label: "Fly", icon: "plane", hint: "One continuous zoom-and-pan curve: rises, travels and lands without stopping" },
  straight: { label: "Straight", icon: "straight", hint: "Moves and zooms evenly, without rising (for nearby views)" },
  route: { label: "Along route", icon: "route", hint: "Travels along the great-circle route between the two shots, like an airliner" },
  cut: { label: "Cut", icon: "cut", hint: "Jumps to the shot with no move" }
};

const number = (event: Event, fallback: number): number => {
  const value = Number((event.target as HTMLInputElement).value);
  return Number.isFinite(value) ? value : fallback;
};

function NumberField(props: { label: string; value: number; step?: number; min?: number; max?: number; suffix?: string; title?: string; onChange: (value: number) => void }): JSX.Element {
  return (
    <label class="num-field" title={props.title}>
      <span>{props.label}</span>
      <input type="number" value={props.value} step={props.step ?? 0.5} min={props.min} max={props.max} onChange={(e) => props.onChange(number(e, props.value))} />
      {props.suffix && <span class="muted">{props.suffix}</span>}
    </label>
  );
}

function EasingPicker(props: { value: Easing | undefined; onChange: (easing: Easing) => void }): JSX.Element {
  const current = props.value ?? { id: "smooth" as EasingId };
  const bezier = easingBezier(current);
  return (
    <div class="easing">
      <div class="chips">
        {(Object.keys(EASING_PRESETS) as Exclude<EasingId, "custom">[]).map((id) => (
          <button key={id} class={`chip ${current.id === id ? "on" : ""}`} title={EASING_PRESETS[id].hint} onClick={() => props.onChange({ id })}>
            <EasingCurve bezier={EASING_PRESETS[id].bezier} />
            {EASING_PRESETS[id].label}
          </button>
        ))}
        <button class={`chip ${current.id === "custom" ? "on" : ""}`} title="Your own curve: x1, y1, x2, y2 like After Effects' speed graph or CSS cubic-bezier" onClick={() => props.onChange({ id: "custom", bezier })}>
          <EasingCurve bezier={bezier} />
          Custom
        </button>
      </div>
      {current.id === "custom" && (
        <div class="bezier-fields">
          {(["x1", "y1", "x2", "y2"] as const).map((name, i) => (
            <label key={name} class="num-field">
              <span>{name}</span>
              <input
                type="number"
                step={0.05}
                min={i % 2 === 0 ? 0 : -1}
                max={i % 2 === 0 ? 1 : 2}
                value={Math.round(bezier[i] * 100) / 100}
                onChange={(e) => {
                  const next = [...bezier] as [number, number, number, number];
                  next[i] = number(e, bezier[i]);
                  props.onChange({ id: "custom", bezier: next });
                }}
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/** A tiny drawing of the easing curve (time to the right, progress upwards). */
function EasingCurve(props: { bezier: [number, number, number, number] }): JSX.Element {
  const [x1, y1, x2, y2] = props.bezier;
  const p = (x: number, y: number) => `${(2 + x * 16).toFixed(1)} ${(14 - y * 12).toFixed(1)}`;
  return (
    <svg width="20" height="16" viewBox="0 0 20 16" class="curve" aria-hidden="true">
      <path d={`M${p(0, 0)} C${p(x1, y1)} ${p(x2, y2)} ${p(1, 1)}`} fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  );
}

function MoveEditor(props: { shot: Shot }): JSX.Element {
  const move = props.shot.move;
  const set = (patch: Partial<Move>) => patchMove(props.shot.id, patch);
  const route = move.route ?? {};
  return (
    <div class="editor">
      <div class="chips">
        {(Object.keys(MOVE_LABELS) as MoveKind[]).map((kind) => (
          <button key={kind} class={`chip ${move.kind === kind ? "on" : ""}`} title={MOVE_LABELS[kind].hint} onClick={() => set({ kind })}>
            <Icon name={MOVE_LABELS[kind].icon} size={12} />
            {MOVE_LABELS[kind].label}
          </button>
        ))}
      </div>
      {move.kind !== "cut" && (
        <>
          <div class="field-row">
            <NumberField label="Duration" value={move.seconds} min={0.1} max={600} suffix="s" onChange={(seconds) => set({ seconds })} />
            {(move.kind === "fly" || (move.kind === "route" && !route.level)) && (
              <label class="num-field" title="How far the camera rises on the way">
                <span>Height</span>
                <select value={move.height ?? "normal"} onChange={(e) => set({ height: (e.target as HTMLSelectElement).value as FlightHeight })}>
                  {(Object.keys(FLIGHT_HEIGHTS) as FlightHeight[]).map((h) => (
                    <option key={h} value={h}>
                      {h[0].toUpperCase() + h.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <EasingPicker value={move.easing} onChange={(easing) => set({ easing })} />
          {(move.kind === "fly" || move.kind === "route") && (
            <label class="check" title="A tilted shot looks straight down while the camera is high above both ends, and tilts again on the way down">
              <input type="checkbox" checked={move.pitchDip !== false} onChange={(e) => set({ pitchDip: (e.target as HTMLInputElement).checked })} />
              Level the tilt while high up
            </label>
          )}
          {move.kind === "route" && (
            <div class="field-row">
              <label class="check" title="Keep the zoom between the two shots instead of rising like a flight (for short routes)">
                <input type="checkbox" checked={route.level === true} onChange={(e) => set({ route: { ...route, level: (e.target as HTMLInputElement).checked } })} />
                Stay level
              </label>
              <label class="check" title="Turn the camera with the direction of travel, looking a little ahead, with smoothed corners">
                <input type="checkbox" checked={route.followBearing === true} onChange={(e) => set({ route: { ...route, followBearing: (e.target as HTMLInputElement).checked } })} />
                Turn with the route
              </label>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ShotEditor(props: { shot: Shot }): JSX.Element {
  const shot = props.shot;
  const set = (patch: Partial<Shot>) => patchShot(shot.id, patch);
  const moving = (shot.orbit ?? 0) !== 0 || (shot.push ?? 0) !== 0 || (shot.spin ?? 0) !== 0;
  return (
    <div class="editor">
      <div class="field-row">
        <label class="num-field grow">
          <span>Name</span>
          <input type="text" value={shot.name} onChange={(e) => set({ name: (e.target as HTMLInputElement).value })} />
        </label>
        <NumberField label="Hold" value={shot.hold} min={0} max={600} suffix="s" title="How long the camera stays on this shot" onChange={(hold) => set({ hold })} />
      </div>
      <div class="field-row">
        <NumberField label="Orbit" value={shot.orbit ?? 0} step={5} suffix="°" title="Turn around the centre during the hold (negative turns the other way)" onChange={(orbit) => set({ orbit })} />
        <NumberField label="Push in" value={shot.push ?? 0} step={0.1} suffix="zoom" title="Zoom levels gained during the hold (negative pulls out)" onChange={(push) => set({ push })} />
        {projection.value === "globe" && (
          <NumberField label="Spin" value={shot.spin ?? 0} step={5} suffix="°" title="Degrees of longitude the globe turns during the hold" onChange={(spin) => set({ spin })} />
        )}
      </div>
      {moving && shot.hold > 0 && <EasingPicker value={shot.holdEasing} onChange={(holdEasing) => set({ holdEasing })} />}
      {moving && shot.hold === 0 && <div class="muted small">Give the shot a hold time for the orbit, push or spin to play.</div>}
      <div class="field-row">
        <button data-id="shot-update" onClick={() => updateShotFromPreview(shot.id)} title="Replace this shot's view with what the preview shows now">
          <Icon name="refresh" size={12} /> Update from preview
        </button>
      </div>
    </div>
  );
}

function holdSummary(shot: Shot): string[] {
  const parts: string[] = [];
  if (shot.hold > 0) {
    if (shot.orbit) parts.push(`Orbit ${shot.orbit}°`);
    if (shot.push) parts.push(`${shot.push > 0 ? "Push in" : "Pull out"} ${Math.abs(shot.push)}`);
    if (shot.spin) parts.push(`Spin ${shot.spin}°`);
  }
  return parts;
}

function moveSummary(move: Move): string {
  if (move.kind === "cut") return "Cut";
  const easing = move.easing.id === "custom" ? "Custom" : EASING_PRESETS[move.easing.id].label;
  return `${MOVE_LABELS[move.kind].label} · ${move.seconds} s · ${easing}`;
}

export function ShotsTab(): JSX.Element {
  const list = shotList.value;
  const line = timeline.value;
  const entry = selected.value;
  const fps = line.frameRate;
  // The shot the playhead is in, while playing.
  const playingShot =
    playTime.value === null
      ? -1
      : line.shots.reduce((found, s, i) => (playTime.value! * fps >= (i === 0 ? s.arriveFrame : line.shots[i - 1].leaveFrame) ? i : found), -1);
  const tooLong = entry && list.shots.length > 0 && endTime.value > entry.duration + 1e-6;

  return (
    <div class="shots">
      <div class="shots-bar">
        <button data-id="shot-add" disabled={!entry} onClick={addShotFromPreview} title="Add the view in the preview as a shot (after the selected shot)">
          <Icon name="plus" size={12} /> Shot
        </button>
        <button data-id="shot-play" disabled={list.shots.length < 1} onClick={play} title="Play the camera in the preview, from the move into the selected shot (Space). Nothing is rendered and After Effects is not touched.">
          <Icon name={playing.value ? "stop" : "play"} size={12} filled /> {playing.value ? "Stop" : "Play"}
        </button>
        <span class="spacer" />
        <button
          data-id="shot-apply"
          class={needsApply.value ? "primary" : ""}
          disabled={busy.value || !entry || list.shots.length === 0}
          onClick={() => void applyShots()}
          title="Write the camera to the timeline: keys on the map layer's five controls and a marker per shot. One undo step."
        >
          <Icon name="check" size={12} /> {needsApply.value || list.shots.length === 0 ? "Apply to timeline" : "Applied"}
        </button>
      </div>

      {hostState.value === "edited" && list.shots.length > 0 && (
        <div class="notice">
          <Icon name="warning" size={13} /> The camera keys were changed by hand in the timeline. Apply replaces the keys between {formatTime(line.startFrame / fps)} and {formatTime(endTime.value)}.
        </div>
      )}

      {list.shots.length === 0 && (
        <div class="empty">
          <Icon name="film" size={20} />
          <div>
            <strong>Build the camera from shots</strong>
            <div class="muted">
              {entry ? "Frame a view in the preview and press + Shot. A second shot gives you a camera move between them, and Play shows it right away." : "Create a map first (the list button at the top left)."}
            </div>
          </div>
        </div>
      )}

      <div class="shot-list">
        {list.shots.map((shot, i) => {
          const at = line.shots[i];
          const isSelected = selectedShot.value === shot.id;
          const moveOpen = openMove.value === shot.id;
          const chips = holdSummary(shot);
          return (
            <div key={shot.id}>
              {i > 0 && (
                <>
                  <div class={`move-row ${moveOpen ? "open" : ""}`} data-id={`move-${i}`} onClick={() => (openMove.value = moveOpen ? null : shot.id)} title="Click to change this move">
                    <Icon name={MOVE_LABELS[shot.move.kind].icon} size={12} />
                    <span>{moveSummary(shot.move)}</span>
                    <Icon name={moveOpen ? "chevronDown" : "chevronRight"} size={11} />
                  </div>
                  {moveOpen && <MoveEditor shot={shot} />}
                </>
              )}
              <div class={`shot-row ${isSelected ? "selected" : ""} ${playingShot === i ? "playing" : ""}`} data-id={`shot-${i}`} onClick={() => (selectedShot.value = isSelected ? null : shot.id)} onDblClick={() => goToShot(shot.id)}>
                <div class="thumb">{thumbs.value[shot.id] ? <img src={thumbs.value[shot.id]} alt="" /> : <Icon name="image" size={14} />}</div>
                <div class="shot-text">
                  <div class="shot-name">
                    {i + 1} · {shot.name}
                  </div>
                  <div class="muted small">
                    {formatTime(at.arriveFrame / fps)}
                    {shot.hold > 0 ? ` · hold ${shot.hold} s` : " · no hold"}
                  </div>
                </div>
                {chips.map((c) => (
                  <span key={c} class="tag">
                    {c}
                  </span>
                ))}
                <span class="row-actions" onClick={(e) => e.stopPropagation()}>
                  <IconButton icon="target" size={12} class="flat" title="Show this shot in the preview and move the time indicator to it (or double-click the shot)" onClick={() => goToShot(shot.id)} />
                  <IconButton icon="up" size={12} class="flat" title="Move up" disabled={i === 0} onClick={() => moveShot(shot.id, -1)} />
                  <IconButton icon="down" size={12} class="flat" title="Move down" disabled={i === list.shots.length - 1} onClick={() => moveShot(shot.id, 1)} />
                  <IconButton icon="trash" size={12} class="flat" title="Remove this shot" onClick={() => removeShot(shot.id)} />
                </span>
              </div>
              {isSelected && <ShotEditor shot={shot} />}
            </div>
          );
        })}
      </div>

      {list.shots.length > 0 && (
        <div class="shots-foot">
          <NumberField label="Starts at" value={list.start} min={0} step={0.5} suffix="s" title="Scene time of the first shot" onChange={setStart} />
          <span class={tooLong ? "warning small" : "muted small"} title={tooLong ? "Apply makes the map and its scene comp longer to fit" : undefined}>
            ends at {formatTime(endTime.value)}
            {entry ? ` · comp ${formatTime(entry.duration)}` : ""}
          </span>
          <span class="spacer" />
          <IconButton icon="trash" size={12} class="flat" title="Remove the whole shot list (the camera keys stay; Alt+click removes the keys too)" onClick={(e) => void clearShots(e.altKey)} />
        </div>
      )}
    </div>
  );
}
