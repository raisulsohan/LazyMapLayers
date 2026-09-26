// Mapbox Vector Tiles, read: the tiles of a downloaded region, decoded so the panel can find the
// names in them (neighbourhoods, landmarks, rivers, streets) without asking the renderer.
//
// The format is a protocol buffer: a tile holds layers, a layer holds features plus the keys and
// values their tags point into, and a feature's geometry is a run of move, line and close commands
// with zigzag-encoded deltas. Only the layers asked for are decoded; the rest are skipped whole.

export type TileValue = string | number | boolean;
export type TileFeature = {
  /** 1 point, 2 line, 3 polygon. */
  type: 1 | 2 | 3;
  properties: Record<string, TileValue>;
  /** Points, lines, or rings, in tile coordinates (0 to extent, y down). */
  geometry: number[][][];
};
export type TileLayer = { name: string; extent: number; features: TileFeature[] };

class Reader {
  pos = 0;
  bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }
  get done(): boolean {
    return this.pos >= this.bytes.length;
  }
  varint(): number {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = this.bytes[this.pos++];
      // Past 2^31 the bitwise operators would wrap; multiplication keeps it exact to 2^53.
      result += (byte & 0x7f) * Math.pow(2, shift);
      shift += 7;
    } while (byte & 0x80 && this.pos < this.bytes.length);
    return result;
  }
  svarint(): number {
    const n = this.varint();
    return n % 2 === 1 ? -(n + 1) / 2 : n / 2;
  }
  bytesField(): Uint8Array {
    const length = this.varint();
    const out = this.bytes.subarray(this.pos, this.pos + length);
    this.pos += length;
    return out;
  }
  string(): string {
    return new TextDecoder().decode(this.bytesField());
  }
  double(): number {
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.pos, 8);
    this.pos += 8;
    return view.getFloat64(0, true);
  }
  float(): number {
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.pos, 4);
    this.pos += 4;
    return view.getFloat32(0, true);
  }
  skip(wire: number): void {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) this.pos += this.varint();
    else if (wire === 5) this.pos += 4;
    else throw new Error(`vector tile: wire type ${wire} is not supported`);
  }
  packed(): number[] {
    const end = this.varint() + this.pos;
    const out: number[] = [];
    while (this.pos < end) out.push(this.varint());
    return out;
  }
}

function readValue(bytes: Uint8Array): TileValue {
  const r = new Reader(bytes);
  let value: TileValue = "";
  while (!r.done) {
    const tag = r.varint();
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (field === 1) value = r.string();
    else if (field === 2) value = r.float();
    else if (field === 3) value = r.double();
    else if (field === 4 || field === 5) value = r.varint();
    else if (field === 6) value = r.svarint();
    else if (field === 7) value = r.varint() !== 0;
    else r.skip(wire);
  }
  return value;
}

function readGeometry(commands: number[]): number[][][] {
  const parts: number[][][] = [];
  let current: number[][] | null = null;
  let x = 0;
  let y = 0;
  let i = 0;
  while (i < commands.length) {
    const command = commands[i] & 0x7;
    const count = Math.floor(commands[i] / 8);
    i++;
    if (command === 7) {
      if (current && current.length) current.push([current[0][0], current[0][1]]);
      continue;
    }
    for (let n = 0; n < count && i + 1 < commands.length; n++) {
      const dx = commands[i++];
      const dy = commands[i++];
      x += dx % 2 === 1 ? -(dx + 1) / 2 : dx / 2;
      y += dy % 2 === 1 ? -(dy + 1) / 2 : dy / 2;
      if (command === 1) {
        current = [];
        parts.push(current);
      }
      current?.push([x, y]);
    }
  }
  return parts;
}

function readLayer(bytes: Uint8Array, wanted: Set<string> | null): TileLayer | null {
  const r = new Reader(bytes);
  let name = "";
  let extent = 4096;
  const rawFeatures: Uint8Array[] = [];
  const keys: string[] = [];
  const values: TileValue[] = [];
  while (!r.done) {
    const tag = r.varint();
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (field === 1) {
      name = r.string();
      // The name comes first in every encoder we know; stop early for a layer nobody wants.
      if (wanted && !wanted.has(name)) return null;
    } else if (field === 2) rawFeatures.push(r.bytesField());
    else if (field === 3) keys.push(r.string());
    else if (field === 4) values.push(readValue(r.bytesField()));
    else if (field === 5) extent = r.varint();
    else r.skip(wire);
  }
  if (wanted && !wanted.has(name)) return null;
  const features: TileFeature[] = rawFeatures.map((raw) => {
    const f = new Reader(raw);
    let type: 1 | 2 | 3 = 1;
    let tags: number[] = [];
    let geometry: number[] = [];
    while (!f.done) {
      const tag = f.varint();
      const field = Math.floor(tag / 8);
      const wire = tag & 7;
      if (field === 2) tags = f.packed();
      else if (field === 3) type = f.varint() as 1 | 2 | 3;
      else if (field === 4) geometry = f.packed();
      else f.skip(wire);
    }
    const properties: Record<string, TileValue> = {};
    for (let t = 0; t + 1 < tags.length; t += 2) {
      const key = keys[tags[t]];
      if (key !== undefined && tags[t + 1] < values.length) properties[key] = values[tags[t + 1]];
    }
    return { type, properties, geometry: readGeometry(geometry) };
  });
  return { name, extent, features };
}

/** The layers of a tile (already decompressed), or only the ones named. */
export function decodeTile(bytes: Uint8Array, layers?: string[]): TileLayer[] {
  const wanted = layers ? new Set(layers) : null;
  const r = new Reader(bytes);
  const out: TileLayer[] = [];
  while (!r.done) {
    const tag = r.varint();
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (field === 3) {
      const layer = readLayer(r.bytesField(), wanted);
      if (layer) out.push(layer);
    } else r.skip(wire);
  }
  return out;
}

/** A point of tile z/x/y in longitude and latitude. */
export function tilePointToLngLat(z: number, x: number, y: number, extent: number, px: number, py: number): [number, number] {
  const n = Math.pow(2, z);
  const lng = ((x + px / extent) / n) * 360 - 180;
  const k = Math.PI - (2 * Math.PI * (y + py / extent)) / n;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(k) - Math.exp(-k)));
  return [lng, lat];
}
