import { MembersView } from "@/components/dashboard/ExplorerViews";
import { getWebConfig } from "@/config/site";

export default async function MembersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <MembersView locale={locale} apiBaseUrl={getWebConfig().apiBaseUrl} />;
}
