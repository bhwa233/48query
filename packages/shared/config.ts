// Shared URL rules for runtime configuration and deployment checks.
export function parseHttpUrl(value: string, name: string, originOnly = false) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL.`);
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (originOnly && url.pathname !== "/")
  ) {
    throw new Error(
      `${name} must be an HTTP(S) ${originOnly ? "origin" : "URL"} without credentials, query, or fragment.`,
    );
  }
  return originOnly ? url.origin : url.href.replace(/\/$/, "");
}

export function parseWebEnv(env: {
  NEXT_PUBLIC_SITE_URL?: string;
  NEXT_PUBLIC_API_BASE_URL?: string;
}) {
  return {
    siteUrl: parseHttpUrl(
      env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000",
      "NEXT_PUBLIC_SITE_URL",
      true,
    ),
    apiBaseUrl: env.NEXT_PUBLIC_API_BASE_URL?.trim() === "/" ? "/" : env.NEXT_PUBLIC_API_BASE_URL?.trim()
      ? parseHttpUrl(
          env.NEXT_PUBLIC_API_BASE_URL.trim(),
          "NEXT_PUBLIC_API_BASE_URL",
        )
      : "",
  };
}

export function parseCorsOrigins(value = "") {
  return [
    ...new Set(
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
        .map((origin) => parseHttpUrl(origin, "CORS_ORIGINS", true)),
    ),
  ];
}
