import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { ArchivePageShell } from "./ArchivePageShell";
import { Button } from "@/components/ui/button";
import { messages } from "@/i18n/messages";
import { isLocale } from "@/i18n/config";
import { RankingDashboard } from "./RankingDashboard";

export function DashboardHome({ locale, apiBaseUrl, yesterday }: { locale: string; apiBaseUrl?: string; yesterday: string }) {
  const t = messages[isLocale(locale) ? locale : "en"].archive;

  return (
    <ArchivePageShell>
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t.rankingTitle}</h1>
        <Button asChild variant="outline" size="sm" className="hidden shrink-0 sm:inline-flex">
          <Link href={`/${locale}/messages`}>{t.exploreContent}<ArrowUpRight data-icon="inline-end" /></Link>
        </Button>
      </header>
      <RankingDashboard locale={locale} apiBaseUrl={apiBaseUrl} yesterday={yesterday} />
    </ArchivePageShell>
  );
}
