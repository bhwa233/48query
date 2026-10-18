import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";

export function verifyBracesPatch() {
  let require = createRequire(
    `${realpathSync(new URL("../../apps/web/node_modules/vinext", import.meta.url))}/package.json`,
  );
  for (const name of [
    "vite-plugin-commonjs",
    "vite-plugin-dynamic-import",
    "fast-glob",
    "micromatch",
  ]) {
    require = createRequire(require.resolve(name));
  }
  const braces = require("braces");
  assert.deepEqual(braces.expand("src/{app,lib}/*.{ts,tsx}"), [
    "src/app/*.ts",
    "src/app/*.tsx",
    "src/lib/*.ts",
    "src/lib/*.tsx",
  ]);
  for (const [open, close] of [
    ["{", "}"],
    ["(", ")"],
    ["{(", ")}"],
  ]) {
    const pattern = open.repeat(2000) + "x" + close.repeat(2000);
    for (const operation of [braces.parse, braces.compile, braces.expand]) {
      assert.throws(() => operation(pattern), {
        name: "SyntaxError",
        message: /maximum depth \(128\)/,
      });
    }
  }
}
