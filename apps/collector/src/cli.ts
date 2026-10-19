import { DemoSource } from "./demo-source";
import { DryRunStore } from "./dry-run-store";
import { HttpIngestStore } from "./http-store";
import { Pocket48Source } from "./pocket48-source";
import { createPocket48Pa, loadCredential, CREDENTIAL_PATH } from "./pocket48-auth.mjs";
import { runBatch } from "./run";

async function loadProductionCredential() {
  const endpoint = process.env.COLLECTOR_CREDENTIALS_URL?.trim();
  const readToken = process.env.COLLECTOR_CREDENTIAL_READ_TOKEN?.trim();
  if (!endpoint && !readToken) return loadCredential();
  if (!endpoint || !readToken) throw new Error("Collector credential endpoint and read token must be configured together.");
  let response;
  try {
    response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${readToken}` },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error("Unable to reach the collector credential endpoint.");
  }
  if (!response.ok) throw new Error(`Collector credential endpoint returned HTTP ${response.status}.`);
  const payload: unknown = await response.json().catch(() => null) as unknown;
  const payloadRecord = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
  const data = payloadRecord?.data && typeof payloadRecord.data === "object"
    ? payloadRecord.data as Record<string, unknown>
    : null;
  const token = typeof data?.token === "string" ? data.token.trim() : "";
  const deviceId = typeof data?.deviceId === "string" ? data.deviceId.trim() : "";
  if (!token || !deviceId) throw new Error("Collector credential endpoint returned an invalid credential.");
  return { token, deviceId };
}

const dryRun = process.argv.includes("--dry-run") || process.env.COLLECTOR_DRY_RUN === "1";
const sourceName = process.env.COLLECTOR_SOURCE ?? "demo";
const memberId = process.env["COLLECTOR_MEMBER_ID"]?.trim();
const memberScope = process.env["COLLECTOR_MEMBER_SCOPE"]?.trim() || "followed";
if (memberScope !== "followed" && memberScope !== "all") throw new Error("COLLECTOR_MEMBER_SCOPE must be followed or all.");
const stored = sourceName === "pocket48" ? await loadProductionCredential() : null;
const sourceOptions = {
  ["token"]: process.env["POCKET48_TOKEN"] ?? stored?.token ?? "",
  deviceId: process.env["POCKET48_DEVICE_ID"] ?? stored?.deviceId,
  pa: process.env["POCKET48_PA"],
  paFactory: process.env["POCKET48_PA"] ? undefined : createPocket48Pa,
  apiBaseUrl: process.env["POCKET48_API_BASE_URL"],
  directoryUrl: process.env["POCKET48_DIRECTORY_URL"],
  minIntervalMs: Number(process.env["POCKET48_MIN_INTERVAL_MS"] ?? 5000),
  memberScope: memberId ? "all" : memberScope,
} satisfies ConstructorParameters<typeof Pocket48Source>[0];
const source = sourceName === "demo"
  ? new DemoSource()
  : sourceName === "pocket48"
    ? new Pocket48Source(sourceOptions)
    : (() => { throw new Error(`Unsupported collector source: ${sourceName}.`); })();
const batchSource = memberId
  ? {
    listMembers: async () => (await source.listMembers()).filter((member) => member.id === memberId),
    listMessages: source.listMessages.bind(source),
    listRecordings: source.listRecordings.bind(source),
  }
  : source;
const endpoint = process.env["INGEST_API_URL"];
const authKey = process.env["INGEST_KEY"];
const store = !dryRun && endpoint && authKey ? new HttpIngestStore(endpoint, authKey) : new DryRunStore();

if (sourceName === "pocket48" && !sourceOptions["token"]) throw new Error(`Pocket48 credential not found. Run the login command first: ${CREDENTIAL_PATH}`);
if (!dryRun && (!endpoint || !authKey)) console.warn("INGEST_API_URL and INGEST_KEY are missing; using dry-run store.");
const maxMembers = Number(process.env["COLLECTOR_MAX_MEMBERS"] ?? 0);
const maxPagesPerMember = Number(process.env["COLLECTOR_MAX_PAGES"] ?? 10);
const result = await runBatch(batchSource, store, { maxMembers, maxPagesPerMember });
console.log(JSON.stringify({ event: "batch_finished", ...result }));
if (result.errorCount > 0 && process.env["COLLECTOR_FAIL_ON_ERROR"] !== "0") process.exitCode = 1;
