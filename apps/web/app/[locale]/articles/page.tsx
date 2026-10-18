import Link from "next/link";
import { notFound } from "next/navigation";
import { AppPageContainer, SectionIntro } from "@/components/app-page-shell";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
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
    <AppPageContainer width="content">
      <SectionIntro
        title={<h1>{copy.title}</h1>}
        description={copy.description}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {getArticles(locale).map((article) => (
          <Card key={article.slug}>
            <CardHeader>
              <CardTitle>
                <Link
                  className="underline-offset-4 hover:underline"
                  href={`/${locale}/articles/${article.slug}`}
                >
                  {article.title}
                </Link>
              </CardTitle>
              <CardDescription>{article.description}</CardDescription>
              <time
                className="text-sm text-muted-foreground"
                dateTime={article.publishedAt}
              >
                {article.publishedAt}
              </time>
            </CardHeader>
          </Card>
        ))}
      </div>
    </AppPageContainer>
  );
}
