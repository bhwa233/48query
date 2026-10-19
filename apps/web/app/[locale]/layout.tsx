import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { Button } from "@/components/ui/button";
import { ALL_LOCALES, isLocale, type Locale } from "@/i18n/config";
import { messages } from "@/i18n/messages";
import { siteConfig } from "@/config/site";
import { LocaleSwitch } from "@/components/LocaleSwitch";
import { ArchiveNavigation } from "@/components/dashboard/ArchiveNavigation";
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
            <div className="mx-auto flex min-h-14 w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 sm:px-6 lg:px-8">
              <a
                href={`/${locale}`}
                className="flex shrink-0 items-center gap-2.5 text-base font-semibold tracking-tight"
              >
                <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-lg bg-brand font-mono text-sm font-semibold text-brand-foreground">48</span>{content.siteName}
              </a>
              <nav
                className="order-3 w-full sm:order-none sm:mr-auto sm:w-auto"
                aria-label={content.navigation}
              >
                <ArchiveNavigation locale={locale} />
              </nav>
              <div className="flex items-center gap-1">
                <Button asChild variant="ghost" size="sm">
                  <LocaleSwitch locale={locale} />
                </Button>
                <ModeToggle {...content.theme} />
              </div>
            </div>
          </header>
          <div className="flex min-h-[calc(100vh-3.5rem)] flex-col">
            {children}
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
