import type { MetadataRoute } from "next";
import { getSiteOrigin } from "@/config/site";
import { ALL_LOCALES } from "@/i18n/config";
import { getArticles } from "@/content";
import { siteConfig } from "@/config/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = getSiteOrigin();
  return ALL_LOCALES.flatMap((locale) => [
    { url: `${origin}/${locale}` },
    { url: `${origin}/${locale}/members` },
    { url: `${origin}/${locale}/messages` },
    { url: `${origin}/${locale}/images` },
    ...(siteConfig.contentEnabled
      ? [
          { url: `${origin}/${locale}/articles` },
          ...getArticles(locale).map((article) => ({
            url: `${origin}/${locale}/articles/${article.slug}`,
            lastModified: article.publishedAt,
          })),
        ]
      : []),
  ]);
}
