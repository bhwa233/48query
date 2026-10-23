import { MemberDetailView } from "@/components/dashboard/ExplorerViews";
import { getWebConfig } from "@/config/site";
import { ArchivePageShell } from "@/components/dashboard/ArchivePageShell";

export default async function MemberPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  // oxlint-disable-next-line react/purity -- Serialize one archive cutoff for the member totals and both tab queries.
  const asOf = new Date(Date.now() + 8 * 3600_000 - 86400_000).toISOString().slice(0, 10);
  return <ArchivePageShell><MemberDetailView locale={locale} id={id} apiBaseUrl={getWebConfig().apiBaseUrl} asOf={asOf} /></ArchivePageShell>;
}
