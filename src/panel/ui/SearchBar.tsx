// Place search: offline names of countries, provinces, cities and the natural world in 26 languages,
// and typed coordinates. Results appear while typing; Enter or a click goes to the first or the
// chosen one. An address or a street the offline list cannot know is searched on OpenStreetMap,
// only when asked for (data/geocode.ts).

import { useRef, useState } from "preact/hooks";
import { searchPlaces, type SearchResult } from "../../core/search/placeSearch.ts";
import { isInCep } from "../cep.ts";
import { placeIndex } from "../data/worldLabels.ts";
import { searchOnline } from "../data/geocode.ts";
import { NOMINATIM_CREDIT } from "../../core/search/geocode.ts";
import { log, panelVersion } from "../store.ts";
import { compView } from "../preview.ts";
import { addPinAt, fail, goToResult, highlights, selected, toggleCountryHighlight, toggleDistrictById, toggleProvinceById } from "../store.ts";
import { Icon, IconButton } from "./icons.tsx";

export function SearchBar() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [online, setOnline] = useState<SearchResult[] | null>(null);
  const [asking, setAsking] = useState(false);

  /** Asks OpenStreetMap: only on the user's word, never while typing. */
  const askOnline = async () => {
    const text = query.trim();
    if (text.length < 3 || asking) return;
    setAsking(true);
    try {
      const view = compView();
      const spread = view ? 180 / Math.pow(2, Math.max(0, view.zoom - 1)) : 0;
      const near = view && view.zoom > 3 ? { west: view.center.lng - spread, south: view.center.lat - spread / 2, east: view.center.lng + spread, north: view.center.lat + spread / 2 } : null;
      const answer = await searchOnline(text, { near, version: panelVersion.value });
      setOnline(answer.results);
      setOpen(true);
      if (!answer.results.length) log(`OpenStreetMap found nothing for "${text}"`, "muted");
    } catch (error) {
      fail("searching OpenStreetMap", error);
    } finally {
      setAsking(false);
    }
  };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = (text: string) => {
    setQuery(text);
    setOnline(null);
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
        placeholder={"Search a country, a province, a city or \"lat, lng\""}
        value={query}
        onInput={(e) => search((e.target as HTMLInputElement).value)}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const all = [...results, ...(online ?? [])];
            // Nothing offline: Enter asks OpenStreetMap instead.
            if (all[active]) choose(all[active]);
            else void askOnline();
          }
          else if (e.key === "ArrowDown") setActive(Math.min(results.length + (online?.length ?? 0) - 1, active + 1));
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
          {results.length === 0 && !online?.length && <div class="search-empty">No place with that name in the offline list. Try the English or the local spelling, or search OpenStreetMap below.</div>}
          {results.map((r, i) => (
            <div key={r.id} class={`search-result ${i === active ? "active" : ""}`} onMouseDown={() => choose(r)} onMouseEnter={() => setActive(i)}>
              <Icon name={r.kind === "country" ? "globe" : r.kind === "province" || r.kind === "district" ? "borders" : r.kind === "coordinates" ? "target" : r.kind === "nature" ? (/^(Ocean|Sea|Lake|River|Waterfall)/.test(r.detail) ? "wave" : "mountain") : "pin"} size={13} />
              <span class="search-name">
                {r.name}
                {r.matched && <span class="muted"> · {r.matched}</span>}
              </span>
              <span class="muted search-detail">{r.detail}</span>
              {r.kind === "country" && r.code && (
                <span
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                >
                  <IconButton
                    icon="highlight"
                    size={12}
                    class="flat"
                    active={highlights.value.some((h) => h.code === r.code)}
                    title="Highlight this country (again to remove)"
                    onClick={() => toggleCountryHighlight(r.code!, r.name)}
                  />
                </span>
              )}
              {r.kind === "district" && r.adm1 && r.code && (
                <span
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                >
                  <IconButton
                    icon="highlight"
                    size={12}
                    class="flat"
                    id={`highlight-${r.adm1}`}
                    active={highlights.value.some((h) => h.code === `area:${r.adm1}`)}
                    title="Highlight this district (again to remove)"
                    onClick={() => toggleDistrictById(r.code!, r.adm1!)}
                  />
                </span>
              )}
              {r.kind === "province" && r.adm1 && r.code && (
                <span
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                >
                  <IconButton
                    icon="highlight"
                    size={12}
                    class="flat"
                    id={`highlight-${r.adm1}`}
                    active={highlights.value.some((h) => h.code === `area:${r.adm1}`)}
                    title="Highlight this province (again to remove)"
                    onClick={() => toggleProvinceById(r.code!, r.adm1!)}
                  />
                </span>
              )}
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
          {(online ?? []).map((r, n) => {
            const i = results.length + n;
            return (
              <div key={r.id} class={`search-result ${i === active ? "active" : ""}`} data-id="search-online-result" onMouseDown={() => choose(r)} onMouseEnter={() => setActive(i)}>
                <Icon name="osm" size={13} />
                <span class="search-name">{r.name}</span>
                <span class="muted search-detail">{r.detail}</span>
                {selected.value && (
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
            );
          })}
          {query.trim().length >= 3 && online === null && (
            <div class="search-result" data-id="search-online" title="Sends what you typed to nominatim.openstreetmap.org, the OpenStreetMap search. Nothing else is sent." onMouseDown={(e) => {
              e.preventDefault();
              void askOnline();
            }}>
              <Icon name="osm" size={13} />
              <span class="search-name">{asking ? "Searching OpenStreetMap…" : `Search OpenStreetMap for "${query.trim()}"`}</span>
              <span class="muted search-detail">streets, addresses, landmarks</span>
            </div>
          )}
          {online && <div class="search-empty small">{NOMINATIM_CREDIT}</div>}
        </div>
      )}
    </div>
  );
}
