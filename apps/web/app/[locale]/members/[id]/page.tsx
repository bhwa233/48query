import { notFound } from "next/navigation";
import { MemberDetailView } from "@/components/dashboard/ExplorerViews";
import { demoMembers } from "@/data/demo";

export function generateStaticParams() { return demoMembers.map((member) => ({ id: member.id })); }

export default async function MemberPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (!demoMembers.some((member) => member.id === id)) notFound();
  return <MemberDetailView locale={locale} id={id} />;
}
