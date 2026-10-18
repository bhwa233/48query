import assert from "node:assert/strict";
import { test } from "node:test";
import { parseWebEnv, parseCorsOrigins } from "../packages/shared/config.ts";
import { resolveWebEnv } from "../apps/web/env.config.ts";
import { verifyBracesPatch } from "../scripts/lib/patched-braces.mjs";

test("standalone defaults and invalid URL boundaries", () => {
  assert.deepEqual(parseWebEnv({}), {
    siteUrl: "http://localhost:3000",
    apiBaseUrl: "",
  });
  for (const value of [
    "/relative",
    "javascript:alert(1)",
    "https://user:secret@example.org",
    "https://example.org?q=x",
    "https://example.org#hash",
  ]) {
    assert.throws(() => parseWebEnv({ NEXT_PUBLIC_API_BASE_URL: value }));
  }
  assert.throws(() =>
    parseWebEnv({ NEXT_PUBLIC_SITE_URL: "https://example.org/subpath" }),
  );
  assert.equal(
    parseWebEnv({ NEXT_PUBLIC_API_BASE_URL: "https://api.example.org/v1/" })
      .apiBaseUrl,
    "https://api.example.org/v1",
  );
});

test("CORS accepts only exact origins and normalizes duplicates", () => {
  assert.deepEqual(
    parseCorsOrigins(
      "https://site.example.org/, https://site.example.org, http://localhost:3000",
    ),
    ["https://site.example.org", "http://localhost:3000"],
  );
  for (const value of [
    "*",
    "https://site.example.org/path",
    "https://site.example.org?query=true",
  ])
    assert.throws(() => parseCorsOrigins(value));
});

test("shell public variables take precedence over local files and Wrangler vars", () => {
  const previous = {
    site: process.env.NEXT_PUBLIC_SITE_URL,
    api: process.env.NEXT_PUBLIC_API_BASE_URL,
  };
  try {
    process.env.NEXT_PUBLIC_SITE_URL = "https://shell.example.org";
    process.env.NEXT_PUBLIC_API_BASE_URL = "";
    assert.deepEqual(resolveWebEnv("development"), {
      siteUrl: "https://shell.example.org",
      apiBaseUrl: "",
    });
  } finally {
    for (const [key, value] of [
      ["NEXT_PUBLIC_SITE_URL", previous.site],
      ["NEXT_PUBLIC_API_BASE_URL", previous.api],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test(
  "patched braces rejects deeply nested braces and parentheses while preserving normal globs",
  verifyBracesPatch,
);

test("deployment guard rejects placeholders and overrides and accepts customized profiles", async () => {
  const { mkdtemp, mkdir, copyFile, symlink, writeFile, rm } =
    await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { spawnSync } = await import("node:child_process");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), "starter-deploy-check-"));
  try {
    for (const path of ["scripts", "apps/web", "apps/api", "packages/shared"])
      await mkdir(join(directory, path), { recursive: true });
    for (const path of [
      "scripts/verify-deploy-config.mjs",
      "apps/web/env.config.ts",
      "packages/shared/config.ts",
    ])
      await copyFile(join(root, path), join(directory, path));
    await writeFile(join(directory, "package.json"), '{"type":"module"}');
    await symlink(
      join(root, "node_modules"),
      join(directory, "node_modules"),
      "dir",
    );
    await symlink(
      join(root, "apps/web/node_modules"),
      join(directory, "apps/web/node_modules"),
      "dir",
    );
    const run = (profile, values = {}) => {
      const env = { ...process.env };
      delete env.NEXT_PUBLIC_SITE_URL;
      delete env.NEXT_PUBLIC_API_BASE_URL;
      return spawnSync(
        process.execPath,
        [join(directory, "scripts/verify-deploy-config.mjs"), profile],
        {
          env: { ...env, ...values },
          encoding: "utf8",
          cwd: directory,
        },
      );
    };
    for (const [profile, path] of [
      ["web", "apps/web/wrangler.jsonc"],
      ["api", "apps/api/wrangler.jsonc"],
      ["api:db", "apps/api/wrangler.d1.jsonc"],
    ]) {
      await copyFile(join(root, path), join(directory, path));
      const result = run(profile);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Replace the starter Worker name/);
    }
    const vars = {
      NEXT_PUBLIC_SITE_URL: "https://starter-test.org",
      NEXT_PUBLIC_API_BASE_URL: "https://api.starter-test.org",
    };
    await writeFile(
      join(directory, "apps/web/wrangler.jsonc"),
      JSON.stringify({ name: "custom-web", vars }),
    );
    const api = {
      name: "custom-api",
      vars: { CORS_ORIGINS: vars.NEXT_PUBLIC_SITE_URL },
    };
    await writeFile(
      join(directory, "apps/api/wrangler.jsonc"),
      JSON.stringify(api),
    );
    await writeFile(
      join(directory, "apps/api/wrangler.d1.jsonc"),
      JSON.stringify({
        ...api,
        d1_databases: [{ database_id: "12345678-1234-4321-8123-123456789abc" }],
      }),
    );
    for (const profile of ["web", "api", "api:db"]) {
      const result = run(profile);
      assert.equal(result.status, 0, result.stderr);
    }
    await writeFile(
      join(directory, "apps/web/.env.local"),
      "NEXT_PUBLIC_SITE_URL=http://localhost:3000\n",
    );
    const overridden = run("web");
    assert.equal(overridden.status, 1);
    assert.match(
      overridden.stderr,
      /Build-time environment overrides Wrangler URLs/,
    );
    const aligned = run("web", vars);
    assert.equal(aligned.status, 0, aligned.stderr);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
