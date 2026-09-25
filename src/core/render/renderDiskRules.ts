// Which rendered frames on disk may be deleted, and which must never be.
//
// Deleting the wrong folder costs the user hours: After Effects loses a footage item per pass and
// says so, comp by comp, the next time the project is opened. The rule lives here, away from the
// file system, so it can be read and tested on its own.

export type RenderFolderFacts = {
  /** A map of the project that is open now. */
  ofThisProject: boolean;
  /** The saved project the folder says it belongs to, if it says anything. */
  claimedProject: string | null;
  /** Whether that project file is still on disk. */
  claimedProjectExists: boolean;
};

/**
 * True only when nothing can reach these frames again: they belong to no open map, and to no saved
 * project that still exists. An unsaved project that has been closed is gone for good, and its
 * frames with it; everything else is somebody's work.
 */
export function canRemoveRender(facts: RenderFolderFacts): boolean {
  if (facts.ofThisProject) return false;
  if (facts.claimedProject && facts.claimedProjectExists) return false;
  return true;
}
