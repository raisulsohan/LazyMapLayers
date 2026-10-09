// A one-off look into the running panel while writing a chapter script.
//
//   node tools/manual/poke.mjs js "<expression in the panel>"
//   node tools/manual/poke.mjs ae "<ExtendScript>"
//   node tools/manual/poke.mjs shot <name>            (docs/manual/media/<name>.png)
//   node tools/manual/poke.mjs gif <name> <start> <seconds>   (the active comp)
//   node tools/manual/poke.mjs still <name> <time>

import { openSession } from "./session.mjs";

const [what, arg] = process.argv.slice(2);
const s = await openSession();
try {
  if (what === "js") console.log(JSON.stringify(await s.js(arg), null, 1));
  else if (what === "ae") console.log(await s.ae(arg));
  else if (what === "shot") await s.shot(arg);
  else if (what === "gif") await s.gif(arg, { start: Number(process.argv[4] ?? 0), duration: Number(process.argv[5] ?? 4) });
  else if (what === "still") await s.still(arg, { time: Number(process.argv[4] ?? 0) });
  else console.log("js | ae | shot");
} finally {
  s.close();
}
