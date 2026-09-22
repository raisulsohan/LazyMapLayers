// A look as a file, so it can be kept, shared with a studio, or dropped into another project. It is
// plain JSON: the look it was built from, the colours the designer chose, and a name.

import { normaliseLook, type LookOverride } from "./customLook.ts";

export type LookFile = { lml: "look"; v: 1; name: string; base: string; colours: LookOverride };

export const LOOK_FILE_EXTENSION = ".lmllook.json";

/** The file to write for a look. */
export function writeLookFile(name: string, base: string, colours: LookOverride): string {
  const file: LookFile = { lml: "look", v: 1, name: (name || "Look").slice(0, 80), base: base || "midnight", colours: normaliseLook(colours) };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** What a look file holds, or null when it is not one. */
export function readLookFile(text: string): { name: string; base: string; colours: LookOverride } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const file = (parsed ?? {}) as Partial<LookFile>;
  if (file.lml !== "look") return null;
  const colours = normaliseLook(file.colours);
  return {
    name: typeof file.name === "string" && file.name.trim() ? file.name.trim().slice(0, 80) : "Look",
    base: typeof file.base === "string" && /^[a-z0-9-]{2,20}$/i.test(file.base) ? file.base : "midnight",
    colours
  };
}

/** A file name that will not upset Windows, macOS or a zip. */
export const lookFileName = (name: string): string => `${(name || "Look").replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "Look"}${LOOK_FILE_EXTENSION}`;
