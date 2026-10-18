import { defineRouting } from "next-intl/routing";
import { ALL_LOCALES, DEFAULT_LOCALE } from "./config";

export const routing = defineRouting({
  locales: ALL_LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: "always",
  localeDetection: false,
});
