import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

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
for (const run of runs) {
  if (run.status !== "completed" || String(run.databaseId) === process.env.GITHUB_RUN_ID) continue;
  const response = JSON.parse(await gh(["api", `repos/${repository}/actions/runs/${run.databaseId}/artifacts?per_page=100`]));
  if (!response.artifacts.some(item => item.name === artifact && !item.expired)) continue;
  await mkdir(dirname(resolve(file)), { recursive: true });
  await gh(["run", "download", String(run.databaseId), "--repo", repository, "--name", artifact, "--dir", dirname(resolve(file))]);
  let state;
  try {
    state = JSON.parse(await readFile(file, "utf8"));
    if (state.version !== 1 || !Array.isArray(state.entries) || !state.entries.length) throw new Error("Restored group progress is invalid.");
  } catch (error) {
    if (error.code !== "ENOENT" || !process.env.COLLECTOR_CHECKPOINT_STATE) throw error;
    const checkpoints = JSON.parse(await readFile(process.env.COLLECTOR_CHECKPOINT_STATE, "utf8"));
    if (checkpoints.version !== 1 || !checkpoints.members || typeof checkpoints.members !== "object") throw new Error("Restored scoped progress is invalid.");
  }
  console.log(`Restored collector progress from workflow run ${run.databaseId}.`);
  restored = true;
  break;
}
if (!restored) console.log("No previous group progress artifact found; this run will initialize the official roster.");
