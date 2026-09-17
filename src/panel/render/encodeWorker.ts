// Web Worker: composes passes from a frame's renders and encodes them as PNG files, off the panel's
// main thread. Bundled on its own into dist/panel/encode-worker.js.

import { encodePng, flipAndFlatten, flipAndUnpremultiply } from "../../core/image/png.ts";
import { composePasses, type PassId, type RenderId } from "../../core/render/passes.ts";

export type EncodeRequest = {
  id: number;
  width: number;
  height: number;
  /** Premultiplied RGBA8, rows bottom-up, as read from WebGL. */
  renders: Partial<Record<RenderId, ArrayBuffer>>;
  passes: PassId[];
  /** Passes that are opaque by design (the base pass of a style with an opaque background). */
  opaque: PassId[];
};

export type EncodeResponse = { id: number; pngs: Partial<Record<PassId, ArrayBuffer>>; ms: number } | { id: number; error: string };

function isOpaque(rgba: Uint8Array): boolean {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) return false;
  return true;
}

const scope = self as unknown as { onmessage: ((event: MessageEvent<EncodeRequest>) => void) | null; postMessage: (message: EncodeResponse, transfer: Transferable[]) => void };

scope.onmessage = (event) => {
  const request = event.data;
  const started = performance.now();
  try {
    const renders: Partial<Record<RenderId, Uint8Array>> = {};
    for (const [id, buffer] of Object.entries(request.renders)) renders[id as RenderId] = new Uint8Array(buffer as ArrayBuffer);
    const composed = composePasses(renders, request.passes, request.width * request.height);
    const pngs: Partial<Record<PassId, ArrayBuffer>> = {};
    const transfer: Transferable[] = [];
    for (const pass of request.passes) {
      const premultiplied = composed[pass];
      if (!premultiplied) throw new Error(`pass ${pass} was not composed`);
      const flatten = request.opaque.includes(pass);
      const rgba = flatten ? flipAndFlatten(premultiplied, request.width, request.height) : flipAndUnpremultiply(premultiplied, request.width, request.height);
      const png = encodePng(rgba, request.width, request.height, { level: 1, opaque: flatten || isOpaque(rgba) });
      const buffer = png.buffer.byteLength === png.byteLength ? png.buffer : png.slice().buffer;
      pngs[pass] = buffer as ArrayBuffer;
      transfer.push(buffer as ArrayBuffer);
    }
    scope.postMessage({ id: request.id, pngs, ms: performance.now() - started }, transfer);
  } catch (error) {
    scope.postMessage({ id: request.id, error: error instanceof Error ? error.stack ?? error.message : String(error) }, []);
  }
};
