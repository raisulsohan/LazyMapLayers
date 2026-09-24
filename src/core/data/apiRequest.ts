// The scripting API's request format: what another script may ask the panel to do, and what comes
// back. Reading a request is pure work, so it is checked here, where it can be tested: a request is
// data, never code, and only the calls the panel offers are ever run.

export type ApiRequest = { id: string; call: string; args: Record<string, unknown> };

export type ApiAnswer = { id: string; ok: true; result: unknown } | { id: string; ok: false; error: string };

export const MAX_REQUEST_BYTES = 262144;

const ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * A request read from a file: its id, the call it asks for and the arguments for it. The call has to
 * be one the panel offers, so a file can never name a function of its own.
 */
export function parseApiRequest(text: string, known: readonly string[]): { request: ApiRequest } | { error: string } {
  if (typeof text !== "string" || !text.trim()) return { error: "the request file is empty" };
  if (text.length > MAX_REQUEST_BYTES) return { error: `the request is ${text.length} bytes; up to ${MAX_REQUEST_BYTES} are read` };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { error: `the request is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "a request is a JSON object, like {\"call\": \"addPin\", \"args\": {}}" };
  const source = raw as { id?: unknown; call?: unknown; args?: unknown };
  const call = typeof source.call === "string" ? source.call.trim() : "";
  if (!call) return { error: "the request has no call" };
  if (!known.includes(call)) return { error: `there is no call named "${call}". The calls are: ${[...known].sort().join(", ")}` };
  const id = typeof source.id === "string" && ID.test(source.id) ? source.id : "";
  const args = source.args && typeof source.args === "object" && !Array.isArray(source.args) ? (source.args as Record<string, unknown>) : {};
  return { request: { id, call, args } };
}

/** A number an argument carries, within the bounds the call allows. */
export function numberArg(args: Record<string, unknown>, name: string, fallback: number, low = -Infinity, high = Infinity): number {
  const raw = args[name];
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(value)) return fallback;
  return Math.max(low, Math.min(high, value));
}

/** A string an argument carries, trimmed and cut to a sensible length. */
export function textArg(args: Record<string, unknown>, name: string, fallback = ""): string {
  const raw = args[name];
  if (typeof raw === "string") return raw.trim().slice(0, 200);
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return fallback;
}

/** A yes or no an argument carries. */
export function flagArg(args: Record<string, unknown>, name: string, fallback = false): boolean {
  const raw = args[name];
  if (typeof raw === "boolean") return raw;
  if (raw === "true" || raw === 1) return true;
  if (raw === "false" || raw === 0) return false;
  return fallback;
}

/** A list of short codes or names an argument carries. */
export function listArg(args: Record<string, unknown>, name: string, limit = 200): string[] {
  const raw = args[name];
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  return list
    .map((item) => (typeof item === "string" || typeof item === "number" ? String(item).trim() : ""))
    .filter((item) => item.length > 0)
    .slice(0, limit);
}
