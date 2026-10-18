import { readFile } from "node:fs/promises";
import { parse } from "jsonc-parser";
import { resolveWebEnv } from "../apps/web/env.config.ts";
import { parseCorsOrigins } from "../packages/shared/config.ts";

const mode = process.argv[2] ?? "development";
if (!["development", "production"].includes(mode))
  throw new Error("Use development or production.");
resolveWebEnv(mode);
for (const file of ["wrangler.jsonc", "wrangler.d1.jsonc"]) {
  const config = parse(
    await readFile(new URL(`../apps/api/${file}`, import.meta.url), "utf8"),
  );
  parseCorsOrigins(config.vars?.CORS_ORIGINS);
}
if (process.env.CORS_ORIGINS !== undefined)
  parseCorsOrigins(process.env.CORS_ORIGINS);
console.log(`${mode} environment URLs passed validation.`);
