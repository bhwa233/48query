import { MembersView } from "@/components/dashboard/ExplorerViews";

export default async function MembersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <MembersView locale={locale} />;
}
