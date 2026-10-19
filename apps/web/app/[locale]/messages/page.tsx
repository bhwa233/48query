import { MessagesView } from "@/components/dashboard/ExplorerViews";
import { getWebConfig } from "@/config/site";

export default async function MessagesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <MessagesView locale={locale} apiBaseUrl={getWebConfig().apiBaseUrl} />;
}
