import { createContext, useContext, type ReactNode } from "react";
import { translations, type Lang } from "./translations";
import { useConfigStore } from "../store/configStore";

interface I18nContextValue {
  t: (key: string, params?: Record<string, string | number>) => string;
  lang: Lang;
  setLang: (lang: Lang) => void;
  ready: boolean;
}

const I18nContext = createContext<I18nContextValue>({
  t: (key: string) => key,
  lang: "zh",
  setLang: () => {},
  ready: false,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const config = useConfigStore((s) => s.config);
  const saveConfig = useConfigStore((s) => s.saveConfig);
  const lang: Lang = config?.language === "en" ? "en" : "zh";

  const t = (key: string, params?: Record<string, string | number>): string => {
    const template = translations[lang][key] || translations.zh[key] || key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));
  };

  const setLang = async (newLang: Lang) => {
    if (!config) return;
    await saveConfig({ ...config, language: newLang });
  };

  return (
    <I18nContext.Provider value={{ t, lang, setLang, ready: config !== null }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
