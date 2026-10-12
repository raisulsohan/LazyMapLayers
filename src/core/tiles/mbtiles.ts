// MBTiles (https://github.com/mapbox/mbtiles-spec): raster tiles in an SQLite file, read with our own
// reader (sqlite.ts, D103). Both layouts raster tiles come in are read: a `tiles` table, and a `tiles`
// view over `map` and `images` (mbutil, TileMill, GDAL). Rows count from the south, as the specification says, unless the metadata says
// `scheme` is `xyz`.

import { SqliteError, SqliteReader, type ReadAt, type Row, type SqliteValue, type TableShape } from "./sqlite.ts";

export type MbtilesInfo = {
  name: string;
  /** png, jpg, webp - or pbf for vector tiles, which the imagery cannot draw. */
  format: string | null;
  minZoom: number | null;
  maxZoom: number | null;
  /** West, south, east, north in degrees. */
  bounds: [number, number, number, number] | null;
  /** The metadata's attribution, as plain text. */
  attribution: string;
  scheme: "tms" | "xyz";
  layout: "tiles" | "map-images";
  /** Whether tiles are found through an index (else the keys were read once into memory). */
  indexed: boolean;
  /** The file was written in WAL mode: its newest pages may still be in the -wal file. */
  wal: boolean;
};

type Table = TableShape & { rootPage: number; name: string };

/** Text from an attribution that may carry HTML (links, ©). */
export function plainAttribution(html: string): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", copy: "©", nbsp: " ", reg: "®" };
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === "#") return String.fromCodePoint(code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
      return entities[code.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, " ")
    .trim();
}

const column = (table: Table, name: string): number => {
  const at = table.columns.indexOf(name);
  if (at < 0) throw new SqliteError(`the ${table.name} table has no ${name} column`);
  return at;
};

const valueOf = (table: Table, row: Row, at: number): SqliteValue => (at === table.rowidColumn ? row.rowid : row.values[at] ?? null);

/** Rows of a table found by the values of some of its columns: through an index when one fits, else by reading those columns once. */
class Finder {
  private readonly db: SqliteReader;
  private readonly table: Table;
  private readonly columns: number[];
  private readonly index: { rootPage: number; order: number[] } | null;
  private memory: Map<string, number> | null = null;

  constructor(db: SqliteReader, table: Table, names: string[]) {
    this.db = db;
    this.table = table;
    this.columns = names.map((name) => column(table, name));
    let index: { rootPage: number; order: number[] } | null = null;
    for (const candidate of db.indexes(table.name)) {
      if (!candidate.usable || candidate.columns.length < names.length) continue;
      const lead = candidate.columns.slice(0, names.length);
      if (lead.every((c) => names.includes(c))) {
        index = { rootPage: candidate.rootPage, order: lead.map((c) => names.indexOf(c)) };
        break;
      }
    }
    this.index = index;
  }

  /** Whether a row is found without reading the table's keys into memory first. */
  get indexed(): boolean {
    return !!this.index || this.byRowid;
  }

  private get byRowid(): boolean {
    return this.columns.length === 1 && this.columns[0] === this.table.rowidColumn;
  }

  /** The rowid of the row whose columns hold these values, or null. */
  async rowid(values: SqliteValue[]): Promise<number | null> {
    if (this.byRowid) return typeof values[0] === "number" ? values[0] : null;
    if (this.index) {
      const entry = await this.db.find(this.index.rootPage, this.index.order.map((i) => values[i]));
      const rowid = entry?.[entry.length - 1];
      return typeof rowid === "number" ? rowid : null;
    }
    const memory = await this.remembered();
    return memory.get(JSON.stringify(values)) ?? null;
  }

  /** Every row's key, read once (only the columns needed, unless a blob comes before them). */
  async remembered(): Promise<Map<string, number>> {
    if (this.memory) return this.memory;
    const memory = new Map<string, number>();
    const count = Math.max(...this.columns) + 1;
    for await (const row of this.db.rows(this.table.rootPage, count)) memory.set(JSON.stringify(this.columns.map((c) => valueOf(this.table, row, c))), row.rowid);
    this.memory = memory;
    return memory;
  }

  async row(rowid: number): Promise<Row | null> {
    return this.db.row(this.table.rootPage, rowid);
  }

  /** The smallest or largest value of the first column, through the index when it leads with it. */
  async edgeOfFirst(which: "first" | "last"): Promise<number | null> {
    if (this.index && this.index.order[0] === 0) {
      const entry = await this.db.edge(this.index.rootPage, which);
      return typeof entry?.[0] === "number" ? entry[0] : null;
    }
    const keys = [...(await this.remembered()).keys()].map((key) => JSON.parse(key)[0]).filter((v): v is number => typeof v === "number");
    if (!keys.length) return null;
    return which === "first" ? Math.min(...keys) : Math.max(...keys);
  }
}

export class Mbtiles {
  readonly info: MbtilesInfo;
  private readonly keys: Finder;
  private readonly keysTable: Table;
  private readonly ref: number;
  private readonly data: { finder: Finder; table: Table; column: number } | null;
  private readonly db: SqliteReader;

  private constructor(db: SqliteReader, info: MbtilesInfo, keys: Finder, keysTable: Table, ref: number, data: { finder: Finder; table: Table; column: number } | null) {
    this.db = db;
    this.info = info;
    this.keys = keys;
    this.keysTable = keysTable;
    this.ref = ref;
    this.data = data;
  }

  static async open(read: ReadAt): Promise<Mbtiles> {
    const db = await SqliteReader.open(read);
    const table = (name: string): Table | null => {
      const shape = db.table(name);
      if (!shape) return null;
      if (shape.withoutRowid) throw new SqliteError(`the ${name} table has no rowid, which this reader does not read`);
      return { ...shape, name };
    };
    const tiles = table("tiles");
    let layout: MbtilesInfo["layout"];
    let keysTable: Table;
    let ref: number;
    let data: { finder: Finder; table: Table; column: number } | null = null;
    if (tiles) {
      layout = "tiles";
      keysTable = tiles;
      ref = column(tiles, "tile_data");
    } else if (db.entry("tiles", "view")) {
      const map = table("map");
      const images = table("images");
      if (map && images) {
        layout = "map-images";
        keysTable = map;
        ref = column(map, "tile_id");
        data = { finder: new Finder(db, images, ["tile_id"]), table: images, column: column(images, "tile_data") };
      } else throw new SqliteError("the tiles view joins tables this reader does not know");
    } else throw new SqliteError("not an MBTiles file: it has no tiles table");
    const keys = new Finder(db, keysTable, ["zoom_level", "tile_column", "tile_row"]);

    const metadata = new Map<string, string>();
    const meta = table("metadata");
    if (meta) {
      const name = column(meta, "name");
      const value = column(meta, "value");
      for await (const row of db.rows(meta.rootPage)) {
        const key = valueOf(meta, row, name);
        const text = valueOf(meta, row, value);
        if (typeof key === "string") metadata.set(key.toLowerCase(), text === null ? "" : String(text));
      }
    }
    const zoom = (key: string) => {
      const text = metadata.get(key);
      const value = text !== undefined && text.trim() !== "" ? Number(text) : NaN;
      return Number.isInteger(value) && value >= 0 && value <= 30 ? value : null;
    };
    const minZoom = zoom("minzoom") ?? (await keys.edgeOfFirst("first"));
    const maxZoom = zoom("maxzoom") ?? (await keys.edgeOfFirst("last"));
    let bounds: MbtilesInfo["bounds"] = null;
    const parts = (metadata.get("bounds") ?? "").split(",").map((part) => Number(part.trim()));
    if (parts.length === 4 && parts.every(Number.isFinite) && parts[0] < parts[2] && parts[1] < parts[3]) bounds = parts as [number, number, number, number];
    let format = (metadata.get("format") ?? "").trim().toLowerCase() || null;
    if (format === "jpeg") format = "jpg";
    const info: MbtilesInfo = {
      name: metadata.get("name") ?? "",
      format,
      minZoom,
      maxZoom: maxZoom !== null && minZoom !== null && maxZoom < minZoom ? minZoom : maxZoom,
      bounds,
      attribution: plainAttribution(metadata.get("attribution") ?? ""),
      scheme: (metadata.get("scheme") ?? "").trim().toLowerCase() === "xyz" ? "xyz" : "tms",
      layout,
      indexed: keys.indexed && (!data || data.finder.indexed),
      wal: db.header.wal
    };
    return new Mbtiles(db, info, keys, keysTable, ref, data);
  }

  /** The first tile the file holds (to tell the tiles' size), or null for a file without tiles. */
  async sample(): Promise<Uint8Array | null> {
    for await (const row of this.db.rows(this.keysTable.rootPage)) return this.dataOf(valueOf(this.keysTable, row, this.ref));
    return null;
  }

  private async dataOf(value: SqliteValue): Promise<Uint8Array | null> {
    if (!this.data) return value instanceof Uint8Array ? value : null;
    if (value === null) return null;
    const dataRowid = await this.data.finder.rowid([value]);
    if (dataRowid === null) return null;
    const stored = await this.data.finder.row(dataRowid);
    const bytes = stored ? valueOf(this.data.table, stored, this.data.column) : null;
    return bytes instanceof Uint8Array ? bytes : null;
  }

  /** The tile's bytes at z/x/y counted from the north (as MapLibre asks), or null when the file has none. */
  async tile(z: number, x: number, y: number): Promise<Uint8Array | null> {
    const n = 2 ** z;
    if (!(x >= 0 && x < n && y >= 0 && y < n)) return null;
    const row = this.info.scheme === "tms" ? n - 1 - y : y;
    const rowid = await this.keys.rowid([z, x, row]);
    if (rowid === null) return null;
    const found = await this.keys.row(rowid);
    if (!found) return null;
    return this.dataOf(valueOf(this.keysTable, found, this.ref));
  }
}
