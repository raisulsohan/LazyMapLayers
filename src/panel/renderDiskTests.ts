// RD1: renders made before a project was saved are never taken for rubbish.
//
// A map rendered in an unsaved project keeps its frames in the data folder, and the footage After
// Effects imported points there. Saving the project must not move the next render somewhere else
// (the old footage would lose its frames), and Renders on disk must not remove those frames while
// the saved project is still on disk, whichever project happens to be open at the time.
//
// Nothing here touches the open After Effects project: the folders and the project file are stand-ins
// made for the test and removed at the end.

import { fs, path, userDataDir } from "./cep.ts";
import { removeOldLooseRenders, renderDiskReport } from "./render/renderDisk.ts";
import { PROJECT_MARKER, RenderStore } from "./render/renderStore.ts";
import { spikeDir, type SpikeLog } from "./spikes.ts";

export async function runRenderDiskTest(log: SpikeLog): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const stamp = Date.now().toString(36);
  const savedId = `rd1saved${stamp}`;
  const goneId = `rd1gone${stamp}`;
  const loose = path().join(userDataDir(), "renders");
  const savedFolder = path().join(loose, `RD1 saved ${savedId}`);
  const goneFolder = path().join(loose, `RD1 gone ${goneId}`);
  const projectDir = path().join(spikeDir(), "RD1 project");
  const projectFile = path().join(projectDir, "RD1 city.aep");
  const frame = (folder: string) => {
    fs().mkdirSync(path().join(folder, "base final 1"), { recursive: true });
    fs().writeFileSync(path().join(folder, "base final 1", "frame_00000.png"), "stand-in");
  };

  try {
    // Two maps rendered while their projects were unsaved; one project was then saved.
    frame(savedFolder);
    frame(goneFolder);
    fs().mkdirSync(projectDir, { recursive: true });
    fs().writeFileSync(projectFile, "stand-in project");

    // The saved project renders again: the store stays where the footage points.
    const store = RenderStore.forMap(savedId, "RD1 saved", projectDir);
    if (path().resolve(store.root).toLowerCase() !== path().resolve(savedFolder).toLowerCase()) {
      problems.push(`after saving, the next render went to ${store.root} instead of the folder the footage uses`);
    }
    store.claimFor(projectFile);
    let marker = "";
    try {
      marker = fs().readFileSync(path().join(savedFolder, PROJECT_MARKER), "utf8").trim();
    } catch {
      marker = "";
    }
    if (marker !== projectFile) problems.push(`the render folder does not name its project (it says "${marker}")`);

    // A map that was never rendered before goes next to its saved project, as it always did.
    const fresh = RenderStore.forMap(`rd1fresh${stamp}`, "RD1 fresh", projectDir);
    if (!fresh.root.toLowerCase().startsWith(path().join(projectDir, "LazyMapLayers Renders").toLowerCase())) {
      problems.push(`a new map of a saved project renders into ${fresh.root}`);
    }

    // Another project is open: neither map is of it.
    const report = renderDiskReport([], null);
    const saved = report.loose.find((entry) => entry.mapId === savedId);
    const gone = report.loose.find((entry) => entry.mapId === goneId);
    if (!saved || !gone) problems.push("the report does not list both stand-in folders");
    if (saved && saved.orphan) problems.push("the frames of a saved project are offered for removal");
    if (gone && !gone.orphan) problems.push("the frames of an unsaved, closed project are not offered for removal");

    // The user removes what the panel offers. Only the unreachable folder may go.
    const onlyOurs = { ...report, loose: report.loose.filter((entry) => entry.mapId === savedId || entry.mapId === goneId) };
    const removed = removeOldLooseRenders(onlyOurs);
    if (!fs().existsSync(savedFolder)) problems.push("removing old renders deleted the frames of a saved project");
    if (fs().existsSync(goneFolder)) problems.push("removing old renders left the frames of a closed, unsaved project");
    if (removed.removed !== 1) problems.push(`removing old renders removed ${removed.removed} folders, not 1`);

    // Once the saved project itself is deleted, its frames are unreachable too.
    fs().rmSync(projectFile, { force: true });
    const later = renderDiskReport([], null).loose.find((entry) => entry.mapId === savedId);
    if (!later || !later.orphan) problems.push("the frames of a project deleted from disk are still kept");
  } finally {
    for (const folder of [savedFolder, goneFolder, projectDir]) {
      try {
        fs().rmSync(folder, { recursive: true, force: true });
      } catch {
        // Stand-ins only.
      }
    }
  }

  const passed = problems.length === 0;
  log(`RD1 renders on disk: ${passed ? "a saved project's frames are kept, an unreachable folder goes" : `${problems.length} problems`}`, passed ? "ok" : "fail");
  for (const problem of problems) log(`  ${problem}`, "fail");
  return { passed, problems };
}
