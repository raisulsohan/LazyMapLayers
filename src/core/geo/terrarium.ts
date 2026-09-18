// Elevation from Terrarium-encoded tiles: each pixel holds metres as (red * 256 + green + blue / 256) - 32768.
// Sampling is bilinear between pixel centres, the way MapLibre reads its own terrain.

/** Metres at a pixel of a decoded tile (RGBA, `size` pixels wide). */
export function terrariumAt(rgba: Uint8Array | Uint8ClampedArray, size: number, x: number, y: number): number {
  const i = (Math.max(0, Math.min(size - 1, y)) * size + Math.max(0, Math.min(size - 1, x))) * 4;
  return rgba[i] * 256 + rgba[i + 1] + rgba[i + 2] / 256 - 32768;
}

/**
 * Metres at a position inside a tile, with `fx` and `fy` in [0, 1) across the tile, interpolated
 * between the four nearest pixel centres.
 */
export function sampleTerrarium(rgba: Uint8Array | Uint8ClampedArray, size: number, fx: number, fy: number): number {
  const px = Math.max(0, Math.min(size - 1, fx * size - 0.5));
  const py = Math.max(0, Math.min(size - 1, fy * size - 0.5));
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const x1 = Math.min(size - 1, x0 + 1);
  const y1 = Math.min(size - 1, y0 + 1);
  const tx = px - x0;
  const ty = py - y0;
  const top = terrariumAt(rgba, size, x0, y0) * (1 - tx) + terrariumAt(rgba, size, x1, y0) * tx;
  const bottom = terrariumAt(rgba, size, x0, y1) * (1 - tx) + terrariumAt(rgba, size, x1, y1) * tx;
  return top * (1 - ty) + bottom * ty;
}

/** The tile at `zoom` that holds a position, and where inside it the position lies (fractions in [0, 1)). */
export function tileOf(lat: number, lng: number, zoom: number): { z: number; x: number; y: number; fx: number; fy: number } {
  const n = 2 ** zoom;
  const clamped = Math.max(-85.051129, Math.min(85.051129, lat));
  const xf = ((((lng + 180) / 360) % 1) + 1) % 1 * n;
  const yf = ((1 - Math.log(Math.tan((clamped * Math.PI) / 180) + 1 / Math.cos((clamped * Math.PI) / 180)) / Math.PI) / 2) * n;
  const x = Math.min(n - 1, Math.floor(xf));
  const y = Math.min(n - 1, Math.floor(yf));
  return { z: zoom, x, y, fx: xf - x, fy: yf - y };
}
