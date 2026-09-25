// Render settings of the selected map and the render queue.

import type { JSX } from "preact";
import { PASS_IDS, PASS_INFO } from "../../core/render/passes.ts";
import { MAP_GONE } from "../render/renderJob.ts";
import { describeSpec, renderQueue } from "../render/renderQueue.ts";
import { busy, checkRenderDisk, jobs, removeOldRenders, renderDisk, renderDiskBusy, renderSettings, selected, togglePass, updateRenderSettings } from "../store.ts";
import { formatBytes } from "../render/renderDisk.ts";
import { Icon } from "./icons.tsx";

/** What the renders take on disk, with the one thing that can safely go: renders of unsaved projects that are gone. */
function DiskLine(): JSX.Element {
  const report = renderDisk.value;
  const looseTotal = report ? report.loose.reduce((total, entry) => total + entry.bytes, 0) : 0;
  return (
    <div class="disk-line small muted" data-id="render-disk">
      {report ? (
        <>
          <span title={`Renders of this project: ${formatBytes(report.projectBytes)} next to the project file (kept). Renders of unsaved projects: ${formatBytes(looseTotal)} in the data folder, of which ${formatBytes(report.looseOldBytes)} belong to unsaved projects that are closed and cannot be opened again. Renders of a project that was saved are kept wherever they are.`}>
            Renders on disk: this project {formatBytes(report.projectBytes)}
            {looseTotal ? ` · unsaved projects ${formatBytes(looseTotal)}` : ""}
            {report.looseOldBytes ? ` (${formatBytes(report.looseOldBytes)} from projects that are gone)` : ""}
          </span>
          {report.looseOldBytes > 0 && (
            <button class="small-button" data-id="render-disk-clean" disabled={busy.value} title="Removes the renders of unsaved projects that are no longer open, and only those. Renders of the project open now, and of any project still on disk, are never touched." onClick={() => void removeOldRenders()}>
              Remove {formatBytes(report.looseOldBytes)}
            </button>
          )}
          <button class="small-button" data-id="render-disk-check" disabled={renderDiskBusy.value} title="Count again" onClick={() => void checkRenderDisk()}>
            Refresh
          </button>
        </>
      ) : (
        <button class="small-button" data-id="render-disk-check" disabled={renderDiskBusy.value} title="How much disk the renders take, and what can go" onClick={() => void checkRenderDisk()}>
          {renderDiskBusy.value ? "Counting the renders on disk…" : "Renders on disk…"}
        </button>
      )}
    </div>
  );
}

const STAGE_LABELS = { camera: "Reading camera", planning: "Checking cache", rendering: "Rendering", importing: "Importing" } as const;

export function RenderTab(): JSX.Element {
  const settings = renderSettings.value;
  const entry = selected.value;
  return (
    <div class="render-tab">
      {!entry && <div class="empty muted">Create or select a map to render it.</div>}
      {entry && (
        <div class="editor flush">
          <div class="field-row">
            <label class="num-field grow" title="Each pixel is averaged from several samples on the GPU: smoother lines and text edges">
              <span>Supersampling</span>
              <select data-id="supersample" value={settings.supersample} onChange={(e) => void updateRenderSettings({ supersample: Number((e.target as HTMLSelectElement).value) })}>
                <option value={1}>Off</option>
                <option value={2}>2× (4 samples per pixel)</option>
                <option value={3}>3× (9 samples per pixel)</option>
                <option value={4}>4× (16 samples per pixel)</option>
              </select>
            </label>
          </div>
          <div class="field-row">
            <label class="check">
              <input type="checkbox" checked={settings.motionBlur} onChange={(e) => void updateRenderSettings({ motionBlur: (e.target as HTMLInputElement).checked })} />
              Motion blur
            </label>
            <select
              disabled={!settings.motionBlur}
              value={settings.motionBlurSamples}
              onChange={(e) => void updateRenderSettings({ motionBlurSamples: Number((e.target as HTMLSelectElement).value) })}
              title="Sub-frame samples. Shutter angle and phase come from the scene comp, so the basemap blurs like the layers above it."
            >
              {[4, 8, 16, 32].map((n) => (
                <option key={n} value={n}>
                  {n} samples
                </option>
              ))}
            </select>
          </div>
          <div class="field-row passes" title="Passes go into the map comp above the basemap, switched off. Ground passes are held out by 3D buildings, so an effect on roads never shows through a building. Mattes are white with alpha.">
            <span class="muted">Passes</span>
            {PASS_IDS.filter((p) => p !== "base").map((pass) => (
              <label key={pass} class="check">
                <input type="checkbox" checked={settings.passes.includes(pass)} onChange={(e) => togglePass(pass, (e.target as HTMLInputElement).checked)} />
                {PASS_INFO[pass].label}
              </label>
            ))}
          </div>
        </div>
      )}

      {jobs.value.length === 0 && entry && (
        <div class="empty muted">
          <Icon name="film" size={18} />
          <div>Render preview is fast (half size). Render makes the final frames; only frames that changed are drawn again.</div>
        </div>
      )}
      <DiskLine />
      <div class="queue">
        {jobs.value.map((job) => (
          <div key={job.id} class={`job ${job.status}`}>
            <div class="job-head">
              <span class="job-title">
                <strong>{job.mapName}</strong> · {describeSpec(job.spec)}
              </span>
              <span class="job-status">{job.status}</span>
              {(job.status === "running" || job.status === "queued") && (
                <button class="small-button" onClick={() => renderQueue.cancel(job.id)}>
                  Cancel
                </button>
              )}
              {!job.missing && (job.status === "interrupted" || job.status === "cancelled" || job.status === "failed") && (
                <button class="small-button" onClick={() => renderQueue.resume(job.id)} title="Continue; frames already rendered are reused">
                  Resume
                </button>
              )}
              {job.status !== "running" && job.status !== "queued" && (
                <button class="small-button" onClick={() => renderQueue.remove(job.id)} title="Remove from the list">
                  ✕
                </button>
              )}
            </div>
            {job.status === "running" && job.progress && (
              <div class="progress">
                <div class="bar" style={{ width: `${Math.round((100 * job.progress.done) / Math.max(1, job.progress.total))}%` }} />
                <span>
                  {STAGE_LABELS[job.progress.stage]} {job.progress.done}/{job.progress.total} · {job.progress.rendered} rendered · {job.progress.reused} reused
                </span>
              </div>
            )}
            {job.summary && <div class="small muted">{job.summary}</div>}
            {job.missing ? (
              <div class="small muted" title="Open the project this map is in to render it again, or remove this job.">
                {MAP_GONE}. Open that project to render it again, or remove this job.
              </div>
            ) : (
              job.error && <div class="small warning">{job.error}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
