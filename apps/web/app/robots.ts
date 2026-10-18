import type { MetadataRoute } from "next";
import { getSiteOrigin } from "@/config/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: `${getSiteOrigin()}/sitemap.xml`,
  };
}
