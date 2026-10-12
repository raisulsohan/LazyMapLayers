// SF1: the Self-test (D104) in After Effects, through the same code the About button runs. Every check
// must pass, once on each expression engine; the project must hold exactly the items it held before;
// one Undo must take back the Self-test and nothing else (a marker comp made before it survives the
// first Undo and goes with the second); and the problem report must carry the Self-test report, with
// the home folder written as ~, and the issue address only the short fields.

import { issueFormUrl } from "../core/support/issueForm.ts";
import { evalScript, os } from "./cep.ts";
import { runSelfTest } from "./selfTest.ts";
import type { SpikeLog } from "./spikes.ts";
import { copyText, ISSUES_URL, writeProblemReport } from "./updates.ts";

async function host<T>(body: string): Promise<T> {
  const raw = await evalScript(`(function () { ${body} })()`);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`host script returned ${raw.slice(0, 300)}`);
  }
}

const COUNT = "var ids = []; for (var i = 1; i <= app.project.numItems; i++) ids.push(app.project.item(i).id); return LML.json.stringify({ n: app.project.numItems, ids: ids.join(',') });";
const MARKER = "SF1 marker";

export async function runSelfTestTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  let ok = true;
  const expect = (name: string, pass: boolean, detail = "") => {
    if (!pass) ok = false;
    log(`${pass ? "PASS" : "FAIL"} SF1 ${name}${detail ? `  [${detail}]` : ""}`, pass ? "ok" : "fail");
  };

  const engine = await host<{ engine: string }>("return LML.json.stringify({ engine: app.project.expressionEngine });");
  const runs: Record<string, unknown>[] = [];
  for (const which of ["javascript-1.0", "extendscript"]) {
    await host(`app.project.expressionEngine = "${which}"; return "1";`);
    const before = await host<{ n: number; ids: string }>(COUNT);
    const started = performance.now();
    const result = await runSelfTest();
    const ms = Math.round(performance.now() - started);
    const after = await host<{ n: number; ids: string }>(COUNT);
    log(result.report, "muted");
    expect(`${which}: every check passes`, result.checks.every((c) => c.status === "pass"), result.verdict);
    expect(`${which}: the project holds the same items`, after.ids === before.ids, `${before.n} before, ${after.n} after`);
    runs.push({ engine: which, verdict: result.verdict, ms, checks: result.checks, itemsBefore: before.n, itemsAfter: after.n });
  }
  await host(`app.project.expressionEngine = "${engine.engine}"; return "1";`);
  out.runs = runs;

  // One undo step: a marker made in its own step just before the Self-test survives the first Undo
  // (which takes back the Self-test, leaving the project as it was) and goes with the second.
  await host(`app.beginUndoGroup("${MARKER}"); try { app.project.items.addComp("${MARKER}", 64, 64, 1, 1, 25); } finally { app.endUndoGroup(); } return "1";`);
  const before = await host<{ n: number; ids: string }>(COUNT);
  const once = await runSelfTest();
  const markerThere = async () => (await host<{ there: boolean }>(`for (var i = 1; i <= app.project.numItems; i++) if (app.project.item(i).name === "${MARKER}") return '{"there":true}'; return '{"there":false}';`)).there;
  await evalScript("app.executeCommand(16)");
  const afterFirstUndo = await host<{ n: number; ids: string }>(COUNT);
  const keptByFirst = await markerThere();
  await evalScript("app.executeCommand(16)");
  const goneBySecond = !(await markerThere());
  expect("one Undo takes back the Self-test and nothing else", once.checks.every((c) => c.status === "pass") && keptByFirst && afterFirstUndo.ids === before.ids, `${afterFirstUndo.n} items`);
  expect("a second Undo reaches the step before it", goneBySecond);

  // The problem report carries the Self-test report; the address carries only the short fields.
  const last = await runSelfTest();
  const report = writeProblemReport(["SF1 line"], "After Effects test · LazyMapLayers test", last.report);
  const home = os().homedir();
  expect("the problem report carries the Self-test report", report.text.includes("LazyMapLayers Self-test") && report.text.includes(`Result: ${last.verdict}`));
  expect("the home folder is written as ~", !report.text.includes(home) && !report.text.includes(home.replace(/\\/g, "/")));
  const url = new URL(issueFormUrl(ISSUES_URL, { versions: "x", system: last.system, selfTest: last.verdict }));
  expect("the issue address names the form and three short fields", url.searchParams.get("template") === "bug.yml" && url.search.length < 600, url.search);
  out.copied = copyText(report.text);
  out.reportFile = report.file;
  out.selfTestFile = last.file;
  // The last Self-test's undo step changes nothing; it stays.
  out.passed = ok;
  return out;
}
