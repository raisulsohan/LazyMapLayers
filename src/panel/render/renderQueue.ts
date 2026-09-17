// Render queue: jobs run one at a time with progress and cancel. The queue is saved to disk, so jobs
// interrupted by closing After Effects show up again with a Resume button; resuming reuses every frame
// that was already cached, so it continues where it stopped.

import { fs, isInCep, os, path } from "../cep.ts";
import { RenderCancelled, runRenderJob, type RenderJobResult, type RenderJobSpec, type RenderProgress } from "./renderJob.ts";

export type QueueStatus = "queued" | "running" | "done" | "failed" | "cancelled" | "interrupted";

export type QueueJob = {
  id: string;
  spec: RenderJobSpec;
  mapName: string;
  status: QueueStatus;
  progress: RenderProgress | null;
  summary: string | null;
  error: string | null;
  addedAt: number;
  finishedAt: number | null;
};

export type QueueEvent = { job: QueueJob; result?: RenderJobResult };

const KEEP_FINISHED = 12;

function queueFile(): string {
  const base = process.env.APPDATA ?? path().join(os().homedir(), "AppData", "Roaming");
  return path().join(base, "LazyMapLayers", "render-queue.json");
}

export function describeSpec(spec: RenderJobSpec): string {
  const s = spec.settings;
  const parts = [spec.quality === "preview" ? "Preview" : "Final"];
  if (s.supersample > 1) parts.push(`${s.supersample}× supersampling`);
  if (s.motionBlur) parts.push(`motion blur ${s.motionBlurSamples}`);
  if (s.passes.length > 1) parts.push(`${s.passes.length} passes`);
  return parts.join(" · ");
}

export class RenderQueue {
  jobs: QueueJob[] = [];
  private readonly listeners = new Set<(event?: QueueEvent) => void>();
  private controller: AbortController | null = null;
  private pumping = false;
  private readonly idleWaiters: (() => void)[] = [];

  load(): void {
    if (!isInCep()) return;
    try {
      const saved = JSON.parse(fs().readFileSync(queueFile(), "utf8")) as QueueJob[];
      this.jobs = saved.map((job) =>
        job.status === "queued" || job.status === "running" ? { ...job, status: "interrupted", progress: null, error: "stopped when the panel closed" } : job
      );
    } catch {
      this.jobs = [];
    }
  }

  private save(): void {
    if (!isInCep()) return;
    try {
      const finished = this.jobs.filter((j) => j.status === "done" || j.status === "failed" || j.status === "cancelled");
      const drop = new Set(finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED)).map((j) => j.id));
      this.jobs = this.jobs.filter((j) => !drop.has(j.id));
      fs().mkdirSync(path().dirname(queueFile()), { recursive: true });
      fs().writeFileSync(queueFile(), JSON.stringify(this.jobs.map((j) => ({ ...j, progress: null }))), "utf8");
    } catch {
      // The queue still works in memory.
    }
  }

  subscribe(listener: (event?: QueueEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(event?: QueueEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  get idle(): boolean {
    return !this.jobs.some((j) => j.status === "queued" || j.status === "running");
  }

  whenIdle(): Promise<void> {
    if (this.idle) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  add(spec: RenderJobSpec, mapName: string): QueueJob {
    const job: QueueJob = {
      id: `j${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
      spec,
      mapName,
      status: "queued",
      progress: null,
      summary: null,
      error: null,
      addedAt: Date.now(),
      finishedAt: null
    };
    this.jobs.push(job);
    this.save();
    this.notify();
    void this.pump();
    return job;
  }

  cancel(id: string): void {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return;
    if (job.status === "queued") {
      job.status = "cancelled";
      job.finishedAt = Date.now();
      this.save();
      this.notify();
      this.wakeIdle();
    } else if (job.status === "running") {
      this.controller?.abort();
    }
  }

  /** Runs a finished, failed, cancelled or interrupted job again; cached frames are reused. */
  resume(id: string): void {
    const job = this.jobs.find((j) => j.id === id);
    if (!job || job.status === "queued" || job.status === "running") return;
    Object.assign(job, { status: "queued", progress: null, summary: null, error: null, finishedAt: null });
    // Move it behind jobs that are already waiting.
    this.jobs = [...this.jobs.filter((j) => j !== job), job];
    this.save();
    this.notify();
    void this.pump();
  }

  remove(id: string): void {
    const job = this.jobs.find((j) => j.id === id);
    if (!job || job.status === "running") return;
    this.jobs = this.jobs.filter((j) => j !== job);
    this.save();
    this.notify();
    this.wakeIdle();
  }

  clearFinished(): void {
    this.jobs = this.jobs.filter((j) => j.status === "queued" || j.status === "running" || j.status === "interrupted");
    this.save();
    this.notify();
  }

  private wakeIdle(): void {
    if (!this.idle) return;
    for (const wake of this.idleWaiters.splice(0)) wake();
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (let job = this.jobs.find((j) => j.status === "queued"); job; job = this.jobs.find((j) => j.status === "queued")) {
        job.status = "running";
        this.controller = new AbortController();
        this.save();
        this.notify();
        let lastNotify = 0;
        let result: RenderJobResult | undefined;
        try {
          result = await runRenderJob(job.spec, {
            signal: this.controller.signal,
            onProgress: (p) => {
              job!.progress = p;
              const now = performance.now();
              if (now - lastNotify > 100 || p.done === p.total) {
                lastNotify = now;
                this.notify();
              }
            }
          });
          job.status = "done";
          const seconds = (result.totalMs / 1000).toFixed(1);
          job.summary = `${result.frames} frames: ${result.rendered} rendered, ${result.reused} reused · ${seconds} s`;
        } catch (error) {
          if (error instanceof RenderCancelled) {
            job.status = "cancelled";
            job.summary = "cancelled; frames rendered so far are kept";
          } else {
            job.status = "failed";
            job.error = error instanceof Error ? error.message : String(error);
          }
        } finally {
          this.controller = null;
          job.finishedAt = Date.now();
          job.progress = null;
          this.save();
          this.notify({ job, result });
        }
      }
    } finally {
      this.pumping = false;
      this.wakeIdle();
    }
  }
}

export const renderQueue = new RenderQueue();
