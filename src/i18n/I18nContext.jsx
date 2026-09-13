import {useEffect, useMemo, useState} from "react";
import {I18nContext} from "./i18nContextInstance";
import {normalizeLang, RTL_LANGS} from "./countries";
import {getMessages, SUPPORTED_LANGS} from "./messages";

function browserLang() {
  if (typeof navigator === "undefined") return "en";
  const tags = navigator.languages?.length
    ? navigator.languages
    : [navigator.language];
  for (const tag of tags) {
    const lang = normalizeLang(tag);
    if (SUPPORTED_LANGS.includes(lang)) return lang;
  }
  return normalizeLang(tags[0]);
}

export function I18nProvider({ children }) {
  const [lang] = useState(() => browserLang());
  const [country] = useState(null);
  const [locale] = useState(
    () => (typeof navigator !== "undefined" && navigator.language) || "en"
  );

  useEffect(() => {
    const t = getMessages(lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL_LANGS.has(lang) ? "rtl" : "ltr";
    document.title = t.title;
  }, [lang]);

  const value = useMemo(() => {
    const t = getMessages(lang);
    return {
      t,
      lang,
      locale,
      country,
      dir: RTL_LANGS.has(lang) ? "rtl" : "ltr",
    };
  }, [lang, locale, country]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
