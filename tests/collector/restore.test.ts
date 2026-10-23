import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Early failures can upload a health-only artifact. Targeted runs can have only
// scoped checkpoints. Neither may hide an older usable roster during a 502.
test("restore skips report-only artifacts and combines newest scoped progress with a usable saved roster", async () => {
  const directory = await mkdtemp(join(tmpdir(), "48query-restore-"));
  try {
    const output = join(directory, "output");
    const bin = join(directory, "bin");
    await mkdir(bin);
    for (const id of [1, 2, 3]) await mkdir(join(directory, String(id)));
    const roster = { version: 1, entries: [{ candidate: { name: "Saved member" } }] };
    const scoped = { version: 1, members: { newest: [] } };
    await writeFile(join(directory, "3", "health.json"), JSON.stringify({ failures: 1 }));
    await writeFile(join(directory, "2", "scoped-sync.json"), JSON.stringify(scoped));
    await writeFile(join(directory, "1", "progress.json"), JSON.stringify(roster));
    await writeFile(join(directory, "1", "scoped-sync.json"), JSON.stringify({ version: 1, members: { stale: [] } }));
    await writeFile(join(bin, "gh"), `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2), root = process.env.RESTORE_FIXTURE;
if(args[0] === 'api') console.log(JSON.stringify({artifacts:[{name:'progress-live',expired:false}]}));
else if(args[1] === 'list') console.log(JSON.stringify([3,2,1].map(databaseId=>({databaseId,status:'completed'}))));
else if(args[1] === 'download') {
 const source=path.join(root,args[2]), dest=args[args.indexOf('--dir')+1];fs.mkdirSync(dest,{recursive:true});
 for(const name of fs.readdirSync(source)) fs.copyFileSync(path.join(source,name),path.join(dest,name));
} else process.exit(1);
`, { mode: 0o700 });
    await promisify(execFile)(process.execPath, [new URL("../../scripts/restore-group-state.mjs", import.meta.url).pathname], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RESTORE_FIXTURE: directory, GITHUB_REPOSITORY: "fixture/repository",
        GITHUB_REF_NAME: "main", COLLECTOR_GROUP_ARTIFACT: "progress-live", COLLECTOR_MEMBER_SCOPE: "all", COLLECTOR_MEMBER_ID: "",
        COLLECTOR_GROUP_STATE: join(output, "progress.json"), COLLECTOR_CHECKPOINT_STATE: join(output, "scoped-sync.json") }, timeout: 15000,
    });
    assert.deepEqual(JSON.parse(await readFile(join(output, "progress.json"), "utf8")), roster);
    assert.deepEqual(JSON.parse(await readFile(join(output, "scoped-sync.json"), "utf8")), scoped);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
