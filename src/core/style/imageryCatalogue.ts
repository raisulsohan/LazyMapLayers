// Open aerial imagery that governments publish for anyone to use, as addresses the "imagery of
// your own" setting can take. Every entry was checked on 2026-09-23: the address answers with a
// JPEG tile, and the terms allow free use, commercial use included, with the credit given here.
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
    maxZoom: 19
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
    maxZoom: 21
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
    maxZoom: 18
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
    maxZoom: 19
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
    maxZoom: 18
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
    maxZoom: 19
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
    maxZoom: 19
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
    maxZoom: 19
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
    maxZoom: 18
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
    maxZoom: 19
  }
];

export const imageryService = (id: string): ImageryService | null => IMAGERY_SERVICES.find((service) => service.id === id) ?? null;

/** The setting a service becomes, at full opacity. */
export const ownImageryFromService = (service: ImageryService): OwnImagery => ({ url: service.url, attribution: service.attribution, opacity: 1, tileSize: service.tileSize, minZoom: service.minZoom, maxZoom: service.maxZoom });
