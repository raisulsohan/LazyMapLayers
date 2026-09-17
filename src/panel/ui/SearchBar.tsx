// Place search: offline names of countries and cities in 26 languages, and typed coordinates.
// Results appear while typing; Enter or a click goes to the first or the chosen one.

import { useRef, useState } from "preact/hooks";
import { searchPlaces, type SearchResult } from "../../core/search/placeSearch.ts";
import { isInCep } from "../cep.ts";
import { placeIndex } from "../data/worldLabels.ts";
import { addPinAt, fail, goToResult, selected } from "../store.ts";
import { Icon, IconButton } from "./icons.tsx";

export function SearchBar() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = (text: string) => {
    setQuery(text);
    if (timer.current) clearTimeout(timer.current);
    // The first search builds the index (about 50 ms); a short wait keeps typing smooth.
    timer.current = setTimeout(() => {
      if (!isInCep()) return;
      try {
        setResults(searchPlaces(placeIndex(), text));
        setActive(0);
        setOpen(true);
      } catch (error) {
        fail("search", error);
      }
    }, 120);
  };

  const choose = (result: SearchResult | undefined) => {
    if (!result) return;
    goToResult(result);
    setOpen(false);
    setQuery(result.name);
  };

  return (
    <div class="search">
      <Icon name="search" size={14} class="search-icon" />
      <input
        data-id="search"
        placeholder={"Search a country, a city or \"lat, lng\""}
        value={query}
        onInput={(e) => search((e.target as HTMLInputElement).value)}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter") choose(results[active]);
          else if (e.key === "ArrowDown") setActive(Math.min(results.length - 1, active + 1));
          else if (e.key === "ArrowUp") setActive(Math.max(0, active - 1));
          else if (e.key === "Escape") setOpen(false);
          else return;
          e.preventDefault();
        }}
      />
      {query && (
        <IconButton
          icon="x"
          size={12}
          title="Clear"
          class="flat"
          onClick={() => {
            setQuery("");
            setResults([]);
            setOpen(false);
          }}
        />
      )}
      {open && query.trim().length >= 2 && (
        <div class="search-results">
          {results.length === 0 && <div class="search-empty">No place with that name in the offline list. Try the English or the local spelling.</div>}
          {results.map((r, i) => (
            <div key={r.id} class={`search-result ${i === active ? "active" : ""}`} onMouseDown={() => choose(r)} onMouseEnter={() => setActive(i)}>
              <Icon name={r.kind === "country" ? "globe" : r.kind === "coordinates" ? "target" : "pin"} size={13} />
              <span class="search-name">
                {r.name}
                {r.matched && <span class="muted"> · {r.matched}</span>}
              </span>
              <span class="muted search-detail">{r.detail}</span>
              {selected.value && (
                // The row acts on mouse down; the pin button must not trigger it.
                <span
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                >
                  <IconButton icon="pin" size={12} class="flat" title="Add a pin here" onClick={() => void addPinAt({ lat: r.lat, lng: r.lng })} />
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
