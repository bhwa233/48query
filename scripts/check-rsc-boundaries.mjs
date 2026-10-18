import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

async function walk(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) paths.push(...(await walk(path)));
    else if (/\/(page|layout)\.tsx$/.test(path)) paths.push(path);
  }
  return paths;
}

const directory = fileURLToPath(new URL("../apps/web/app", import.meta.url));
for (const path of await walk(directory)) {
  const source = await readFile(path, "utf8");
  // Ignore a leading BOM, whitespace, and comments before checking directives.
  const prefix = source
    .replace(/^\uFEFF/, "")
    .replace(/^(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$))*/, "");
  if (/^(?:"use client"|'use client')(?:\s*;|\s*\n)/.test(prefix)) {
    throw new Error(
      `Route pages and layouts must remain server components: ${path}`,
    );
  }
}
console.log("RSC page and layout boundaries passed.");
