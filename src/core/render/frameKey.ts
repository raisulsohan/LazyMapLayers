// Content keys for rendered frames. A key covers everything that changes the pixels of one pass of one
// frame: renderer version, style, data archive, output size, supersampling and the camera views of
// every motion blur sample. Equal keys mean equal images, so a frame whose key is already in the cache
// is never rendered again: re-renders after a keyframe change only redraw the frames that changed,
// held shots render once, and a cancelled render resumes where it stopped.

/** Bump when a renderer change alters output pixels, so old cache entries stop matching. */
export const RENDERER_VERSION = "lml-render-2";

/** JSON with object keys sorted, so equal values always serialise to the same text. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) return "null";
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(",")}}`;
}

/**
 * 64-bit hash of a string as 16 hex digits (two independent 32-bit murmur-style lanes). Not
 * cryptographic; collisions are negligible for cache sizes of millions of frames.
 */
export function hash64(text: string): string {
  let h1 = 0xdeadbeef ^ text.length;
  let h2 = 0x41c6ce57 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return hex(h2) + hex(h1);
}

export function keyOf(value: unknown): string {
  return hash64(canonicalJson(value));
}
