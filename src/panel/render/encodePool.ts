// A small pool of encode workers (see encodeWorker.ts). The renderer keeps drawing while frames are
// composed and encoded in parallel; `whenReady` applies back-pressure so memory stays bounded.

import type { PassId, RenderId } from "../../core/render/passes.ts";
import { extensionRoot, fs, isInCep, path } from "../cep.ts";
import type { EncodeRequest, EncodeResponse } from "./encodeWorker.ts";

type Pending = { resolve: (pngs: Partial<Record<PassId, Uint8Array>>) => void; reject: (error: Error) => void; bytes: number };

let workerUrl: string | null = null;

function scriptUrl(): string {
  if (workerUrl) return workerUrl;
  // file:// pages cannot start workers from disk, so the script travels as a blob.
  const code = isInCep() ? fs().readFileSync(path().join(extensionRoot(), "panel", "encode-worker.js"), "utf8") : "";
  workerUrl = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  return workerUrl;
}

export class EncodePool {
  readonly size: number;
  private readonly workers: Worker[] = [];
  private readonly idle: Worker[] = [];
  private readonly queue: { request: EncodeRequest; transfer: Transferable[] }[] = [];
  private readonly pending = new Map<number, Pending>();
  private readonly waiting: (() => void)[] = [];
  private nextId = 1;
  private inFlightBytes = 0;
  private failed: Error | null = null;

  constructor(size = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 2))) {
    this.size = size;
    for (let i = 0; i < size; i++) {
      const worker = new Worker(scriptUrl());
      worker.onmessage = (event: MessageEvent<EncodeResponse>) => this.finished(worker, event.data);
      worker.onerror = (event) => {
        this.failed = new Error(`encode worker failed: ${event.message}`);
        for (const p of this.pending.values()) p.reject(this.failed);
        this.pending.clear();
      };
      this.workers.push(worker);
      this.idle.push(worker);
    }
  }

  /** A worker crashed; the pool cannot be used any more. */
  get broken(): boolean {
    return this.failed !== null;
  }

  get busy(): boolean {
    return this.pending.size > 0;
  }

  /** Resolves once fewer than `maxFrames` frames and `maxBytes` bytes are in flight. */
  whenReady(maxFrames = this.size * 2, maxBytes = 1.5e9): Promise<void> {
    if (this.failed) return Promise.reject(this.failed);
    if (this.pending.size < maxFrames && this.inFlightBytes < maxBytes) return Promise.resolve();
    return new Promise((resolve) => this.waiting.push(() => void this.whenReady(maxFrames, maxBytes).then(resolve)));
  }

  /** Resolves once every submitted frame has finished. */
  async drain(): Promise<void> {
    while (this.pending.size > 0) await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  encode(width: number, height: number, renders: Partial<Record<RenderId, Uint8Array>>, passes: PassId[], opaque: PassId[] = []): Promise<Partial<Record<PassId, Uint8Array>>> {
    if (this.failed) return Promise.reject(this.failed);
    const id = this.nextId++;
    const buffers: Partial<Record<RenderId, ArrayBuffer>> = {};
    const transfer: Transferable[] = [];
    let bytes = 0;
    for (const [key, pixels] of Object.entries(renders)) {
      // Renders are fresh arrays from readPixels or accumulation; transfer them without copying.
      const buffer = pixels!.byteOffset === 0 && pixels!.byteLength === pixels!.buffer.byteLength ? pixels!.buffer : pixels!.slice().buffer;
      buffers[key as RenderId] = buffer as ArrayBuffer;
      transfer.push(buffer as ArrayBuffer);
      bytes += pixels!.byteLength;
    }
    this.inFlightBytes += bytes;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, bytes });
      this.queue.push({ request: { id, width, height, renders: buffers, passes, opaque }, transfer });
      this.pump();
    });
  }

  private pump(): void {
    while (this.idle.length && this.queue.length) {
      const worker = this.idle.pop()!;
      const job = this.queue.shift()!;
      worker.postMessage(job.request, job.transfer);
    }
  }

  private finished(worker: Worker, response: EncodeResponse): void {
    this.idle.push(worker);
    const pending = this.pending.get(response.id);
    this.pending.delete(response.id);
    if (pending) {
      this.inFlightBytes -= pending.bytes;
      if ("error" in response) pending.reject(new Error(response.error));
      else {
        const pngs: Partial<Record<PassId, Uint8Array>> = {};
        for (const [pass, buffer] of Object.entries(response.pngs)) pngs[pass as PassId] = new Uint8Array(buffer as ArrayBuffer);
        pending.resolve(pngs);
      }
    }
    this.pump();
    const waiting = this.waiting.splice(0);
    for (const wake of waiting) wake();
  }

  terminate(): void {
    for (const worker of this.workers) worker.terminate();
    this.workers.length = 0;
    this.idle.length = 0;
    for (const p of this.pending.values()) p.reject(new Error("encoder stopped"));
    this.pending.clear();
  }
}

let shared: EncodePool | null = null;

/** The panel-wide pool; a pool broken by a crashed worker is replaced, so one failure does not stick. */
export function sharedEncodePool(): EncodePool {
  if (shared?.broken) {
    shared.terminate();
    shared = null;
  }
  if (!shared) shared = new EncodePool();
  return shared;
}
