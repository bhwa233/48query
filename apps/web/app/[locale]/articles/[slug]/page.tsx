import Link from "next/link";
import { notFound } from "next/navigation";
import { ArticlePageShell } from "@/components/dashboard/ArchivePageShell";
import { getArticle, getArticles } from "@/content";
import { ALL_LOCALES, isLocale } from "@/i18n/config";
import { messages } from "@/i18n/messages";
import { createPageMetadata } from "@/lib/metadata";

type Props = { params: Promise<{ locale: string; slug: string }> };

export function generateStaticParams() {
  return ALL_LOCALES.flatMap((locale) =>
    getArticles(locale).map(({ slug }) => ({ locale, slug })),
  );
}

export async function generateMetadata({ params }: Props) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const article = getArticle(locale, slug);
  if (!article) notFound();
  return createPageMetadata(locale, `/articles/${article.slug}`, article);
}

export default async function ArticlePage({ params }: Props) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const article = getArticle(locale, slug);
  if (!article) notFound();
  const { Content } = article;
  return (
    <ArticlePageShell>
        <header className="mb-6 flex flex-col gap-2">
          <Link className="w-fit text-xs text-muted-foreground underline underline-offset-4" href={`/${locale}/articles`}>{messages[locale].content.back}</Link>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {article.title}
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            {article.description}
          </p>
          <time
            className="text-xs text-muted-foreground"
            dateTime={article.publishedAt}
          >
            {article.publishedAt}
          </time>
        </header>
        <div className="article-body">
          <Content />
        </div>
    </ArticlePageShell>
  );
}
