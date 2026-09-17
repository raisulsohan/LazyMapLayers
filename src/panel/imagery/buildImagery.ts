// Builds the optional imagery packs from public-domain whole-world rasters:
//
//   blue-marble.pmtiles   NASA Blue Marble Next Generation (satellite look), WebP tiles, zoom 0 to 5
//   relief.pmtiles        Natural Earth shaded relief as a shadow and highlight overlay with alpha
//
// Packs live in the user's data folder ("imagery"), not in the extension: they are large and optional.
// The builder runs inside the panel because Chromium decodes the sources and encodes WebP, and Node
// writes the archive with our own PMTiles writer. Sources: see tools/split-image.ps1 and docs/DATA.md.

import { buildMips, levelForZoom, modeOf, reliefToOverlay, sampleTile, type Raster } from "../../core/imagery/equirect.ts";
import { PMTILES_COMPRESSION, PMTILES_TILE_TYPE, PmtilesWriter } from "../../core/pmtiles/writer.ts";
import { fs, path } from "../cep.ts";
import { IMAGERY_INFO, imageryPath, type ImageryPack } from "./packs.ts";

const TILE = 512;
/** The sources are 21600 pixels wide, a little more than the world at zoom 5 (16384). */
const MAX_ZOOM = 5;

type Log = (line: string) => void;

function canvasOf(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2D canvas");
  return { canvas, context };
}

const toBytes = (canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> =>
  new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error("the tile could not be encoded"));
        else blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
      },
      "image/webp",
      quality
    )
  );

/** Cuts every tile of zoom 0 to MAX_ZOOM from the mips; `paint` turns sampled channels into RGBA. */
async function cutTiles(levels: Raster[], quality: number, paint: (sampled: Uint8Array, rgba: Uint8ClampedArray) => void, log: Log): Promise<PmtilesWriter> {
  const writer = new PmtilesWriter();
  const { canvas, context } = canvasOf(TILE, TILE);
  const image = context.createImageData(TILE, TILE);
  const sampled = new Uint8Array(TILE * TILE * levels[0].channels);
  for (let z = 0; z <= MAX_ZOOM; z++) {
    const level = levelForZoom(levels, z, TILE);
    const n = Math.pow(2, z);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        sampleTile(level, z, x, y, TILE, sampled);
        paint(sampled, image.data);
        context.putImageData(image, 0, 0);
        writer.addTile(z, x, y, await toBytes(canvas, quality));
      }
    }
    log(`zoom ${z}: ${n * n} tiles from the ${level.width} pixel level`);
  }
  return writer;
}

function save(pack: ImageryPack, writer: PmtilesWriter, source: string): { file: string; bytes: number; tiles: number } {
  const bytes = writer.build({
    tileType: PMTILES_TILE_TYPE.webp,
    tileCompression: PMTILES_COMPRESSION.none,
    metadata: { name: IMAGERY_INFO[pack].label, attribution: IMAGERY_INFO[pack].attribution, source, format: "webp", tileSize: TILE }
  });
  const file = imageryPath(pack);
  fs().mkdirSync(path().dirname(file), { recursive: true });
  const temporary = `${file}.part`;
  fs().writeFileSync(temporary, bytes);
  fs().renameSync(temporary, file);
  return { file, bytes: bytes.length, tiles: writer.tileCount };
}

/**
 * Blue Marble from a grid of PNG pieces (tools/split-image.ps1; Chromium cannot open the 21600 pixel
 * wide original whole). Pieces are scaled so the world is 16384 pixels wide, the width of zoom 5.
 */
export async function buildBlueMarble(piecesDir: string, columns: number, rows: number, log: Log): Promise<{ file: string; bytes: number; tiles: number }> {
  const width = TILE * Math.pow(2, MAX_ZOOM);
  const height = width / 2;
  const pieceWidth = width / columns;
  const pieceHeight = height / rows;
  const base = new Uint8Array(width * height * 3);
  const { canvas, context } = canvasOf(pieceWidth, pieceHeight);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const bytes = fs().readFileSync(path().join(piecesDir, `piece_${r}_${c}.png`));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      context.drawImage(bitmap, 0, 0, pieceWidth, pieceHeight);
      bitmap.close();
      const pixels = context.getImageData(0, 0, pieceWidth, pieceHeight).data;
      for (let y = 0; y < pieceHeight; y++) {
        let o = ((r * pieceHeight + y) * width + c * pieceWidth) * 3;
        let p = y * pieceWidth * 4;
        for (let x = 0; x < pieceWidth; x++, p += 4) {
          base[o++] = pixels[p];
          base[o++] = pixels[p + 1];
          base[o++] = pixels[p + 2];
        }
      }
    }
    log(`read row ${r + 1} of ${rows}`);
  }
  void canvas;
  const levels = buildMips({ width, height, channels: 3, data: base });
  const writer = await cutTiles(
    levels,
    0.86,
    (sampled, rgba) => {
      for (let p = 0, o = 0; p < sampled.length; p += 3, o += 4) {
        rgba[o] = sampled[p];
        rgba[o + 1] = sampled[p + 1];
        rgba[o + 2] = sampled[p + 2];
        rgba[o + 3] = 255;
      }
    },
    log
  );
  return save("blue-marble", writer, "https://visibleearth.nasa.gov/collection/1484/blue-marble (world.topo.bathy.200412, public domain)");
}

/** Reads an uncompressed 8-bit greyscale TIFF (the form Natural Earth ships its rasters in). */
function readGrayTiff(file: string): Raster {
  const node = fs();
  const fd = node.openSync(file, "r");
  try {
    const head = Buffer.alloc(8);
    node.readSync(fd, head, 0, 8, 0);
    const little = head.toString("latin1", 0, 2) === "II";
    const u16 = (b: Buffer, o: number) => (little ? b.readUInt16LE(o) : b.readUInt16BE(o));
    const u32 = (b: Buffer, o: number) => (little ? b.readUInt32LE(o) : b.readUInt32BE(o));
    if (u16(head, 2) !== 42) throw new Error("not a TIFF file");
    const ifdOffset = u32(head, 4);
    const countBuffer = Buffer.alloc(2);
    node.readSync(fd, countBuffer, 0, 2, ifdOffset);
    const count = u16(countBuffer, 0);
    const ifd = Buffer.alloc(count * 12);
    node.readSync(fd, ifd, 0, ifd.length, ifdOffset + 2);
    const tags = new Map<number, { type: number; count: number; valueOffset: number; at: number }>();
    for (let i = 0; i < count; i++) tags.set(u16(ifd, i * 12), { type: u16(ifd, i * 12 + 2), count: u32(ifd, i * 12 + 4), valueOffset: u32(ifd, i * 12 + 8), at: i * 12 + 8 });
    const single = (tag: number, fallback?: number): number => {
      const t = tags.get(tag);
      if (!t) {
        if (fallback !== undefined) return fallback;
        throw new Error(`TIFF tag ${tag} is missing`);
      }
      return t.type === 3 ? u16(ifd, t.at) : t.valueOffset;
    };
    const list = (tag: number): number[] => {
      const t = tags.get(tag);
      if (!t) throw new Error(`TIFF tag ${tag} is missing`);
      if (t.count === 1) return [single(tag)];
      const size = t.type === 3 ? 2 : 4;
      const buffer = Buffer.alloc(t.count * size);
      node.readSync(fd, buffer, 0, buffer.length, t.valueOffset);
      return Array.from({ length: t.count }, (_, i) => (size === 2 ? u16(buffer, i * 2) : u32(buffer, i * 4)));
    };
    const width = single(256);
    const height = single(257);
    if (single(259, 1) !== 1) throw new Error("the TIFF is compressed; only uncompressed files are read");
    if (single(258, 8) !== 8 || single(277, 1) !== 1) throw new Error("the TIFF is not 8-bit greyscale");
    const offsets = list(273);
    const lengths = list(279);
    const data = new Uint8Array(width * height);
    let at = 0;
    for (let s = 0; s < offsets.length; s++) {
      const length = Math.min(lengths[s], data.length - at);
      let done = 0;
      // Read in chunks: one call cannot exceed 2 GB, and smaller reads keep memory flat.
      while (done < length) {
        const step = Math.min(64 * 1048576, length - done);
        const view = Buffer.from(data.buffer, data.byteOffset + at + done, step);
        node.readSync(fd, view, 0, step, offsets[s] + done);
        done += step;
      }
      at += length;
    }
    return { width, height, channels: 1, data };
  } finally {
    node.closeSync(fd);
  }
}

export async function buildRelief(tiffFile: string, log: Log): Promise<{ file: string; bytes: number; tiles: number; flat: number }> {
  const base = readGrayTiff(tiffFile);
  log(`relief source ${base.width} x ${base.height}`);
  const flat = modeOf(base);
  const levels = buildMips(base);
  const writer = await cutTiles(levels, 0.75, (sampled, rgba) => reliefToOverlay(sampled, flat, rgba), log);
  return { ...save("relief", writer, "https://www.naturalearthdata.com/downloads/10m-raster-data/10m-shaded-relief/ (SR_HR, public domain)"), flat };
}
