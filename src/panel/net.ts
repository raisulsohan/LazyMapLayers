// Network access through Node's https module, so browser CORS rules do not apply. The panel only
// goes online when the user asks for a download.

import { nodeRequire } from "./cep.ts";

type NodeHttps = typeof import("node:https");

export type HttpResponse = { status: number; body: Uint8Array; headers: Record<string, string | string[] | undefined> };

export type HttpOptions = {
  headers?: Record<string, string>;
  /** HEAD asks for the headers alone (a file's size before it is downloaded); POST sends `body`. */
  method?: "GET" | "HEAD" | "POST";
  /** The body of a POST (Overpass takes its query this way). */
  body?: string;
  signal?: AbortSignal;
  onProgress?: (receivedBytes: number, totalBytes: number | null) => void;
};

let blocked = false;

/**
 * For the in-AE tests (SD1): every request fails as it does on a computer without a connection, so
 * "offline" is tried without pulling a cable.
 */
export function setNetworkBlocked(on: boolean): void {
  blocked = on;
}

/** The errors Node gives when there is no connection to the internet (or to that server). */
export function isOfflineError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? "";
  return ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENETUNREACH", "EHOSTUNREACH", "ENETDOWN"].includes(code) || /^timeout fetching/.test(error instanceof Error ? error.message : "");
}

/** A request that follows redirects (up to 5) and gives up after a minute without an answer. */
export function httpsRequest(url: string, options: HttpOptions = {}, redirects = 0): Promise<HttpResponse> {
  const https = nodeRequire<NodeHttps>("https");
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(new Error("cancelled"));
    if (blocked) return reject(Object.assign(new Error(`getaddrinfo ENOTFOUND ${new URL(url).hostname} (the network is blocked for a test)`), { code: "ENOTFOUND" }));
    const body = options.method === "POST" ? Buffer.from(options.body ?? "", "utf8") : null;
    const headers = {
      "user-agent": "LazyMapLayers (After Effects extension)",
      ...(body ? { "content-type": "application/x-www-form-urlencoded", "content-length": String(body.length) } : {}),
      ...(options.headers ?? {})
    };
    const request = https.request(url, { method: options.method ?? "GET", headers: headers }, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirects >= 5) return reject(new Error(`too many redirects fetching ${url}`));
        httpsRequest(new URL(response.headers.location, url).toString(), options, redirects + 1).then(resolve, reject);
        return;
      }
      const total = Number(response.headers["content-length"]) || null;
      const chunks: Uint8Array[] = [];
      let received = 0;
      response.on("data", (chunk: Uint8Array) => {
        chunks.push(chunk);
        received += chunk.length;
        options.onProgress?.(received, total);
      });
      response.on("end", () => {
        const body = new Uint8Array(received);
        let at = 0;
        for (const c of chunks) {
          body.set(c, at);
          at += c.length;
        }
        resolve({ status, body, headers: response.headers });
      });
      response.on("error", reject);
    });
    const abort = () => request.destroy(new Error("cancelled"));
    options.signal?.addEventListener("abort", abort, { once: true });
    request.setTimeout(60000, () => request.destroy(new Error(`timeout fetching ${url}`)));
    request.on("error", reject);
    request.on("close", () => options.signal?.removeEventListener("abort", abort));
    request.end(body ?? undefined);
  });
}

export const httpsGet = (url: string, headers: Record<string, string> = {}): Promise<HttpResponse> => httpsRequest(url, { headers });
