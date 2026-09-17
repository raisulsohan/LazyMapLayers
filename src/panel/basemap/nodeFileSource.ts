// PMTiles source that reads a local archive through Node's file API (random access, no fetch).

import type { RangeResponse, Source } from "pmtiles";
import { fs } from "../cep.ts";

export class NodeFileSource implements Source {
  private readonly filePath: string;
  private readonly key: string;
  private fd: number | null = null;

  constructor(filePath: string, key: string) {
    this.filePath = filePath;
    this.key = key;
  }

  getKey(): string {
    return this.key;
  }

  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const nodeFs = fs();
    if (this.fd === null) this.fd = nodeFs.openSync(this.filePath, "r");
    const buffer = new Uint8Array(length);
    let read = 0;
    while (read < length) {
      const n = nodeFs.readSync(this.fd, buffer, read, length - read, offset + read);
      if (n === 0) break;
      read += n;
    }
    return { data: buffer.buffer.slice(0, read) };
  }

  close(): void {
    if (this.fd !== null) {
      fs().closeSync(this.fd);
      this.fd = null;
    }
  }
}
