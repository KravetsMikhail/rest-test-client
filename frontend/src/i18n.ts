import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ru from "./locales/ru.json";
import en from "./locales/en.json";

const LANGUAGE_KEY = "rest-test-client-language";

function getStoredLanguage(): string {
  if (typeof window === "undefined") return "ru";
  const stored = localStorage.getItem(LANGUAGE_KEY);
  if (stored === "ru" || stored === "en") return stored;
  return "ru";
}

i18n.use(initReactI18next).init({
  resources: {
    ru: { translation: ru },
    en: { translation: en },
  },
  lng: getStoredLanguage(),
  fallbackLng: "ru",
  interpolation: {
    escapeValue: false,
  },
});

i18n.on("languageChanged", (lng) => {
  localStorage.setItem(LANGUAGE_KEY, lng);
});

export { LANGUAGE_KEY, getStoredLanguage };
