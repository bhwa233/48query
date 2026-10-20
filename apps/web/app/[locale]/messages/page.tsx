import { MessagesView } from "@/components/dashboard/ExplorerViews";
import { getWebConfig } from "@/config/site";
import { ArchivePageShell } from "@/components/dashboard/ArchivePageShell";
import { messages } from "@/i18n/messages";
import { isLocale } from "@/i18n/config";

export default async function MessagesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = messages[isLocale(locale) ? locale : "en"].archive;
  return <ArchivePageShell title={t.messages}><MessagesView locale={locale} apiBaseUrl={getWebConfig().apiBaseUrl} /></ArchivePageShell>;
}
