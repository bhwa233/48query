export const ALL_LOCALES = ["en", "zh"] as const;
export type Locale = (typeof ALL_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export function isLocale(value: string): value is Locale {
  return (ALL_LOCALES as readonly string[]).includes(value);
}
