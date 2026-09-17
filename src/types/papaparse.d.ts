// Minimal typing for papaparse (MIT), which ships without declarations: only what the panel uses.
declare module "papaparse" {
  type ParseConfig = {
    /** Empty for automatic detection (comma, semicolon, tab, pipe). */
    delimiter?: string;
    header?: false;
    skipEmptyLines?: boolean | "greedy";
    /** Parses only this many rows. */
    preview?: number;
  };
  type ParseResult<Row> = { data: Row[]; errors: { message: string; row?: number }[]; meta: { delimiter: string } };
  const Papa: { parse<Row = string[]>(text: string, config?: ParseConfig): ParseResult<Row> };
  export default Papa;
}
