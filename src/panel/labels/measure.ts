// How wide a name is, measured in the panel with the fonts After Effects will use for its script.

import { SCRIPT_FONTS, type Script } from "../../core/labels/language.ts";

let measureContext: CanvasRenderingContext2D | null = null;

export function measure(text: string, script: Script, size: number, weight: number, tracking: number, italic = false): number {
  if (!measureContext) measureContext = document.createElement("canvas").getContext("2d");
  const family = SCRIPT_FONTS[script].css
    .split(",")
    .map((name) => `"${name.trim()}"`)
    .join(", ");
  measureContext!.font = `${italic ? "italic " : ""}${weight} ${size}px ${family}`;
  // After Effects tracking is in thousandths of an em per character.
  return measureContext!.measureText(text).width + (tracking / 1000) * size * [...text].length;
}
