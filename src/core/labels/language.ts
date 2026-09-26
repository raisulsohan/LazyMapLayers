// Label languages: the local language of a place (by country, with a few regional exceptions) among the
// 26 name languages Natural Earth carries, and the writing system of a text for font choice.

export const NAME_LANGUAGES = ["ar", "bn", "de", "el", "en", "es", "fa", "fr", "he", "hi", "hu", "id", "it", "ja", "ko", "nl", "pl", "pt", "ru", "sv", "tr", "uk", "ur", "vi", "zh", "zht"] as const;
export type NameLanguage = (typeof NAME_LANGUAGES)[number];

const byCountry: Record<string, NameLanguage> = {};
const assign = (language: NameLanguage, codes: string) => {
  for (const code of codes.split(/\s+/)) if (code) byCountry[code] = language;
};
assign("ar", "EGY SAU ARE IRQ SYR JOR LBN DZA MAR TUN LBY SDN YEM OMN QAT KWT BHR MRT PSX PSE SAH COM DJI");
assign("bn", "BGD");
assign("de", "DEU AUT LIE CHE");
assign("el", "GRC CYP");
assign("es", "ESP MEX ARG COL PER VEN CHL ECU GTM CUB BOL DOM HND PRY SLV NIC CRI PAN URY GNQ");
assign("fa", "IRN AFG TJK");
assign("fr", "FRA BEL MCO LUX SEN CIV MLI BFA NER TCD GIN BEN TGO CAF COG COD GAB CMR MDG HTI");
assign("he", "ISR");
assign("hi", "IND");
assign("hu", "HUN");
assign("id", "IDN");
assign("it", "ITA SMR VAT");
assign("ja", "JPN");
assign("ko", "KOR PRK");
assign("nl", "NLD SUR");
assign("pl", "POL");
assign("pt", "PRT BRA AGO MOZ GNB CPV STP TLS");
assign("ru", "RUS BLR KAZ KGZ");
assign("sv", "SWE");
assign("tr", "TUR");
assign("uk", "UKR");
assign("ur", "PAK");
assign("vi", "VNM");
assign("zh", "CHN SGP");
assign("zht", "TWN HKG MAC");

/** Regions whose local language differs from the country's main one. */
const byRegion: Record<string, NameLanguage> = {
  "IND/West Bengal": "bn",
  "IND/Tripura": "bn",
  "CAN/Québec": "fr",
  "CAN/Quebec": "fr",
  "BEL/Flemish": "nl",
  "CHE/Genève": "fr",
  "CHE/Vaud": "fr",
  "CHE/Ticino": "it"
};

/** The local language for a place, or English where none of the 26 languages is local. */
export function localLanguage(country: string, region?: string): NameLanguage {
  if (region) {
    const regional = byRegion[`${country}/${region}`];
    if (regional) return regional;
  }
  return byCountry[country] ?? "en";
}

export type LabelNames = Partial<Record<NameLanguage, string>>;

export type LabelLanguageMode = { kind: "local" } | { kind: "fixed"; language: NameLanguage };

/** The primary text and, when it differs, an English subtitle. */
export function labelText(names: LabelNames, country: string, region: string | undefined, mode: LabelLanguageMode = { kind: "local" }, withEnglish = true): { text: string; subtitle: string | null; language: NameLanguage } {
  const language = mode.kind === "fixed" ? mode.language : localLanguage(country, region);
  const text = names[language] ?? names.en ?? Object.values(names)[0] ?? "";
  const english = names.en ?? null;
  const subtitle = withEnglish && english && english !== text && language !== "en" ? english : null;
  return { text, subtitle, language: names[language] ? language : "en" };
}

export type Script = "latin" | "cyrillic" | "greek" | "arabic" | "hebrew" | "devanagari" | "bengali" | "thai" | "han" | "japanese" | "hangul";

/** The dominant writing system of a text (by the first letter outside basic punctuation). */
export function scriptOf(text: string): Script {
  let hasHan = false;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if ((c >= 0x3040 && c <= 0x30ff) || (c >= 0x31f0 && c <= 0x31ff)) return "japanese";
    if (c >= 0xac00 && c <= 0xd7af) return "hangul";
    if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf)) hasHan = true;
    else if (c >= 0x0600 && c <= 0x06ff) return "arabic";
    else if (c >= 0x0590 && c <= 0x05ff) return "hebrew";
    else if (c >= 0x0900 && c <= 0x097f) return "devanagari";
    else if (c >= 0x0980 && c <= 0x09ff) return "bengali";
    else if (c >= 0x0e00 && c <= 0x0e7f) return "thai";
    else if (c >= 0x0400 && c <= 0x04ff) return "cyrillic";
    else if (c >= 0x0370 && c <= 0x03ff) return "greek";
  }
  return hasHan ? "han" : "latin";
}

/**
 * Fonts per script, as PostScript names, in order of preference: Windows system fonts, then macOS,
 * then Noto (free, any platform). The host picks the first one After Effects has.
 */
export const SCRIPT_FONTS: Record<Script, { bold: string[]; regular: string[]; css: string }> = {
  latin: { bold: ["SegoeUI-Semibold", "HelveticaNeue-Medium", "NotoSans-SemiBold", "ArialMT"], regular: ["SegoeUI", "HelveticaNeue", "NotoSans-Regular", "ArialMT"], css: "Segoe UI, Helvetica Neue, Noto Sans, Arial" },
  cyrillic: { bold: ["SegoeUI-Semibold", "HelveticaNeue-Medium", "NotoSans-SemiBold", "ArialMT"], regular: ["SegoeUI", "HelveticaNeue", "NotoSans-Regular", "ArialMT"], css: "Segoe UI, Helvetica Neue, Noto Sans, Arial" },
  greek: { bold: ["SegoeUI-Semibold", "HelveticaNeue-Medium", "NotoSans-SemiBold", "ArialMT"], regular: ["SegoeUI", "HelveticaNeue", "NotoSans-Regular", "ArialMT"], css: "Segoe UI, Helvetica Neue, Noto Sans, Arial" },
  arabic: { bold: ["SegoeUI-Semibold", "GeezaPro-Bold", "NotoSansArabic-SemiBold", "ArialMT"], regular: ["SegoeUI", "GeezaPro", "NotoSansArabic-Regular", "ArialMT"], css: "Segoe UI, Geeza Pro, Noto Sans Arabic, Arial" },
  hebrew: { bold: ["SegoeUI-Semibold", "ArialHebrew-Bold", "NotoSansHebrew-SemiBold", "ArialMT"], regular: ["SegoeUI", "ArialHebrew", "NotoSansHebrew-Regular", "ArialMT"], css: "Segoe UI, Arial Hebrew, Noto Sans Hebrew, Arial" },
  devanagari: { bold: ["NirmalaUI-Bold", "KohinoorDevanagari-Semibold", "NotoSansDevanagari-SemiBold"], regular: ["NirmalaUI", "KohinoorDevanagari-Regular", "NotoSansDevanagari-Regular"], css: "Nirmala UI, Kohinoor Devanagari, Noto Sans Devanagari" },
  bengali: { bold: ["NirmalaUI-Bold", "KohinoorBangla-Semibold", "NotoSansBengali-SemiBold"], regular: ["NirmalaUI", "KohinoorBangla-Regular", "NotoSansBengali-Regular"], css: "Nirmala UI, Kohinoor Bangla, Noto Sans Bengali" },
  thai: { bold: ["LeelawadeeUI-Bold", "Thonburi-Bold", "NotoSansThai-SemiBold"], regular: ["LeelawadeeUI", "Thonburi", "NotoSansThai-Regular"], css: "Leelawadee UI, Thonburi, Noto Sans Thai" },
  han: { bold: ["MicrosoftYaHei-Bold", "PingFangSC-Semibold", "NotoSansCJKsc-Bold", "NotoSansSC-Bold"], regular: ["MicrosoftYaHei", "PingFangSC-Regular", "NotoSansCJKsc-Regular", "NotoSansSC-Regular"], css: "Microsoft YaHei, PingFang SC, Noto Sans SC" },
  japanese: { bold: ["YuGothic-Bold", "HiraginoSans-W6", "NotoSansCJKjp-Bold", "NotoSansJP-Bold"], regular: ["YuGothic-Regular", "HiraginoSans-W3", "NotoSansCJKjp-Regular", "NotoSansJP-Regular"], css: "Yu Gothic, Hiragino Sans, Noto Sans JP" },
  hangul: { bold: ["MalgunGothicBold", "AppleSDGothicNeo-Bold", "NotoSansCJKkr-Bold", "NotoSansKR-Bold"], regular: ["MalgunGothic", "AppleSDGothicNeo-Regular", "NotoSansCJKkr-Regular", "NotoSansKR-Regular"], css: "Malgun Gothic, Apple SD Gothic Neo, Noto Sans KR" }
};

/**
 * Italic fonts for the names of water, as PostScript names, where a script has italics at all
 * (Latin, Cyrillic, Greek). Other scripts are written upright: slanting them only damages them.
 */
export const ITALIC_FONTS: Partial<Record<Script, string[]>> = {
  latin: ["SegoeUI-SemiboldItalic", "SegoeUI-Italic", "HelveticaNeue-MediumItalic", "HelveticaNeue-Italic", "NotoSans-SemiBoldItalic", "NotoSans-Italic", "Arial-ItalicMT"],
  cyrillic: ["SegoeUI-SemiboldItalic", "SegoeUI-Italic", "HelveticaNeue-MediumItalic", "HelveticaNeue-Italic", "NotoSans-SemiBoldItalic", "NotoSans-Italic", "Arial-ItalicMT"],
  greek: ["SegoeUI-SemiboldItalic", "SegoeUI-Italic", "HelveticaNeue-MediumItalic", "HelveticaNeue-Italic", "NotoSans-SemiBoldItalic", "NotoSans-Italic", "Arial-ItalicMT"]
};
