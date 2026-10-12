// Open aerial imagery that governments publish for anyone to use, as addresses the "imagery of
// your own" setting can take. Every entry was checked on the date it carries: the address answers
// with a JPEG tile, and the terms allow free use, commercial use included, with the credit given
// here (D60; the WMS services since D103).
// Nothing is bundled and nothing is fetched until the user picks one; the terms stay theirs to keep.

import type { OwnImagery } from "./ownImagery.ts";

export type ImageryService = {
  id: string;
  /** Where the pictures cover. */
  country: string;
  /** Who publishes them, and what. */
  name: string;
  url: string;
  attribution: string;
  /** The licence in a few words. */
  licence: string;
  /** Where the terms are written. */
  terms: string;
  tileSize: 256 | 512;
  /** The zooms the service has tiles for; below the first nothing is asked, above the last tiles are enlarged. */
  minZoom: number | null;
  maxZoom: number;
  /** West, south, east, north: the area it covers, where it is a region of a country. */
  bounds?: [number, number, number, number];
  /** When the address and the licence were checked. */
  checked: string;
};

export const IMAGERY_SERVICES: ImageryService[] = [
  {
    id: "usgs",
    country: "United States",
    name: "USGS The National Map: orthoimagery",
    url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
    attribution: "USGS The National Map: Orthoimagery",
    licence: "Public domain (U.S. Geological Survey)",
    terms: "https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map",
    tileSize: 256,
    minZoom: null,
    maxZoom: 19,
    checked: "2026-09-23"
  },
  {
    id: "pdok",
    country: "Netherlands",
    name: "PDOK Luchtfoto, 8 cm (Beeldmateriaal Nederland)",
    url: "https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg",
    attribution: "Beeldmateriaal Nederland (CC BY 4.0)",
    licence: "CC BY 4.0",
    terms: "https://www.beeldmateriaal.nl/",
    tileSize: 256,
    minZoom: null,
    maxZoom: 21,
    checked: "2026-09-23"
  },
  {
    id: "swisstopo",
    country: "Switzerland",
    name: "swisstopo SWISSIMAGE",
    url: "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg",
    attribution: "© Data: swisstopo",
    licence: "Free under the FSDI terms of use (fair use)",
    terms: "https://www.geo.admin.ch/en/general-terms-of-use-fsdi",
    tileSize: 256,
    minZoom: null,
    maxZoom: 18,
    checked: "2026-09-23"
  },
  {
    id: "ign",
    country: "France",
    name: "IGN BD ORTHO (Géoplateforme)",
    url: "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}",
    attribution: "© IGN, Géoplateforme",
    licence: "Licence Ouverte / Open Licence (Etalab 2.0)",
    terms: "https://cartes.gouv.fr/cgu",
    tileSize: 256,
    minZoom: null,
    maxZoom: 19,
    checked: "2026-09-23"
  },
  {
    id: "gsi",
    country: "Japan",
    name: "GSI seamless aerial photo",
    url: "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg",
    attribution: "地理院タイル (Geospatial Information Authority of Japan)",
    licence: "GSI tile terms: state the source",
    terms: "https://maps.gsi.go.jp/development/ichiran.html",
    tileSize: 256,
    minZoom: 14,
    maxZoom: 18,
    checked: "2026-09-23"
  },
  {
    id: "basemap-at",
    country: "Austria",
    name: "basemap.at orthophoto (30 cm)",
    url: "https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg",
    attribution: "Grundkarte: basemap.at",
    licence: "CC BY 4.0",
    terms: "https://basemap.at/",
    tileSize: 256,
    minZoom: null,
    maxZoom: 19,
    checked: "2026-09-23"
  },
  {
    id: "cuzk",
    country: "Czechia",
    name: "ČÚZK Ortofoto ČR",
    url: "https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/tile/{z}/{y}/{x}",
    attribution: "© ČÚZK",
    licence: "CC BY 4.0",
    terms: "https://geoportal.cuzk.cz/Default.aspx?lng=EN&mode=TextMeta&metadataXSL=full&side=wmts.uvod&metadataID=CZ-CUZK-WMTS-ORTOFOTO_900913",
    tileSize: 256,
    minZoom: null,
    maxZoom: 19,
    checked: "2026-09-23"
  },
  {
    id: "act-lu",
    country: "Luxembourg",
    name: "BD-L-ORTHO (Administration du cadastre et de la topographie)",
    url: "https://wmts1.geoportail.lu/opendata/wmts/ortho_latest/GLOBAL_WEBMERCATOR_4_V3/{z}/{x}/{y}.jpeg",
    attribution: "Administration du cadastre et de la topographie, Luxembourg",
    licence: "CC0 1.0",
    terms: "https://data.public.lu/en/datasets/bd-l-ortho-webservices-wms-et-wmts/",
    tileSize: 256,
    minZoom: null,
    maxZoom: 19,
    checked: "2026-09-23"
  },
  {
    id: "maaamet",
    country: "Estonia",
    name: "Maa-amet orthophoto",
    url: "https://tiles.maaamet.ee/tm/tms/1.0.0/foto@GMC/{z}/{x}/{-y}.png",
    attribution: "Maa-amet (Estonian Land and Spatial Development Board)",
    licence: "CC BY 4.0",
    terms: "https://geoportaal.maaamet.ee/eng/spatial-data/orthophotos-p309.html",
    tileSize: 256,
    minZoom: null,
    maxZoom: 18,
    checked: "2026-09-23"
  },
  {
    id: "pnoa",
    country: "Spain",
    name: "PNOA orthophotos (Instituto Geográfico Nacional)",
    url: "https://www.ign.es/wmts/pnoa-ma?request=GetTile&service=WMTS&version=1.0.0&layer=OI.OrthoimageCoverage&style=default&format=image/jpeg&tilematrixset=GoogleMapsCompatible&tilematrix={z}&tilerow={y}&tilecol={x}",
    attribution: "PNOA © Instituto Geográfico Nacional (CC BY 4.0 scne.es)",
    licence: "CC BY 4.0 SCNE",
    terms: "https://www.scne.es/",
    tileSize: 256,
    minZoom: null,
    maxZoom: 19,
    checked: "2026-09-23"
  },
  // WMS services (D103), each a region of its country, asked one Web Mercator tile at a time.
  {
    id: "de-nw",
    country: "Germany (North Rhine-Westphalia)",
    name: "Geobasis NRW digital orthophotos (DOP)",
    url: "https://www.wms.nrw.de/geobasis/wms_nw_dop?language=ger&SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=nw_dop_rgb&STYLES=&FORMAT=image%2Fjpeg&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}",
    attribution: "Geobasis NRW (dl-de/zero-2-0)",
    licence: "Datenlizenz Deutschland – Zero 2.0: any use, no conditions",
    terms: "https://www.govdata.de/dl-de/zero-2-0",
    tileSize: 256,
    minZoom: null,
    maxZoom: 20,
    bounds: [5.593, 50.058, 9.742, 52.8],
    checked: "2026-10-12"
  },
  {
    id: "de-by",
    country: "Germany (Bavaria)",
    name: "Bavarian surveying administration orthophotos (DOP40)",
    url: "https://geoservices.bayern.de/od/wms/dop/v1/dop40?language=ger&SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=by_dop40c&STYLES=&FORMAT=image%2Fjpeg&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}",
    attribution: "© Bayerische Vermessungsverwaltung (CC BY 4.0)",
    licence: "CC BY 4.0",
    terms: "https://creativecommons.org/licenses/by/4.0/",
    tileSize: 256,
    minZoom: 8,
    maxZoom: 19,
    bounds: [8.958, 47.118, 14.038, 50.633],
    checked: "2026-10-12"
  },
  {
    id: "de-bb",
    country: "Germany (Brandenburg and Berlin)",
    name: "LGB orthophotos (DOP20c)",
    url: "https://isk.geobasis-bb.de/mapproxy/dop20c/service/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=bebb_dop20c&STYLES=&FORMAT=image%2Fjpeg&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}",
    attribution: "© GeoBasis-DE/LGB, dl-de/by-2-0; © Geoportal Berlin, dl-de/by-2-0",
    licence: "Datenlizenz Deutschland – Namensnennung 2.0",
    terms: "https://www.govdata.de/dl-de/by-2-0",
    tileSize: 256,
    minZoom: null,
    maxZoom: 20,
    bounds: [11.229, 51.306, 14.77, 53.573],
    checked: "2026-10-12"
  },
  {
    id: "de-be",
    country: "Germany (Berlin)",
    name: "Geoportal Berlin true orthophotos 2024",
    url: "https://gdi.berlin.de/services/wms/truedop_2024?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=truedop_2024&STYLES=&FORMAT=image%2Fjpeg&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}",
    attribution: "Geoportal Berlin / Digitale farbige TrueOrthophotos 2024 (dl-de/zero-2-0)",
    licence: "Datenlizenz Deutschland – Zero 2.0: any use, no conditions",
    terms: "https://www.govdata.de/dl-de/zero-2-0",
    tileSize: 256,
    minZoom: null,
    maxZoom: 20,
    bounds: [13.048, 52.316, 13.767, 52.685],
    checked: "2026-10-12"
  },
  {
    id: "de-ni",
    country: "Germany (Lower Saxony)",
    name: "LGLN orthophotos (DOP20)",
    url: "https://opendata.lgln.niedersachsen.de/doorman/noauth/dop_wms?language=ger&SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=ni_dop20&STYLES=&FORMAT=image%2Fjpeg&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}",
    attribution: "LGLN (2026), CC BY 4.0",
    licence: "CC BY 4.0, with LGLN and the year the data was taken",
    terms: "https://creativecommons.org/licenses/by/4.0/",
    tileSize: 256,
    minZoom: null,
    maxZoom: 20,
    bounds: [6.506, 51.153, 11.754, 54.148],
    checked: "2026-10-12"
  },
  {
    id: "de-th",
    country: "Germany (Thuringia)",
    name: "GDI-Th orthophotos (DOP)",
    url: "https://www.geoproxy.geoportal-th.de/geoproxy/services/DOP?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=th_dop&STYLES=&FORMAT=image%2Fjpeg&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}",
    attribution: "© GDI-Th (CC BY 4.0)",
    licence: "CC BY 4.0",
    terms: "https://creativecommons.org/licenses/by/4.0/",
    tileSize: 256,
    minZoom: 9,
    maxZoom: 20,
    bounds: [9.855, 50.154, 12.712, 51.664],
    checked: "2026-10-12"
  },
  {
    id: "be-vl",
    country: "Belgium (Flanders)",
    name: "Digitaal Vlaanderen orthophoto mosaic, most recent",
    url: "https://geo.api.vlaanderen.be/OMWRGBMRVL/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=Ortho&STYLES=&FORMAT=image%2Fjpeg&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}",
    attribution: "Digitaal Vlaanderen (Vlaamse Open Data licentie)",
    licence: "Flemish Open Data Licence v1.2: any lawful use, commercial included, with the source named",
    terms: "https://www.vlaanderen.be/digitaal-vlaanderen/nieuws/release-orthofotomozaiek-middenschalig-2025",
    tileSize: 256,
    minZoom: null,
    maxZoom: 19,
    bounds: [2.52, 50.64, 5.94, 51.51],
    checked: "2026-10-12"
  }
];

export const imageryService = (id: string): ImageryService | null => IMAGERY_SERVICES.find((service) => service.id === id) ?? null;

/** The setting a service becomes, at full opacity. */
export const ownImageryFromService = (service: ImageryService): OwnImagery => ({ url: service.url, attribution: service.attribution, opacity: 1, tileSize: service.tileSize, minZoom: service.minZoom, maxZoom: service.maxZoom, ...(service.bounds ? { bounds: service.bounds } : {}) });
