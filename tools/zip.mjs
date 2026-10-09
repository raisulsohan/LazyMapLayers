/*
 * A small ZIP writer.
 *
 * Windows' own Compress-Archive writes nested paths with backslashes, which
 * the format does not allow: unzip warns about it and some tools can end up
 * with a single file literally named "client\main.js" instead of a folder.
 * The download is the one artefact every user touches, so it is built here
 * instead, with forward slashes and nothing else surprising in it.
 *
 * Same writer as the other Lazy tools' release scripts, with two additions:
 * an entry can carry a Unix mode (macOS's Archive Utility only makes a
 * `.command` installer double-clickable when the zip says it is executable),
 * and large files stream from disk into the zip, stored rather than deflated,
 * so the offline map data (gigabytes of tiles that are compressed already)
 * never has to fit in memory.
 */
import { crc32 as zlibCrc32, deflateRawSync } from "node:zlib";
import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";

/* CRC-32 (IEEE 802.3), the checksum every ZIP entry carries, continued over pieces. */
const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf, previous = 0) {
  if (zlibCrc32) return zlibCrc32(buf, previous) >>> 0;
  let c = (previous ^ 0xffffffff) >>> 0;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS packs a timestamp into two 16-bit words, with two-second resolution. */
function dosStamp(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/* Installer scripts a Mac user double-clicks. */
const EXECUTABLE = /\.(command|sh)$/i;

/* Files that are compressed already, and anything this large, are stored as they are and streamed. */
const STORE = /\.(pmtiles|zxp|zip|png|jpe?g|webp|gz)$/i;
const STREAM_FROM = 64 * 1024 * 1024;
const PIECE = 8 * 1024 * 1024;
/* Without ZIP64, offsets and sizes are 32-bit. */
const ZIP_LIMIT = 0xffffffff;

/** Every file under `dir`, as { name, path, mode? } with ZIP-shaped names. */
export function walk(dir, prefix = "") {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const path = join(dir, entry.name);
    const name = prefix + entry.name;
    if (entry.isDirectory()) out.push(...walk(path, name + "/"));
    else out.push(EXECUTABLE.test(entry.name) ? { name, path, mode: 0o755 } : { name, path });
  }
  return out;
}

function localHeader({ name, method, stamp, crc, compressed, size }) {
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);   // local file header
  local.writeUInt16LE(20, 4);           // version needed: 2.0
  local.writeUInt16LE(0x0800, 6);       // flags: names are UTF-8
  local.writeUInt16LE(method, 8);       // method: 0 store, 8 deflate
  local.writeUInt16LE(stamp.time, 10);
  local.writeUInt16LE(stamp.date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed, 18);
  local.writeUInt32LE(size, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);           // no extra field
  return local;
}

/**
 * Write `files` (from walk(), or any {name, path, mode?} list) to `outFile`.
 * Names are used exactly as given, so pass them with forward slashes.
 * Returns the size of the zip.
 */
export function writeZip(outFile, files) {
  const fd = openSync(outFile, "w");
  const central = [];
  let offset = 0;
  const put = (buffer, at = offset) => {
    writeSync(fd, buffer, 0, buffer.length, at);
    if (at === offset) offset += buffer.length;
  };

  try {
    for (const file of files) {
      const name = Buffer.from(file.name.split("\\").join("/"), "utf8");
      const info = statSync(file.path);
      const stamp = dosStamp(info.mtime);
      const start = offset;
      let method;
      let crc;
      let compressed;
      const size = info.size;

      if (STORE.test(file.name) || size >= STREAM_FROM) {
        // Stored and streamed: the header goes first with room for the checksum, which is known
        // only once every piece has passed, and is written into its place afterwards.
        method = 0;
        compressed = size;
        put(localHeader({ name, method, stamp, crc: 0, compressed, size }));
        put(name);
        const input = openSync(file.path, "r");
        const piece = Buffer.alloc(Math.min(PIECE, Math.max(1, size)));
        crc = 0;
        try {
          for (let read = 0; read < size; ) {
            const n = readSync(input, piece, 0, Math.min(piece.length, size - read), read);
            if (n <= 0) throw new Error(`${file.path} ended at ${read} of ${size} bytes`);
            const chunk = piece.subarray(0, n);
            crc = crc32(chunk, crc);
            put(chunk);
            read += n;
          }
        } finally {
          closeSync(input);
        }
        const fixed = Buffer.alloc(4);
        fixed.writeUInt32LE(crc, 0);
        put(fixed, start + 14);
      } else {
        const body = readFileSync(file.path);
        const deflated = deflateRawSync(body, { level: 9 });
        /* Deflate can grow a small or already-compressed file; store it then. */
        const stored = deflated.length >= body.length;
        const data = stored ? body : deflated;
        method = stored ? 0 : 8;
        crc = crc32(body);
        compressed = data.length;
        put(localHeader({ name, method, stamp, crc, compressed, size }));
        put(name);
        put(data);
      }
      if (offset > ZIP_LIMIT) throw new Error(`the zip passed 4 GB at ${file.name}; it would need ZIP64`);

      const entry = Buffer.alloc(46);
      entry.writeUInt32LE(0x02014b50, 0);   // central directory header
      /* "Made by" Unix (3) when a mode is given, so the mode is honoured. */
      entry.writeUInt16LE(file.mode ? (3 << 8) | 20 : 20, 4);
      entry.writeUInt16LE(20, 6);
      entry.writeUInt16LE(0x0800, 8);
      entry.writeUInt16LE(method, 10);
      entry.writeUInt16LE(stamp.time, 12);
      entry.writeUInt16LE(stamp.date, 14);
      entry.writeUInt32LE(crc, 16);
      entry.writeUInt32LE(compressed, 20);
      entry.writeUInt32LE(size, 24);
      entry.writeUInt16LE(name.length, 28);
      /* External attributes: a plain file, or a regular file with that mode. */
      entry.writeUInt32LE(file.mode ? ((0o100000 | file.mode) << 16) >>> 0 : 0, 38);
      entry.writeUInt32LE(start, 42);      // where its local header starts
      central.push(entry, name);
    }

    const dir = Buffer.concat(central);
    const dirOffset = offset;
    put(dir);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);       // end of central directory
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(dir.length, 12);
    end.writeUInt32LE(dirOffset, 16);
    put(end);
    if (offset > ZIP_LIMIT) throw new Error("the zip passed 4 GB; it would need ZIP64");
  } finally {
    closeSync(fd);
  }
  return statSync(outFile).size;
}
