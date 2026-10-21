import { readFile, writeFile } from "node:fs/promises";

const file = new URL(process.argv[2] ?? "../apps/api/worker-configuration.d.ts", import.meta.url);
const content = await readFile(file, "utf8");
await writeFile(file, content.replace(/[\t ]+$/gm, ""));
