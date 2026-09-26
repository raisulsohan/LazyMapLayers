// Pictures in a label design of the user's own: a layer in the design comp named like "{flag}" is
// filled, place by place, with a picture from a folder the user chose. A flag of Bangladesh can be
// called BGD.png, BD.png, bangladesh.png or Bangladesh flag.jpg; the picture is found by the
// place's codes first and its names after, so a folder downloaded from anywhere just works.

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "tif", "tiff", "psd", "ai", "gif", "bmp", "tga", "exr"];

/** A file name reduced to what is compared: no extension, no case, no accents, no punctuation. */
export function imageKey(name: string): string {
  return name
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .normalize("NFD")
    .replace(new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g"), "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Words that name the picture rather than the place, dropped when a name is compared. */
const NOISE = new Set(["flag", "flags", "of", "the", "logo", "icon", "image", "photo", "map"]);

const bare = (key: string) =>
  key
    .split(" ")
    .filter((word) => !NOISE.has(word))
    .join(" ");

/** The pictures of a folder by every key they answer to. */
export function imageIndex(files: string[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const file of files) {
    const base = file.split(/[\\/]/).pop() ?? file;
    const ext = (base.match(/\.([a-z0-9]{2,4})$/i)?.[1] ?? "").toLowerCase();
    if (!IMAGE_EXTENSIONS.includes(ext)) continue;
    const key = imageKey(base);
    for (const k of [key, bare(key)]) if (k && !index.has(k)) index.set(k, file);
  }
  return index;
}

/**
 * The picture for a place: tried by its codes (BGD, BD), then by each of its names. `codes` and
 * `names` come in the order they should win.
 */
export function imageFor(index: Map<string, string>, codes: (string | null | undefined)[], names: (string | null | undefined)[]): string | null {
  for (const value of [...codes, ...names]) {
    if (!value) continue;
    const key = imageKey(value);
    const hit = index.get(key) ?? index.get(bare(key));
    if (hit) return hit;
  }
  return null;
}

/** The size a picture takes to fit its placeholder's box and keep its shape, as a layer scale in percent. */
export function fitScale(box: { width: number; height: number }, picture: { width: number; height: number }, placeholderScale: number): number {
  if (!(picture.width > 0 && picture.height > 0 && box.width > 0 && box.height > 0)) return placeholderScale;
  return placeholderScale * Math.min(box.width / picture.width, box.height / picture.height);
}
