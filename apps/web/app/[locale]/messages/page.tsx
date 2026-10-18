import { MessagesView } from "@/components/dashboard/ExplorerViews";

export default async function MessagesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <MessagesView locale={locale} />;
}
