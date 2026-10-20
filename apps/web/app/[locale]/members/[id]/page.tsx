import { MemberDetailView } from "@/components/dashboard/ExplorerViews";
import { getWebConfig } from "@/config/site";
import { ArchivePageShell } from "@/components/dashboard/ArchivePageShell";

export default async function MemberPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  return <ArchivePageShell><MemberDetailView locale={locale} id={id} apiBaseUrl={getWebConfig().apiBaseUrl} /></ArchivePageShell>;
}
