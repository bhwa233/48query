import { createPageMetadata } from "@/lib/metadata";
import { DashboardHome } from "@/components/dashboard/DashboardHome";
import { getWebConfig } from "@/config/site";
import { isLocale } from "@/i18n/config";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return createPageMetadata(isLocale(locale) ? locale : "en");
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = isLocale(rawLocale) ? rawLocale : "en";
  const { apiBaseUrl } = getWebConfig();
  return <DashboardHome locale={locale} apiBaseUrl={apiBaseUrl} />;
}
