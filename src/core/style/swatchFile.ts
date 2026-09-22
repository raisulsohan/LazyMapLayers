// Palettes as designers keep them: Adobe's swatch exchange (.ase), which Illustrator, Photoshop and
// InDesign all write, and the older colour table (.act). Both are read here so a studio's palette
// can become a map look.
//
// The .ase layout, as Adobe documents it: the signature "ASEF", two version numbers, a count, and
// then that many blocks. A block is a type (colour entry, group start, group end), a length, a name
// in UTF-16, a four-letter colour model and its numbers.

export type Swatch = { name: string; hex: string };

const SIGNATURE = 0x41534546; // "ASEF"

/** Reads the big-endian numbers and UTF-16 names of a swatch file, in order. */
function reader(view: DataView) {
  let at = 0;
  return {
    left: () => view.byteLength - at,
    position: () => at,
    uint16: () => {
      const value = view.getUint16(at);
      at += 2;
      return value;
    },
    uint32: () => {
      const value = view.getUint32(at);
      at += 4;
      return value;
    },
    float: () => {
      const value = view.getFloat32(at);
      at += 4;
      return value;
    },
    text: (length: number) => {
      let out = "";
      for (let i = 0; i < length; i++) out += String.fromCharCode(view.getUint16(at + i * 2));
      at += length * 2;
      return out.replace(/\0+$/, "");
    },
    ascii: (length: number) => {
      let out = "";
      for (let i = 0; i < length; i++) out += String.fromCharCode(view.getUint8(at + i));
      at += length;
      return out;
    },
    skip: (bytes: number) => {
      at += bytes;
    },
    seek: (to: number) => {
      at = to;
    }
  };
}

const clamp255 = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => clamp255(v).toString(16).padStart(2, "0")).join("")}`;

/** CIE L*a*b* to sRGB, through XYZ with the D50 white point Adobe writes. */
export function labToHex(l: number, a: number, b: number): string {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const f = (t: number) => (t > 6 / 29 ? t * t * t : 3 * (6 / 29) * (6 / 29) * (t - 4 / 29));
  // D50, which is what Adobe's Lab values are relative to.
  const x = 0.9642 * f(fx);
  const y = 1.0 * f(fy);
  const z = 0.8249 * f(fz);
  // D50 XYZ to linear sRGB (Bradford-adapted).
  const lr = 3.1338561 * x - 1.6168667 * y - 0.4906146 * z;
  const lg = -0.9787684 * x + 1.9161415 * y + 0.033454 * z;
  const lb = 0.0719453 * x - 0.2289914 * y + 1.4052427 * z;
  const gamma = (value: number) => {
    const v = Math.max(0, Math.min(1, value));
    return (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255;
  };
  return hex(gamma(lr), gamma(lg), gamma(lb));
}

export const cmykToHex = (c: number, m: number, y: number, k: number): string => hex(255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k));

/** The colours of an .ase file, in the order they are in it. Groups are read through. */
export function readAse(bytes: Uint8Array): Swatch[] {
  if (bytes.length < 12) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const read = reader(view);
  if (read.uint32() !== SIGNATURE) return [];
  read.skip(4); // The two version numbers, which have only ever been 1.0.
  const blocks = read.uint32();
  const out: Swatch[] = [];
  for (let block = 0; block < blocks && read.left() > 6; block++) {
    const type = read.uint16();
    const length = read.uint32();
    const ends = read.position() + length;
    if (type === 0x0001 && length >= 2) {
      const name = read.text(read.uint16());
      const model = read.ascii(4);
      if (model === "RGB " && read.left() >= 12) out.push({ name, hex: hex(read.float() * 255, read.float() * 255, read.float() * 255) });
      else if (model === "CMYK" && read.left() >= 16) out.push({ name, hex: cmykToHex(read.float(), read.float(), read.float(), read.float()) });
      else if (model === "LAB " && read.left() >= 12) out.push({ name, hex: labToHex(read.float() * 100, read.float(), read.float()) });
      else if (model === "Gray" && read.left() >= 4) {
        const grey = read.float() * 255;
        out.push({ name, hex: hex(grey, grey, grey) });
      }
    }
    // Whatever the block held, the next one starts where its length says.
    read.seek(ends);
  }
  return out;
}

/** The colours of an .act file: 256 triplets, sometimes with a count at the end. */
export function readAct(bytes: Uint8Array): Swatch[] {
  if (bytes.length < 768) return [];
  let count = 256;
  if (bytes.length >= 770) {
    const stated = (bytes[768] << 8) | bytes[769];
    if (stated > 0 && stated <= 256) count = stated;
  }
  const out: Swatch[] = [];
  for (let i = 0; i < count; i++) out.push({ name: `Colour ${i + 1}`, hex: hex(bytes[i * 3], bytes[i * 3 + 1], bytes[i * 3 + 2]) });
  // A table padded out with black says nothing; only the colours that differ are kept.
  const trimmed = out.filter((swatch, index) => swatch.hex !== "#000000" || index === 0);
  return trimmed.length ? trimmed : out;
}

/** The colours of a palette file, whichever kind it is. */
export function readSwatchFile(name: string, bytes: Uint8Array): Swatch[] {
  const kind = (name.split(".").pop() ?? "").toLowerCase();
  if (kind === "act") return readAct(bytes);
  return readAse(bytes);
}
