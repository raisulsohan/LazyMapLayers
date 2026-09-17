// Developer automation for tools/ae-spikes.mjs: a heartbeat file, and polling for spike requests.
// It is harmless for users: without a request file it only refreshes one small temp file.

import { callHost, evalScript, fs, path } from "./cep.ts";
import { runSpikes, spikeDir, type SpikeLog } from "./spikes.ts";

let active = false;

export function startDevAutomation(log: SpikeLog, setBusy: (busy: boolean) => void): () => void {
  const timer = setInterval(() => {
    try {
      fs().mkdirSync(spikeDir(), { recursive: true });
      fs().writeFileSync(path().join(spikeDir(), "..", "panel-alive.json"), JSON.stringify({ time: Date.now() }), "utf8");
    } catch {
      // ignore
    }
    void maybeRun(log, setBusy);
  }, 2000);
  return () => clearInterval(timer);
}

async function maybeRun(log: SpikeLog, setBusy: (busy: boolean) => void) {
  const request = path().join(spikeDir(), "run-request.json");
  if (active || !fs().existsSync(request)) return;
  active = true;
  setBusy(true);
  try {
    let options: { quit?: boolean; only?: string[] | null; hostScript?: string } = {};
    try {
      options = JSON.parse(fs().readFileSync(request, "utf8"));
    } catch {
      // Empty request: defaults.
    }
    fs().unlinkSync(request);
    log("test run requested by tools/ae-spikes", "muted");
    const only = options.only ?? undefined;
    if (options.hostScript && (!only || only.includes("S3") || only.includes("S5"))) {
      log("running host spikes S3 and S5", "muted");
      const scriptPath = options.hostScript.split(String.fromCharCode(92)).join("/");
      await evalScript(`$.evalFile(${JSON.stringify(scriptPath)})`).catch((error) => log(`host spikes failed: ${error.message}`, "fail"));
    }
    fs().writeFileSync(path().join(spikeDir(), "host-done.flag"), "1", "utf8");
    try {
      await runSpikes(log, only);
    } catch (error) {
      log(`spikes failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`, "fail");
    }
    if (options.quit) await callHost("devQuitAfterSpikes").catch((error) => log(`quit refused: ${error.message}`, "fail"));
  } finally {
    active = false;
    setBusy(false);
  }
}
