import WelcomeEn from "../../content/en/welcome.mdx";
import WelcomeZh from "../../content/zh/welcome.mdx";
import type { Locale } from "@/i18n/config";
import { messages } from "@/i18n/messages";
import { siteConfig } from "@/config/site";

export function getArticles(locale: Locale) {
  if (!siteConfig.contentEnabled) return [];
  return [
    {
      slug: "welcome",
      publishedAt: "2026-10-18",
      ...messages[locale].content.articles.welcome,
      Content: locale === "zh" ? WelcomeZh : WelcomeEn,
    },
  ];
}

export function getArticle(locale: Locale, slug: string) {
  return getArticles(locale).find((article) => article.slug === slug);
}
