import createMiddleware from "next-intl/middleware";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/config";
import { routing } from "@/i18n/routing";

const handleLocaleRouting = createMiddleware({
  ...routing,
  alternateLinks: false,
});

export function proxy(request: NextRequest) {
  const segment = request.nextUrl.pathname.split("/")[1] ?? "";
  if (isLocale(segment)) return handleLocaleRouting(request);
  const url = request.nextUrl.clone();
  url.pathname =
    request.nextUrl.pathname === "/"
      ? `/${DEFAULT_LOCALE}`
      : `/${DEFAULT_LOCALE}${request.nextUrl.pathname}`;
  return NextResponse.redirect(url, 308);
}

export default proxy;
export const config = { matcher: ["/((?!api|_next|.*\\..*).*)"] };
