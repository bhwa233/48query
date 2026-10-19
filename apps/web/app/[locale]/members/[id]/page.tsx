import { MemberDetailView } from "@/components/dashboard/ExplorerViews";
import { getWebConfig } from "@/config/site";

export default async function MemberPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  return <MemberDetailView locale={locale} id={id} apiBaseUrl={getWebConfig().apiBaseUrl} />;
}
