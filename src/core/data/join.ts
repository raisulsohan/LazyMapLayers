// Joining a table of numbers to the countries the map knows. A row finds its country by the code the
// map tiles carry, by an ISO code (two letters, three letters or the number), or by any name the
// source data holds for it, in any of the languages the panel bundles - so a table written in
// French, Bengali or Spanish joins as readily as one written in English.
//
// Nothing is guessed: a key that means two countries equally is left unmatched and said so, rather
// than coloured wrongly. Rank decides when it does not mean them equally: a country's own code beats
// another country's second code (Clipperton Island carries France's), and a code beats a name.

export type JoinTarget = {
  /** The code the map tiles carry (Natural Earth's adm0_a3), which is also its first key. */
  code: string;
  /** Other codes it answers to: ISO two letter, three letter, and the number. */
  codes?: (string | null)[];
  /** Everything it may be called, in any language. */
  names?: (string | null)[];
};

export type JoinRow = { key: string; value: number };

export type JoinResult = {
  matched: { code: string; key: string; value: number }[];
  /** Keys that found nothing, and keys that would fit two countries as well as each other. */
  unmatched: { key: string; reason: "unknown" | "ambiguous" }[];
  /** Countries a second row also named: the first row wins, and this says how often that happened. */
  repeated: number;
};

/** The accents that NFD splits off a letter. */
const COMBINING_MARKS = new RegExp("[̀-ͯ]", "g");

/**
 * A key as it is compared: no case, no Latin accents, no punctuation, no leading "the". The marks of
 * other scripts are letters, not decoration - dropping the vowel signs of Bengali, Hindi, Thai or
 * Arabic would turn a name into a different word - so only the Latin combining marks go.
 */
export function normaliseKey(text: string): string {
  const plain = (text ?? "")
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Mark}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
  return plain.replace(/^the /, "");
}

/** Numbers written 050, 50 or 50.0 all mean the same country. */
const numberKey = (key: string) => (/^[0-9]+$/.test(key) ? String(Number(key)) : null);

export type Lookup = { lookup: Map<string, string>; ambiguous: Set<string> };

/**
 * Every way of naming a country, to the code it means. Keys are taken in three rounds - own code,
 * other codes, names - and a key taken in an earlier round is never overwritten; only a clash inside
 * one round makes a key ambiguous, and an ambiguous key is left out of the lookup.
 */
export function buildLookup(targets: JoinTarget[]): Lookup {
  const lookup = new Map<string, string>();
  const ambiguous = new Set<string>();
  const rounds: ((target: JoinTarget) => (string | null | undefined)[])[] = [(target) => [target.code], (target) => target.codes ?? [], (target) => target.names ?? []];
  for (const keysOf of rounds) {
    const round = new Map<string, string>();
    for (const target of targets) {
      for (const raw of keysOf(target)) {
        if (!raw) continue;
        const plain = normaliseKey(raw);
        for (const key of [plain, numberKey(plain)]) {
          if (!key || lookup.has(key)) continue;
          const had = round.get(key);
          if (had === undefined) round.set(key, target.code);
          else if (had !== target.code) ambiguous.add(key);
        }
      }
    }
    for (const [key, code] of round) if (!ambiguous.has(key)) lookup.set(key, code);
  }
  return { lookup, ambiguous };
}

/** The rows that found a country, and the keys that did not. */
export function joinValues(rows: JoinRow[], found: Lookup): JoinResult {
  const matched: JoinResult["matched"] = [];
  const unmatched: JoinResult["unmatched"] = [];
  const taken = new Set<string>();
  let repeated = 0;
  for (const row of rows) {
    const plain = normaliseKey(row.key);
    const number = numberKey(plain);
    const code = found.lookup.get(plain) ?? (number ? found.lookup.get(number) : undefined);
    if (!code) {
      unmatched.push({ key: row.key, reason: found.ambiguous.has(plain) ? "ambiguous" : "unknown" });
      continue;
    }
    if (taken.has(code)) {
      repeated++;
      continue;
    }
    taken.add(code);
    matched.push({ code, key: row.key, value: row.value });
  }
  return { matched, unmatched, repeated };
}

/** What a join is worth saying out loud. */
export function describeJoin(result: JoinResult, total: number): string {
  const missed = result.unmatched.length;
  const names = result.unmatched.slice(0, 4).map((row) => row.key);
  return [
    `${result.matched.length} of ${total} rows matched a country`,
    missed ? `${missed} did not: ${names.join(", ")}${missed > names.length ? ` and ${missed - names.length} more` : ""}` : "",
    result.repeated ? `${result.repeated} rows named a country another row had already taken` : ""
  ]
    .filter(Boolean)
    .join("; ");
}
