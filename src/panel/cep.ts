// Thin bridge to the CEP runtime and to Node (enabled with --enable-nodejs --mixed-context).
// Written from the public CEP API surface (window.__adobe_cep__) so we do not ship Adobe's
// CSInterface.js.

type AdobeCep = {
  evalScript: (script: string, callback: (result: string) => void) => void;
  getSystemPath: (pathType: string) => string;
  getHostEnvironment: () => string;
  addEventListener: (type: string, listener: (event: { data?: string }) => void) => void;
  closeExtension: () => void;
};

type NodeRequire = (id: string) => unknown;

declare global {
  interface Window {
    __adobe_cep__?: AdobeCep;
    cep_node?: { require: NodeRequire };
    require?: NodeRequire;
  }
}

export type NodeFs = typeof import("node:fs");
export type NodePath = typeof import("node:path");
export type NodeOs = typeof import("node:os");

export function isInCep(): boolean {
  return typeof window !== "undefined" && !!window.__adobe_cep__;
}

export function nodeRequire<T>(id: string): T {
  const req = window.cep_node?.require ?? window.require;
  if (!req) throw new Error("Node.js is not available in this panel");
  return req(id) as T;
}

export const fs = () => nodeRequire<NodeFs>("fs");
export const path = () => nodeRequire<NodePath>("path");
export const os = () => nodeRequire<NodeOs>("os");

/**
 * The user's LazyMapLayers data folder (downloaded regions, render cache, render queue):
 * %APPDATA%LazyMapLayers on Windows, ~/Library/Application Support/LazyMapLayers on macOS.
 */
export function userDataDir(): string {
  if (process.platform === "darwin") return path().join(os().homedir(), "Library", "Application Support", "LazyMapLayers");
  return path().join(process.env.APPDATA ?? path().join(os().homedir(), "AppData", "Roaming"), "LazyMapLayers");
}

/** Folder that contains CSXS/, panel/ and host/. */
export function extensionRoot(): string {
  const cep = window.__adobe_cep__;
  if (!cep) throw new Error("not running inside CEP");
  const raw = decodeURI(cep.getSystemPath("extension"));
  return raw.replace(/^file:\/{2,3}/, "");
}

export function hostEnvironment(): { appName: string; appVersion: string; appLocale: string } {
  const cep = window.__adobe_cep__;
  if (!cep) return { appName: "browser", appVersion: "0", appLocale: "en_US" };
  return JSON.parse(cep.getHostEnvironment());
}

/** Runs ExtendScript and resolves with its string result. "EvalScript error." rejects. */
export function evalScript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const cep = window.__adobe_cep__;
    if (!cep) {
      reject(new Error("not running inside CEP"));
      return;
    }
    cep.evalScript(script, (result) => {
      if (result === "EvalScript error.") reject(new Error(`ExtendScript failed: ${script.slice(0, 120)}`));
      else resolve(result);
    });
  });
}

export type HostResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };

/**
 * Calls a host API function `LML.api.<name>` with JSON arguments. Arguments travel as a JSON
 * string literal, so anything JSON can hold (including Unicode text) arrives intact.
 * Large payloads should go through a job file instead (see `callHostWithJobFile`).
 */
export async function callHost<T>(name: string, args: unknown = {}): Promise<T> {
  // Non-ASCII characters become \uXXXX escapes so the script text itself stays pure ASCII.
  const json = asciiOnly(JSON.stringify(JSON.stringify(args)));
  const raw = await evalScript(`LML.call(${JSON.stringify(name)}, ${json})`);
  let parsed: HostResult<T>;
  try {
    parsed = JSON.parse(raw) as HostResult<T>;
  } catch {
    throw new Error(`host returned non-JSON for ${name}: ${raw.slice(0, 200)}`);
  }
  if (!parsed.ok) throw new Error(`${parsed.error.code}: ${parsed.error.message}`);
  return parsed.value;
}

export function asciiOnly(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out += code > 126 ? String.fromCharCode(92) + "u" + code.toString(16).padStart(4, "0") : text[i];
  }
  return out;
}

/** Writes the arguments to a temporary UTF-8 JSON file and passes its path to the host. */
export async function callHostWithJobFile<T>(name: string, args: unknown): Promise<T> {
  const p = path();
  const dir = p.join(os().tmpdir(), "LazyMapLayers", "jobs");
  fs().mkdirSync(dir, { recursive: true });
  const file = p.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs().writeFileSync(file, JSON.stringify(args), "utf8");
  try {
    return await callHost<T>(name, { jobFile: file });
  } finally {
    try {
      fs().unlinkSync(file);
    } catch {
      // The host may still hold the file on slow disks; the temp folder is cleaned on start.
    }
  }
}
