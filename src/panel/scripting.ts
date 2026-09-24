// The scripting API: another script leaves a request in a folder, the panel does it and writes the
// answer beside it. It is off unless the user turns it on, it only ever runs the calls listed in the
// handler table, and a request is data - nothing in a file is ever evaluated as code.
//
// A request is <name>.json in the folder; the answer is written as <name>.result.json and the request
// file is removed. docs/SCRIPTING.md has the calls and an ExtendScript helper.

import { parseApiRequest, type ApiAnswer } from "../core/data/apiRequest.ts";
import { fs, isInCep, path, userDataDir } from "./cep.ts";

export type ApiHandler = (args: Record<string, unknown>) => Promise<unknown> | unknown;
export type ApiHandlers = Record<string, ApiHandler>;

export const API_EVERY_MS = 1000;
/** Requests older than this are swept away unanswered, so a crash cannot leave a queue behind. */
export const API_STALE_MS = 10 * 60 * 1000;

export const apiDir = (): string => path().join(userDataDir(), "api");

const RESULT = ".result.json";

/** The request files waiting, oldest first. */
function waiting(): string[] {
  try {
    const names = fs().readdirSync(apiDir()) as string[];
    return names
      .filter((name) => name.endsWith(".json") && !name.endsWith(RESULT))
      .map((name) => {
        let at = 0;
        try {
          const stat = fs().statSync(path().join(apiDir(), name)) as { mtimeMs?: number; mtime?: Date };
          at = stat.mtimeMs ?? (stat.mtime ? stat.mtime.getTime() : 0);
        } catch {
          at = 0;
        }
        return { name, at };
      })
      .sort((a, b) => a.at - b.at)
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function answer(name: string, body: ApiAnswer): void {
  try {
    fs().writeFileSync(path().join(apiDir(), name.slice(0, -".json".length) + RESULT), JSON.stringify(body, null, 2), "utf8");
  } catch {
    // An answer that cannot be written is still logged in the panel.
  }
}

/**
 * Starts watching the request folder. Returns the function that stops it again; calling it twice is
 * safe.
 */
export function startScriptingApi(handlers: ApiHandlers, log: (text: string, kind?: "ok" | "fail" | "muted") => void): () => void {
  const known = Object.keys(handlers);
  let busy = false;
  try {
    fs().mkdirSync(apiDir(), { recursive: true });
  } catch {
    // Without the folder nothing arrives; the sweep finds none and says nothing.
  }
  const sweep = async () => {
    if (busy) return;
    const names = waiting();
    if (!names.length) return;
    busy = true;
    try {
      for (const name of names) {
        const file = path().join(apiDir(), name);
        let text = "";
        try {
          text = fs().readFileSync(file, "utf8") as string;
          fs().unlinkSync(file);
        } catch {
          continue;
        }
        const read = parseApiRequest(text, known);
        if ("error" in read) {
          log(`a script asked for something the panel cannot do: ${read.error}`, "fail");
          answer(name, { id: "", ok: false, error: read.error });
          continue;
        }
        const request = read.request;
        try {
          const result = await handlers[request.call](request.args);
          answer(name, { id: request.id, ok: true, result: result ?? null });
          log(`a script called ${request.call}`, "muted");
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          answer(name, { id: request.id, ok: false, error: message });
          log(`a script called ${request.call} and it failed: ${message}`, "fail");
        }
      }
    } finally {
      busy = false;
    }
  };
  const sweepOld = () => {
    const now = Date.now();
    for (const name of waiting()) {
      try {
        const file = path().join(apiDir(), name);
        const stat = fs().statSync(file) as { mtimeMs?: number; mtime?: Date };
        const at = stat.mtimeMs ?? (stat.mtime ? stat.mtime.getTime() : 0);
        if (now - at > API_STALE_MS) fs().unlinkSync(file);
      } catch {
        // Already gone.
      }
    }
  };
  if (isInCep()) sweepOld();
  const timer = setInterval(() => void sweep(), API_EVERY_MS);
  return () => clearInterval(timer);
}
