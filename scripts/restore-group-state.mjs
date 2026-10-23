import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { tmpdir } from "node:os";

const repository = process.env.GITHUB_REPOSITORY;
const branch = process.env.GITHUB_REF_NAME;
const file = process.env.COLLECTOR_GROUP_STATE;
const artifact = process.env.COLLECTOR_GROUP_ARTIFACT;
if (!repository || !branch || !file || !artifact)
  throw new Error("Set GITHUB_REPOSITORY, GITHUB_REF_NAME, COLLECTOR_GROUP_STATE and COLLECTOR_GROUP_ARTIFACT.");
const exec = promisify(execFile);
// Reuse the Actions runner's gh client. Only this production workflow and the
// current branch can supply progress; never restore an arbitrary matching PR artifact.
const gh = async (args) => (await exec("gh", args, { maxBuffer: 4 * 1024 * 1024 })).stdout;
const runs = JSON.parse(await gh(["run", "list", "--repo", repository, "--workflow", "collector.yml", "--branch", branch,
  "--limit", "30", "--json", "databaseId,status"]));
let restored = false;
let restoredScoped = false;
const checkpointFile = process.env.COLLECTOR_CHECKPOINT_STATE;
const requireRoster = process.env.COLLECTOR_MEMBER_SCOPE === "all" && !process.env.COLLECTOR_MEMBER_ID;
const readState = async path => {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
};
for (const run of runs) {
  if (run.status !== "completed" || String(run.databaseId) === process.env.GITHUB_RUN_ID) continue;
  const response = JSON.parse(await gh(["api", `repos/${repository}/actions/runs/${run.databaseId}/artifacts?per_page=100`]));
  if (!response.artifacts.some(item => item.name === artifact && !item.expired)) continue;
  const candidate = await mkdtemp(join(tmpdir(), "48query-restore-"));
  try {
    await gh(["run", "download", String(run.databaseId), "--repo", repository, "--name", artifact, "--dir", candidate]);
    const state = await readState(join(candidate, basename(file)));
    const checkpoints = checkpointFile ? await readState(join(candidate, basename(checkpointFile))) : null;
    if (state && (state.version !== 1 || !Array.isArray(state.entries) || !state.entries.length)) throw new Error("Restored group progress is invalid.");
    if (checkpoints && (checkpoints.version !== 1 || !checkpoints.members || typeof checkpoints.members !== "object")) throw new Error("Restored scoped progress is invalid.");
    // Reports uploaded by a failed cold start are not resumable progress. A
    // targeted run's scoped file also must not hide an older full-group roster.
    if (!state && !checkpoints) {
      console.log(`Skipping workflow run ${run.databaseId}: artifact has no checkpoint files.`);
      continue;
    }
    if (checkpoints && checkpointFile && !restoredScoped) {
      await mkdir(dirname(resolve(checkpointFile)), { recursive: true });
      await copyFile(join(candidate, basename(checkpointFile)), checkpointFile);
      restoredScoped = true;
    }
    if (state) {
      await mkdir(dirname(resolve(file)), { recursive: true });
      await copyFile(join(candidate, basename(file)), file);
    }
    if (state || !requireRoster && restoredScoped) {
      console.log(`Restored collector progress from workflow run ${run.databaseId}.`);
      restored = true;
      break;
    }
  } finally { await rm(candidate, { recursive: true, force: true }); }
}
if (!restored) console.log("No previous group roster artifact found; this run will initialize the official roster.");
