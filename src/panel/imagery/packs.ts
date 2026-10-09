// Optional imagery packs in the user's data folder ("imagery"): large whole-world rasters that are not
// part of the extension. They are published with the project on GitHub ("Imagery packs" release) and
// downloaded from there when the user asks (or come with the offline data pack); see buildImagery.ts for
// how they are made. Their addresses, sizes and checksums are in core/imagery/packInfo.ts.

import { fs, nodeRequire, path, userDataDir } from "../cep.ts";
import { httpsRequest } from "../net.ts";
import { IMAGERY_INFO, type ImageryPack } from "../../core/imagery/packInfo.ts";

export { IMAGERY_INFO, type ImageryPack };

export const imageryPath = (pack: ImageryPack) => path().join(userDataDir(), "imagery", `${pack}.pmtiles`);

export function hasImagery(pack: ImageryPack): boolean {
  try {
    return fs().existsSync(imageryPath(pack));
  } catch {
    return false;
  }
}

/**
 * Downloads a pack from the project's GitHub release into the user data folder, checking its size
 * and SHA-256 before it replaces anything. `into` lets a test download to another file.
 */
export async function downloadImagery(pack: ImageryPack, options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void; into?: string } = {}): Promise<string> {
  const info = IMAGERY_INFO[pack];
  const answer = await httpsRequest(info.url, { signal: options.signal, onProgress: (done) => options.onProgress?.(done, info.bytes) });
  if (answer.status !== 200) throw new Error(`the download answered HTTP ${answer.status}`);
  if (answer.body.length !== info.bytes) throw new Error(`the download is ${answer.body.length} bytes, expected ${info.bytes}`);
  const digest = nodeRequire<typeof import("node:crypto")>("crypto").createHash("sha256").update(answer.body).digest("hex");
  if (digest !== info.sha256) throw new Error("the download is damaged (its checksum is wrong); try again");
  const file = options.into ?? imageryPath(pack);
  const nodeFs = fs();
  nodeFs.mkdirSync(path().dirname(file), { recursive: true });
  const temporary = `${file}.part`;
  nodeFs.writeFileSync(temporary, answer.body);
  nodeFs.renameSync(temporary, file);
  return file;
}
