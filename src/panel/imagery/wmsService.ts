// Asks a WMS what it offers (D103). Only when the user gives the address: nothing is fetched before.
// Core reads the answer (core/imagery/wms.ts); this module only goes online.

import { capabilitiesUrl, parseWmsCapabilities, type WmsCapabilities } from "../../core/imagery/wms.ts";
import { httpsRequest } from "../net.ts";

/** The capabilities of the WMS at this address; throws with a sentence the log can show. */
export async function readWmsCapabilities(address: string): Promise<WmsCapabilities> {
  let url: string;
  try {
    url = capabilitiesUrl(address);
  } catch {
    throw new Error(`"${address}" is not a web address`);
  }
  const response = await httpsRequest(url, { gzip: true, maxBytes: 32 * 1048576, timeoutMs: 30000 });
  if (response.status !== 200) throw new Error(`the service answered ${response.status} to GetCapabilities`);
  const parsed = parseWmsCapabilities(new TextDecoder("utf-8").decode(response.body));
  if (!parsed.ok) throw new Error(parsed.error);
  if (!parsed.value.layers.length) throw new Error("the service lists no layer that can be asked for by name");
  return parsed.value;
}
