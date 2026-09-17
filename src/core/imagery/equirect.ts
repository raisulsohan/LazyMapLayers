// Cuts a whole-world image in the equirectangular projection (plate carrée: longitude and latitude
// spaced evenly, as NASA and Natural Earth publish their rasters) into Web Mercator tiles.
//
// Longitude is linear in both projections, so columns map straight across; rows go through the
// Mercator latitude formula. A mip pyramid (2 x 2 box filter) keeps low zooms free of aliasing, and
// samples are bilinear with wrap-around in longitude.

import { latFromMercatorY } from "../geo/mercator.ts";

export type Raster = { width: number; height: number; channels: number; data: Uint8Array };

/** The image and its halvings down to about 256 pixels wide. */
export function buildMips(base: Raster): Raster[] {
  const levels = [base];
  let current = base;
  while (current.width > 256 && current.height > 128) {
    const width = current.width >> 1;
    const height = current.height >> 1;
    const c = current.channels;
    const data = new Uint8Array(width * height * c);
    const src = current.data;
    const stride = current.width * c;
    for (let y = 0; y < height; y++) {
      const row0 = 2 * y * stride;
      const row1 = row0 + stride;
      let o = y * width * c;
      for (let x = 0; x < width; x++) {
        const a = row0 + 2 * x * c;
        const b = row1 + 2 * x * c;
        for (let k = 0; k < c; k++) data[o++] = (src[a + k] + src[a + c + k] + src[b + k] + src[b + c + k] + 2) >> 2;
      }
    }
    current = { width, height, channels: c, data };
    levels.push(current);
  }
  return levels;
}

/** The level whose width is closest above the world's width in pixels at a zoom (512-pixel tiles). */
export function levelForZoom(levels: Raster[], zoom: number, tileSize = 512): Raster {
  const worldWidth = tileSize * Math.pow(2, zoom);
  let best = levels[0];
  for (const level of levels) if (level.width >= worldWidth) best = level;
  return best;
}

/** Samples one tile into `out` (tileSize * tileSize * channels bytes, rows top-down). */
export function sampleTile(level: Raster, z: number, x: number, y: number, tileSize: number, out: Uint8Array): void {
  const { width, height, channels: c, data } = level;
  const scale = Math.pow(2, z);
  // Source columns for every output column (pixel centres), wrapped in longitude.
  const x0 = new Int32Array(tileSize);
  const x1 = new Int32Array(tileSize);
  const fx = new Float32Array(tileSize);
  for (let i = 0; i < tileSize; i++) {
    const u = (x + (i + 0.5) / tileSize) / scale;
    const sx = u * width - 0.5;
    const left = Math.floor(sx);
    fx[i] = sx - left;
    x0[i] = ((left % width) + width) % width;
    x1[i] = (x0[i] + 1) % width;
  }
  let o = 0;
  for (let j = 0; j < tileSize; j++) {
    const lat = latFromMercatorY((y + (j + 0.5) / tileSize) / scale);
    const sy = ((90 - lat) / 180) * height - 0.5;
    const top = Math.max(0, Math.min(height - 1, Math.floor(sy)));
    const bottom = Math.min(height - 1, top + 1);
    const fy = Math.max(0, Math.min(1, sy - top));
    const rowTop = top * width * c;
    const rowBottom = bottom * width * c;
    for (let i = 0; i < tileSize; i++) {
      const a = x0[i] * c;
      const b = x1[i] * c;
      const wx = fx[i];
      for (let k = 0; k < c; k++) {
        const upper = data[rowTop + a + k] * (1 - wx) + data[rowTop + b + k] * wx;
        const lower = data[rowBottom + a + k] * (1 - wx) + data[rowBottom + b + k] * wx;
        out[o++] = (upper * (1 - fy) + lower * fy + 0.5) | 0;
      }
    }
  }
}

/** The most common value of a one-channel image (the flat ground of a shaded relief). */
export function modeOf(raster: Raster, step = 7): number {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < raster.data.length; i += raster.channels * step) histogram[raster.data[i]]++;
  let best = 0;
  for (let v = 1; v < 256; v++) if (histogram[v] > histogram[best]) best = v;
  return best;
}

export type ReliefOptions = {
  /** Strength of the shading. Default 1.6. */
  gain?: number;
  /** Shading weaker than this fraction is dropped, so flat land stays clean and tiles stay small. Default 0.04. */
  deadZone?: number;
  /** Number of alpha steps. The alpha channel is stored without loss, so fewer steps mean far smaller tiles. Default 32. */
  alphaLevels?: number;
};

/**
 * Turns shaded-relief greys into an overlay: shadows become black and highlights white, with an alpha
 * that grows with the distance from the flat grey, so flat land and sea stay untouched.
 * `gray` holds one byte per pixel; `rgba` receives four.
 */
export function reliefToOverlay(gray: Uint8Array, flat: number, rgba: Uint8ClampedArray | Uint8Array, options: ReliefOptions = {}): void {
  const gain = options.gain ?? 1.6;
  const deadZone = options.deadZone ?? 0.04;
  const step = 255 / Math.max(1, (options.alphaLevels ?? 32) - 1);
  const below = Math.max(1, flat);
  const above = Math.max(1, 255 - flat);
  for (let p = 0, o = 0; p < gray.length; p++, o += 4) {
    const g = gray[p];
    const shadow = g < flat;
    const amount = shadow ? (flat - g) / below : (g - flat) / above;
    const alpha = amount < deadZone ? 0 : Math.min(255, Math.round(Math.round((255 * Math.min(1, amount * gain)) / step) * step));
    // Transparent pixels are black, so their colour never costs bytes.
    const value = shadow || alpha === 0 ? 0 : 255;
    rgba[o] = value;
    rgba[o + 1] = value;
    rgba[o + 2] = value;
    rgba[o + 3] = alpha;
  }
}
