import { readFile } from "node:fs/promises";
import { parse, printParseErrorCode } from "jsonc-parser";
import { parseHttpUrl, parseCorsOrigins } from "../packages/shared/config.ts";

const profile = process.argv[2] ?? "web";
if (!["web", "api", "api:db"].includes(profile))
  throw new Error("Use web, api, or api:db.");
const file =
  profile === "web"
    ? "apps/web/wrangler.jsonc"
    : profile === "api:db"
      ? "apps/api/wrangler.d1.jsonc"
      : "apps/api/wrangler.jsonc";
const errors = [];
const config = parse(
  await readFile(new URL(`../${file}`, import.meta.url), "utf8"),
  errors,
  { allowTrailingComma: true },
);
if (errors.length)
  throw new Error(
    `${file}: ${errors.map((error) => printParseErrorCode(error.error)).join(", ")}`,
  );
const problems = [];
function isPublicHttps(value) {
  try {
    parseHttpUrl(value, "deployment URL");
    const url = new URL(value);
    return (
      !url.hostname.startsWith("127.") &&
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !["localhost", "127.0.0.1", "[::1]", "example.com"].includes(
        url.hostname,
      ) &&
      !url.hostname.endsWith(".localhost") &&
      !url.hostname.endsWith(".example.com")
    );
  } catch {
    return false;
  }
}
if (!config.name || config.name.startsWith("starter-"))
  problems.push("Replace the starter Worker name.");
if (profile === "web") {
  if (!isPublicHttps(config.vars?.NEXT_PUBLIC_SITE_URL))
    problems.push("Set a production HTTPS site URL.");
  const api = config.vars?.NEXT_PUBLIC_API_BASE_URL;
  if (api && api !== "/" && !isPublicHttps(api))
    problems.push("Use a same-origin / or HTTPS API URL, or leave it empty for standalone Web.");
  if (api === "/" && !config.services?.some(service => service.binding === "QUERY_API" && service.service && !service.service.startsWith("starter-")))
    problems.push("Same-origin queries require a QUERY_API service binding.");
  const { resolveWebEnv } = await import("../apps/web/env.config.ts");
  const effective = resolveWebEnv("production");
  if (
    effective.siteUrl !==
      config.vars?.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    effective.apiBaseUrl !== (api === "/" ? "/" : (api ?? "").replace(/\/$/, ""))
  )
    problems.push(
      "Build-time environment overrides Wrangler URLs. Align shell/.env files with production vars before deployment.",
    );
} else {
  const origins = parseCorsOrigins(config.vars?.CORS_ORIGINS);
  if (!origins.length || !origins.every(isPublicHttps))
    problems.push("Set production HTTPS CORS origins.");
}
if (
  profile === "api:db" &&
  (!config.d1_databases?.length ||
    config.d1_databases.some(
      (db) =>
        !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
          db.database_id,
        ) || /^0{8}-/.test(db.database_id),
    ))
)
  problems.push("Replace the D1 database ID.");
if (problems.length) throw new Error(`${file}:\n${problems.join("\n")}`);
console.log(`${profile} deployment configuration is ready.`);
