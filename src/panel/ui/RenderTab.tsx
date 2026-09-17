// Render settings of the selected map and the render queue.

import type { JSX } from "preact";
import { PASS_IDS, PASS_INFO } from "../../core/render/passes.ts";
import { describeSpec, renderQueue } from "../render/renderQueue.ts";
import { jobs, renderSettings, selected, togglePass, updateRenderSettings } from "../store.ts";
import { Icon } from "./icons.tsx";

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
              {(job.status === "interrupted" || job.status === "cancelled" || job.status === "failed") && (
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
            {job.error && <div class="small warning">{job.error}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
