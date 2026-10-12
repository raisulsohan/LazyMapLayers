// A picture's size from the first bytes of its file (PNG, JPEG, WebP, GIF), without decoding it: the
// panel reads one tile of a folder or an MBTiles file to know whether its tiles are 256 or 512
// pixels wide (D103).

export type ImageSize = { width: number; height: number; format: "png" | "jpg" | "webp" | "gif" };

export function imageSize(b: Uint8Array): ImageSize | null {
  const u16be = (at: number) => (b[at] << 8) | b[at + 1];
  const u16le = (at: number) => b[at] | (b[at + 1] << 8);
  const u24le = (at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
  const u32be = (at: number) => b[at] * 0x1000000 + ((b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]);
  const text = (at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
  if (b.length >= 24 && b[0] === 0x89 && text(1, 3) === "PNG" && text(12, 4) === "IHDR") return { width: u32be(16), height: u32be(20), format: "png" };
  if (b.length >= 10 && text(0, 4) === "GIF8") return { width: u16le(6), height: u16le(8), format: "gif" };
  if (b.length >= 30 && text(0, 4) === "RIFF" && text(8, 4) === "WEBP") {
    const chunk = text(12, 4);
    if (chunk === "VP8 " && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff, format: "webp" };
    if (chunk === "VP8L" && b[20] === 0x2f) return { width: 1 + (((b[22] & 0x3f) << 8) | b[21]), height: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)), format: "webp" };
    if (chunk === "VP8X") return { width: 1 + u24le(24), height: 1 + u24le(27), format: "webp" };
    return null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let at = 2;
    while (at + 9 < b.length) {
      if (b[at] !== 0xff) return null;
      const marker = b[at + 1];
      if (marker === 0xff) {
        at++;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        at += 2;
        continue;
      }
      // A start of frame (any but the Huffman table, JPEG-arithmetic and arithmetic table markers).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: u16be(at + 7), height: u16be(at + 5), format: "jpg" };
      at += 2 + u16be(at + 2);
    }
  }
  return null;
}

/** The tile size to draw a source with, from one of its tiles: 512 when it is 512 wide, else 256. */
export const tileSizeOf = (bytes: Uint8Array | null): 256 | 512 => (bytes && imageSize(bytes)?.width === 512 ? 512 : 256);
