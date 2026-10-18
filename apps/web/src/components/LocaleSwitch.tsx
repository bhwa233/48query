"use client";

import { usePathname } from "next/navigation";
import type { Locale } from "@/i18n/config";

export function LocaleSwitch({ locale }: { locale: Locale }) {
  const pathname = usePathname() ?? `/${locale}`;
  const nextLocale = locale === "en" ? "zh" : "en";
  const href = pathname.replace(/^\/(?:en|zh)(?=\/|$)/, `/${nextLocale}`);
  return <a href={href}>{locale === "en" ? "中文" : "English"}</a>;
}
