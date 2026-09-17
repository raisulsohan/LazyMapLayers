// Serves dist/panel on http://localhost:5179 for working on the interface in a normal browser,
// without After Effects. There is no host there: maps, renders and downloads do nothing, and the
// preview shows a plain background.
//
//   node tools/build.mjs --dev && node tools/serve-panel.mjs

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "panel");
const port = Number(process.env.PORT ?? 5179);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };

http
  .createServer((request, response) => {
    const name = decodeURIComponent((request.url ?? "/").split("?")[0]);
    const file = path.join(root, name === "/" ? "index.html" : name);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404).end("not found");
      return;
    }
    response.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    fs.createReadStream(file).pipe(response);
  })
  .listen(port, "127.0.0.1", () => console.log(`panel preview on http://localhost:${port}`));
