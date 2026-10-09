// Encodes GIFs again from frames already rendered in .cache/manual/<name>/, without After Effects:
// for trying another size or palette, or bringing a GIF within budget.
//
//   node tools/manual/regif.mjs 03-flight-down [05-globe-to-flat ...] [--fps 12 --width 640 --colors 64]

import { encodeGif } from "./session.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? Number(args[i + 1]) : fallback; };
const names = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
for (const name of names) encodeGif(name, { fps: option("--fps", 12), width: option("--width", 640), colors: option("--colors", 64) });
