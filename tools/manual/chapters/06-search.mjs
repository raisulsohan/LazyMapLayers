// Chapter 6: search, offline in 26 languages, coordinates, and the offer to search OpenStreetMap.

export async function run(s) {
  await s.newMap("Search", { center: { lat: 20, lng: 60 }, zoom: 2, bearing: 0, pitch: 0 }, { duration: 5 });
  const results = { x: 0, y: 60, width: 520, height: 330 };
  await s.type(`[data-id="search"]`, "Lagos");
  await new Promise((r) => setTimeout(r, 700));
  await s.shot("06-search-lagos", { clip: results });
  await s.type(`[data-id="search"]`, "ঢাকা");
  await new Promise((r) => setTimeout(r, 700));
  await s.shot("06-search-bengali", { clip: results });
  await s.type(`[data-id="search"]`, "東京");
  await new Promise((r) => setTimeout(r, 700));
  await s.shot("06-search-japanese", { clip: results });
  await s.type(`[data-id="search"]`, "Bavaria");
  await new Promise((r) => setTimeout(r, 700));
  await s.shot("06-search-province", { clip: results });
  await s.type(`[data-id="search"]`, "Kilimanjaro");
  await new Promise((r) => setTimeout(r, 700));
  await s.shot("06-search-nature", { clip: results });
  await s.type(`[data-id="search"]`, "-33.8568, 151.2153");
  await new Promise((r) => setTimeout(r, 700));
  await s.shot("06-search-coordinates", { clip: results });
  await s.type(`[data-id="search"]`, "Baker Street 221");
  await new Promise((r) => setTimeout(r, 700));
  await s.shot("06-search-online-offer", { clip: results, mark: ["search-online"] });
  // Choosing a result: Enter goes to the first one.
  await s.type(`[data-id="search"]`, "Cape Town");
  await new Promise((r) => setTimeout(r, 700));
  await s.js(`(document.querySelector('[data-id="search"]').dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })), true)`);
  await new Promise((r) => setTimeout(r, 2500));
  await s.type(`[data-id="search"]`, "", true);
  await s.shot("06-went-to-cape-town");
}
