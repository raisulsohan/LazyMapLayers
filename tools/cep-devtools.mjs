// Minimal Chrome DevTools Protocol client for the LazyMapLayers panel inside After Effects.
// The dev build writes a .debug file that opens remote debugging on port 8123.

const PORT = Number(process.env.LML_DEBUG_PORT ?? 8123);

export async function connectPanel({ timeoutMs = 30000 } = {}) {
  const started = Date.now();
  let target = null;
  while (!target) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      target = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl && /LazyMapLayers|panel\/index\.html/i.test(`${t.title} ${t.url}`)) ?? null;
    } catch {
      target = null;
    }
    if (!target) {
      if (Date.now() - started > timeoutMs) throw new Error(`no LazyMapLayers panel on DevTools port ${PORT}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  return {
    async evaluate(expression) {
      const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(`panel exception: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
      return result.result.value;
    },
    async screenshot() {
      const result = await send("Page.captureScreenshot", { format: "png" });
      return Buffer.from(result.data, "base64");
    },
    close() {
      socket.close();
    }
  };
}
