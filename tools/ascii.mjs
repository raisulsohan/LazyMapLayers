// ExtendScript reads BOM-less .jsx files in the system code page, so every script we hand to
// After Effects is kept pure ASCII: characters above "~" become backslash-u escapes, which are
// valid in string literals and harmless in comments.
//
//   node tools/ascii.mjs <file.jsx> [...]      rewrite files in place

import fs from "node:fs";

const BACKSLASH = String.fromCharCode(92);

export function toAsciiEscapes(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0xfeff && i === 0) continue;
    out += code > 126 ? BACKSLASH + "u" + code.toString(16).toUpperCase().padStart(4, "0") : text[i];
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith("ascii.mjs")) {
  for (const file of process.argv.slice(2)) {
    const before = fs.readFileSync(file, "utf8");
    const after = toAsciiEscapes(before);
    if (after !== before) {
      fs.writeFileSync(file, after, "utf8");
      console.log(`escaped ${file}`);
    }
  }
}
