import Link from "next/link";
import { createPageMetadata } from "@/lib/metadata";
import { NotesExample } from "@/components/NotesExample";

import { ApiExample } from "@/components/ApiExample";
import {
  AppPageContainer,
  CardGridSection,
  PagePanel,
  PageSection,
  SectionIntro,
} from "@/components/app-page-shell";
import { Button } from "@/components/ui/button";
import { isLocale } from "@/i18n/config";
import { messages } from "@/i18n/messages";
import { getWebConfig } from "@/config/site";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return createPageMetadata(isLocale(locale) ? locale : "en");
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = isLocale(rawLocale) ? rawLocale : "en";
  const content = messages[locale];
  const { apiBaseUrl } = getWebConfig();
  return (
    <AppPageContainer width="wide" variant="marketing">
      <PageSection>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)] lg:items-end">
          <SectionIntro
            eyebrow={content.home.eyebrow}
            title={<h1>{content.home.title}</h1>}
            description={content.home.description}
            titleClassName="text-5xl sm:text-6xl"
          />
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="#example">{content.home.primary}</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="#structure">{content.home.secondary}</Link>
            </Button>
          </div>
        </div>
      </PageSection>
      <PageSection id="structure">
        <PagePanel>
          <div className="grid gap-8 md:grid-cols-2">
            <SectionIntro
              title={
                <h2 className="text-3xl font-semibold tracking-tight">
                  {content.home.apiTitle}
                </h2>
              }
              description={content.home.apiText}
            />
            <SectionIntro
              title={
                <h2 className="text-3xl font-semibold tracking-tight">
                  {content.home.structureTitle}
                </h2>
              }
              description={content.home.structureText}
            />
          </div>
        </PagePanel>
      </PageSection>
      <CardGridSection
        title={content.home.structureTitle}
        items={[
          { title: content.home.webTitle, description: content.home.webText },
          {
            title: content.home.serverTitle,
            description: content.home.serverText,
          },
          { title: content.home.dataTitle, description: content.home.dataText },
        ]}
      />
      <PageSection id="example">
        <ApiExample apiBaseUrl={apiBaseUrl} copy={content.home} />
      </PageSection>
      {apiBaseUrl ? (
        <PageSection>
          <NotesExample apiBaseUrl={apiBaseUrl} copy={content.notes} />
        </PageSection>
      ) : null}
    </AppPageContainer>
  );
}
