import { readFile, writeFile } from "node:fs/promises";

// The Cloudflare Vite plugin emits this CLI-only field; Wrangler deployment rejects it.
const file = new URL("../apps/web/dist/server/wrangler.json", import.meta.url);
const config = JSON.parse(await readFile(file, "utf8"));
delete config.legacy_env;
await writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
