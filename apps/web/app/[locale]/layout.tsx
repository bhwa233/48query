import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { Button } from "@/components/ui/button";
import { ALL_LOCALES, isLocale, type Locale } from "@/i18n/config";
import { messages } from "@/i18n/messages";
import { siteConfig } from "@/config/site";
import { LocaleSwitch } from "@/components/LocaleSwitch";
import "../globals.css";

export const dynamicParams = false;

export function generateStaticParams() {
  return ALL_LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const content = messages[isLocale(locale) ? locale : "en"];
  return {
    icons: { icon: "/favicon.svg" },
    title: { default: content.siteName, template: `%s | ${content.siteName}` },
    description: content.metadataDescription,
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  if (!isLocale(rawLocale)) notFound();
  const locale: Locale = rawLocale;
  const content = messages[locale];
  const navLabels = content.archive;

  return (
    <html lang={locale === "zh" ? "zh-CN" : "en"} suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme={siteConfig.defaultTheme}
          enableSystem
          disableTransitionOnChange
        >
          <header className="border-b bg-background/90 backdrop-blur">
            <div className="mx-auto flex h-16 w-full max-w-[92rem] items-center justify-between px-4 sm:px-6 lg:px-8">
              <a
                href={`/${locale}`}
                className="mr-3 min-w-0 truncate text-sm font-semibold tracking-tight sm:text-base"
              >
                {content.siteName}
              </a>
              <nav
                className="flex items-center gap-2"
                aria-label={content.navigation}
              >
                <Button asChild variant="ghost" size="sm"><a href={`/${locale}/members`}>{navLabels.members}</a></Button>
                <Button asChild variant="ghost" size="sm"><a href={`/${locale}/messages`}>{navLabels.messages}</a></Button>
                <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex"><a href={`/${locale}/images`}>{navLabels.images}</a></Button>
                <Button asChild variant="ghost" size="sm">
                  <LocaleSwitch locale={locale} />
                </Button>
                <ModeToggle {...content.theme} />
              </nav>
            </div>
          </header>
          <div className="flex min-h-[calc(100vh-4rem)] flex-col">
            {children}
          </div>
          <footer className="border-t py-6 text-center text-sm text-muted-foreground">
            <p>{content.archive.footer}</p>
          </footer>
        </ThemeProvider>
      </body>
    </html>
  );
}
