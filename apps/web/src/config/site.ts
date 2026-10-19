export const siteConfig = {
  name: "48query",
  defaultTheme: "dark" as const,
  contentEnabled: true,
};

export function getSiteOrigin() {
  return getWebConfig().siteUrl;
}
import { parseWebEnv } from "@starter/shared/config";

export function getWebConfig() {
  return parseWebEnv({
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  });
}
