import Link from "next/link";
import { notFound } from "next/navigation";
import { AppPageContainer } from "@/components/app-page-shell";
import { siteConfig } from "@/config/site";
import { getArticles } from "@/content";
import { isLocale } from "@/i18n/config";
import { messages } from "@/i18n/messages";
import { createPageMetadata } from "@/lib/metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return createPageMetadata(locale, "/articles", {
    title: messages[locale].content.title,
    description: messages[locale].content.description,
  });
}

export default async function ArticlesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale) || !siteConfig.contentEnabled) notFound();
  const copy = messages[locale].content;
  return (
    <AppPageContainer variant="workspace" width="content" className="gap-3 py-3 sm:gap-4 sm:py-4">
      <header><h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{copy.title}</h1></header>
      <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border bg-card">
        {getArticles(locale).map((article) => (
          <li key={article.slug}><Link className="flex flex-col gap-1 px-3 py-3 hover:bg-muted/40 sm:flex-row sm:items-start sm:justify-between sm:gap-4" href={`/${locale}/articles/${article.slug}`}>
            <div className="min-w-0"><h2 className="text-sm font-medium">{article.title}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{article.description}</p></div>
            <time className="shrink-0 text-xs leading-5 text-muted-foreground" dateTime={article.publishedAt}>{article.publishedAt}</time>
          </Link></li>
        ))}
      </ul>
    </AppPageContainer>
  );
}
