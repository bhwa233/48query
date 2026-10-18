import type { Metadata } from "next";
import { getSiteOrigin } from "@/config/site";
import { ALL_LOCALES, type Locale } from "@/i18n/config";
import { messages } from "@/i18n/messages";

export function createPageMetadata(
  locale: Locale,
  pathname = "",
  page?: { title: string; description: string },
): Metadata {
  const origin = getSiteOrigin();
  const content = messages[locale];
  return {
    metadataBase: new URL(origin),
    ...(page ? { title: page.title } : {}),
    description: page?.description ?? content.metadataDescription,
    alternates: {
      canonical: `${origin}/${locale}${pathname}`,
      languages: Object.fromEntries(
        ALL_LOCALES.map((language) => [
          language === "zh" ? "zh-CN" : "en",
          `${origin}/${language}${pathname}`,
        ]),
      ),
    },
    openGraph: {
      title: page?.title ?? content.siteName,
      description: page?.description ?? content.metadataDescription,
      url: `${origin}/${locale}${pathname}`,
      type: "website",
      locale: locale === "zh" ? "zh_CN" : "en_US",
    },
  };
}
