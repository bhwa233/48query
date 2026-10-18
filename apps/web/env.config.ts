import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { parse } from "jsonc-parser";
import { parseWebEnv } from "../../packages/shared/config.ts";

export function resolveWebEnv(mode: string) {
  const directory = fileURLToPath(new URL(".", import.meta.url));
  const config = parse(
    readFileSync(new URL("./wrangler.jsonc", import.meta.url), "utf8"),
  ) as {
    vars?: { NEXT_PUBLIC_SITE_URL?: string; NEXT_PUBLIC_API_BASE_URL?: string };
  };
  // Vite gives shell variables precedence over .env files, including .env.local.
  const loaded = loadEnv(mode, directory, "NEXT_PUBLIC_");
  const values = { ...config.vars, ...loaded };
  return parseWebEnv(values);
}
