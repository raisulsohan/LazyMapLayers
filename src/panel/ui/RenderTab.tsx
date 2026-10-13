// Render settings of the selected map and the render queue: the settings fold into one line, and
// each job is one row, with only what needs action spelled out under it (D106).

import type { JSX } from "preact";
import { signal } from "@preact/signals";
import { PASS_IDS, PASS_INFO } from "../../core/render/passes.ts";
import { MAP_GONE } from "../render/renderJob.ts";
import { describeSpec, renderQueue, type QueueJob, type QueueStatus } from "../render/renderQueue.ts";
import { busy, checkRenderDisk, jobs, removeOldRenders, renderDisk, renderDiskBusy, renderSettings, selected, togglePass, updateRenderSettings } from "../store.ts";
import { formatBytes } from "../render/renderDisk.ts";
import { Icon, type IconName } from "./icons.tsx";

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

const STAGE_LABELS = { camera: "Reading camera", detail: "Fetching street detail", planning: "Checking cache", rendering: "Rendering", importing: "Importing" } as const;

const megabytes = (bytes: number) => (bytes / 1048576).toFixed(1);

/** Open while the user works on the settings; folded to one line otherwise. Not saved. */
const settingsOpen = signal(false);

const STATUS_MARK: Record<QueueStatus, { icon: IconName; text: string }> = {
  queued: { icon: "clock", text: "Queued" },
  running: { icon: "play", text: "Rendering" },
  done: { icon: "check", text: "Done" },
  failed: { icon: "warning", text: "Failed" },
  cancelled: { icon: "x", text: "Cancelled" },
  interrupted: { icon: "warning", text: "Interrupted: After Effects closed while it ran" }
};

function duration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${Math.round(seconds - minutes * 60)} s`;
}

/** The settings as one line, for the folded header. */
function settingsLine(settings: typeof renderSettings.value): string {
  const passes = settings.passes.filter((p) => p !== "base").length;
  return [
    settings.supersample > 1 ? `${settings.supersample}× supersampling` : "No supersampling",
    settings.motionBlur ? `motion blur ${settings.motionBlurSamples}` : "no motion blur",
    passes ? `${passes} pass${passes === 1 ? "" : "es"}` : "no passes"
  ].join(" · ");
}

function JobRow(props: { job: QueueJob }): JSX.Element {
  const job = props.job;
  // A job whose map is in another project is not broken; it only waits for that project.
  const mark = job.missing ? { icon: "x" as IconName, text: "Its map is in another project" } : STATUS_MARK[job.status];
  const stats = job.stats;
  const kind = job.spec.quality === "preview" ? "Preview" : "Final";
  const tooltip = [describeSpec(job.spec), job.summary, ...(stats?.info ?? [])].filter(Boolean).join("\n");
  return (
    <div class={`job ${job.missing ? "missing" : job.status}`} title={tooltip}>
      <div class="job-head">
        <span class="job-mark" title={mark.text}>
          <Icon name={mark.icon} size={12} />
        </span>
        <span class="job-title">
          <strong>{job.mapName}</strong> · {kind}
        </span>
        {stats && (
          <span class="job-meta" title={`${stats.rendered} rendered, ${stats.reused} reused`}>
            {stats.frames} frames · {duration(stats.seconds)}
          </span>
        )}
        {!job.missing && (job.status === "queued" || job.status === "failed" || job.status === "cancelled" || job.status === "interrupted") && <span class="job-meta">{job.status}</span>}
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
          <button class="icon-button flat" onClick={() => renderQueue.remove(job.id)} title="Remove from the list" aria-label="Remove from the list">
            <Icon name="x" size={12} />
          </button>
        )}
      </div>
      {job.status === "running" && job.progress && (
        <div class="progress">
          <div class="bar" style={{ width: `${Math.round((100 * job.progress.done) / Math.max(1, job.progress.total))}%` }} />
          <span>
            {job.progress.stage === "detail"
              ? `${STAGE_LABELS.detail} ${megabytes(job.progress.done)}/${megabytes(job.progress.total)} MB`
              : `${STAGE_LABELS[job.progress.stage]} ${job.progress.done}/${job.progress.total} · ${job.progress.rendered} rendered · ${job.progress.reused} reused`}
          </span>
        </div>
      )}
      {job.notes?.map((note, i) => (
        <div key={i} class="job-note warning">
          {note}
        </div>
      ))}
      {!stats && job.summary && <div class="job-note muted">{job.summary}</div>}
      {job.missing ? (
        <div class="job-note muted" title={`${MAP_GONE}. Open that project to render it again, or remove this job.`}>
          Its map is not in the project that is open now
        </div>
      ) : (
        job.error && (
          <div class="job-note warning" title={job.error}>
            {job.error}
          </div>
        )
      )}
    </div>
  );
}

export function RenderTab(): JSX.Element {
  const settings = renderSettings.value;
  const entry = selected.value;
  const open = settingsOpen.value;
  return (
    <div class="render-tab">
      {!entry && <div class="empty muted">Create or select a map to render it.</div>}
      {entry && (
        <button class={`fold ${open ? "open" : ""}`} data-id="render-settings" aria-expanded={open} onClick={() => (settingsOpen.value = !open)} title="Supersampling, motion blur and passes of this map's renders">
          <Icon name={open ? "chevronDown" : "chevronRight"} size={11} />
          <span class="fold-title">Settings</span>
          {!open && <span class="fold-summary">{settingsLine(settings)}</span>}
        </button>
      )}
      {entry && (
        <div class="editor flush" hidden={!open}>
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
          <JobRow key={job.id} job={job} />
        ))}
      </div>
      <DiskLine />
    </div>
  );
}
