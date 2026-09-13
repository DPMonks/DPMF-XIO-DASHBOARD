// ISO 3166-1 alpha-2 → BCP 47 locale used for copy and number formatting.
export const COUNTRY_LOCALE = {
  AD: "ca", AE: "ar", AF: "fa", AG: "en", AI: "en", AL: "sq", AM: "hy", AO: "pt",
  AR: "es", AS: "en", AT: "de", AU: "en", AW: "nl", AX: "sv", AZ: "az", BA: "bs",
  BB: "en", BD: "bn", BE: "nl", BF: "fr", BG: "bg", BH: "ar", BI: "fr", BJ: "fr",
  BL: "fr", BM: "en", BN: "ms", BO: "es", BQ: "nl", BR: "pt", BS: "en", BT: "dz",
  BW: "en", BY: "be", BZ: "en", CA: "en", CC: "en", CD: "fr", CF: "fr", CG: "fr",
  CH: "de", CI: "fr", CK: "en", CL: "es", CM: "fr", CN: "zh", CO: "es", CR: "es",
  CU: "es", CV: "pt", CW: "nl", CX: "en", CY: "el", CZ: "cs", DE: "de", DJ: "fr",
  DK: "da", DM: "en", DO: "es", DZ: "ar", EC: "es", EE: "et", EG: "ar", EH: "ar",
  ER: "ti", ES: "es", ET: "am", FI: "fi", FJ: "en", FK: "en", FM: "en", FO: "fo",
  FR: "fr", GA: "fr", GB: "en", GD: "en", GE: "ka", GF: "fr", GG: "en", GH: "en",
  GI: "en", GL: "kl", GM: "en", GN: "fr", GP: "fr", GQ: "es", GR: "el", GT: "es",
  GU: "en", GW: "pt", GY: "en", HK: "zh", HN: "es", HR: "hr", HT: "fr", HU: "hu",
  ID: "id", IE: "en", IL: "he", IM: "en", IN: "hi", IO: "en", IQ: "ar", IR: "fa",
  IS: "is", IT: "it", JE: "en", JM: "en", JO: "ar", JP: "ja", KE: "sw", KG: "ky",
  KH: "km", KI: "en", KM: "ar", KN: "en", KP: "ko", KR: "ko", KW: "ar", KY: "en",
  KZ: "kk", LA: "lo", LB: "ar", LC: "en", LI: "de", LK: "si", LR: "en", LS: "en",
  LT: "lt", LU: "fr", LV: "lv", LY: "ar", MA: "ar", MC: "fr", MD: "ro", ME: "sr",
  MF: "fr", MG: "fr", MH: "en", MK: "mk", ML: "fr", MM: "my", MN: "mn", MO: "zh",
  MP: "en", MQ: "fr", MR: "ar", MS: "en", MT: "mt", MU: "en", MV: "dv", MW: "en",
  MX: "es", MY: "ms", MZ: "pt", NA: "en", NC: "fr", NE: "fr", NF: "en", NG: "en",
  NI: "es", NL: "nl", NO: "nb", NP: "ne", NR: "en", NU: "en", NZ: "en", OM: "ar",
  PA: "es", PE: "es", PF: "fr", PG: "en", PH: "fil", PK: "ur", PL: "pl", PM: "fr",
  PN: "en", PR: "es", PS: "ar", PT: "pt", PW: "en", PY: "es", QA: "ar", RE: "fr",
  RO: "ro", RS: "sr", RU: "ru", RW: "rw", SA: "ar", SB: "en", SC: "fr", SD: "ar",
  SE: "sv", SG: "en", SH: "en", SI: "sl", SJ: "nb", SK: "sk", SL: "en", SM: "it",
  SN: "fr", SO: "so", SR: "nl", SS: "en", ST: "pt", SV: "es", SX: "nl", SY: "ar",
  SZ: "en", TC: "en", TD: "fr", TF: "fr", TG: "fr", TH: "th", TJ: "tg", TK: "en",
  TL: "pt", TM: "tk", TN: "ar", TO: "en", TR: "tr", TT: "en", TV: "en", TW: "zh",
  TZ: "sw", UA: "uk", UG: "en", US: "en", UY: "es", UZ: "uz", VA: "it", VC: "en",
  VE: "es", VG: "en", VI: "en", VN: "vi", VU: "en", WF: "fr", WS: "en", XK: "sq",
  YE: "ar", YT: "fr", ZA: "en", ZM: "en", ZW: "en",
};

export const RTL_LANGS = new Set(["ar", "fa", "he", "ur", "ps", "yi", "dv"]);

export function languageFromCountry(countryCode) {
  if (!countryCode) return "en";
  return COUNTRY_LOCALE[String(countryCode).toUpperCase()] || "en";
}

export function normalizeLang(tag) {
  if (!tag) return "en";
  const base = String(tag).split(/[-_]/)[0].toLowerCase();
  if (base === "no") return "nb";
  if (base === "iw") return "he";
  if (base === "in") return "id";
  if (base === "zh") return "zh";
  return base;
}
