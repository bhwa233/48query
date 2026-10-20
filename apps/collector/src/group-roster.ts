import { object, string } from "./pocket48-content";
import { readFile } from "node:fs/promises";

export const OFFICIAL_ROSTER_URL = "https://h5.48.cn/resource/jsonp/allmembers.php?gid=00";
export const COMMUNITY_DIRECTORY_URL = "https://fastly.jsdelivr.net/gh/duan602728596/qqtools@main/packages/NIMTest/node/roomId.json";
export const HISTORICAL_DIRECTORY_URL = "https://data.gnz.hk/members.json";
const groups: Record<string, string> = { SNH: "SNH48", BEJ: "BEJ48", GNZ: "GNZ48", SHY: "SHY48", CKG: "CKG48", CGT: "CGT48", IDFT: "IDFT" };

export async function readHistoricalDirectory(options: { url?: string; fetchImpl?: typeof fetch } = {}): Promise<unknown> {
  const url = options.url ?? HISTORICAL_DIRECTORY_URL;
  let response: Response | null = null;
  try {
    response = await (options.fetchImpl ?? fetch)(url, { signal: AbortSignal.timeout(30_000) });
  } catch (error) { if (url !== HISTORICAL_DIRECTORY_URL) throw error; }
  if (response?.ok) {
    const payload: unknown = await response.json();
    directoryEntries(payload);
    return payload;
  }
  if (response && (url !== HISTORICAL_DIRECTORY_URL || ![403, 429].includes(response.status) && response.status < 500)) throw new Error(`Historical directory request failed (HTTP ${response.status}).`);
  // Reuse the same public directory parser and identity checks. The source
  // blocks GitHub runner IPs with 403; a small dated snapshot keeps graduate
  // candidates available without copying birthdays, media, or credentials.
  // An explicitly configured directory must never silently use a different one.
  const snapshot: unknown = JSON.parse(await readFile(new URL("../data/historical-directory.json", import.meta.url), "utf8"));
  const metadata = object(snapshot);
  if (metadata.source !== HISTORICAL_DIRECTORY_URL || !directoryEntries(snapshot).length) throw new Error("Historical directory snapshot is invalid.");
  console.log(JSON.stringify({ event: "historical_directory_snapshot", source: HISTORICAL_DIRECTORY_URL, fetchedAt: metadata.fetchedAt }));
  return snapshot;
}

export async function readGroupRoster(options: { directoryUrl?: string; historicalUrl?: string } = {}) {
  const read = async (url: string): Promise<unknown> => {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Roster request failed (HTTP ${response.status}).`);
    return response.json() as Promise<unknown>;
  };
  const [official, community, historical] = await Promise.all([read(OFFICIAL_ROSTER_URL), read(options.directoryUrl ?? COMMUNITY_DIRECTORY_URL), readHistoricalDirectory({ url: options.historicalUrl })]);
  return buildGroupRoster(official, community, historical);
}

export type RosterCandidate = {
  name: string;
  officialIds: string[];
  officialPocketIds: string[];
  candidateIds: string[];
  groups: string[];
  teams: string[];
  officialStatuses: string[];
  ambiguousName?: boolean;
};

export const rosterName = (name: string) => name.replace(/^(?:(?:SNH48|BEJ48|GNZ48|SHY48|CKG48|CGT48|IDFT|THE9|海外练习生)\s*[-－·]\s*)+/i, "").trim();
const accountId = (value: unknown) => { const id = string(value); return id && /^[1-9]\d*$/.test(id) ? id : null; };
export function directoryEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const root = object(value);
  const lists = [root.roomId, root.members, root.retired].filter(Array.isArray);
  if (!lists.length) throw new Error("Member directory has no supported member list.");
  return lists.flat();
}

// No installed collector helper reconciles website IDs with Pocket48 IDs.
// Keep this protocol-specific merge here; names only propose IDs, and the
// official user profile must verify them before collection or ingestion.
export function buildGroupRoster(official: unknown, community: unknown, historical?: unknown) {
  const rows = object(official).rows;
  const directory = [...directoryEntries(community), ...(historical === undefined ? [] : directoryEntries(historical))];
  if (!Array.isArray(rows) || !rows.length || !Array.isArray(directory)) throw new Error("Invalid official roster or community directory; group coverage remains unverified.");
  const advertised = object(official).total;
  if (advertised !== undefined && Number(advertised) !== rows.length) throw new Error("Official roster is truncated; group coverage remains unverified.");
  const candidates = new Map<string, RosterCandidate>();
  for (const value of rows) {
    const row = object(value), name = string(row.sname), sid = accountId(row.sid), group = groups[string(row.gname) ?? ""];
    if (!name || !sid || !group) throw new Error("Official roster has an unsupported member identity or group.");
    const pocketId = accountId(row.pocket_id);
    const key = pocketId ? `pocket:${pocketId}` : `official:${sid}`;
    const entry = candidates.get(key) ?? { name, officialIds: [], officialPocketIds: [], candidateIds: [], groups: [], teams: [], officialStatuses: [] };
    if (entry.name !== name) throw new Error("Official Pocket48 ID is assigned to conflicting names.");
    entry.officialIds.push(sid);
    if (pocketId) entry.officialPocketIds.push(pocketId);
    entry.groups.push(group);
    const team = string(row.tname), status = string(row.status);
    if (team) entry.teams.push(team);
    if (status) entry.officialStatuses.push(status);
    candidates.set(key, entry);
  }
  const excluded = new Map<string, { id: string; name: string }>();
  for (const value of directory) {
    const row = object(value), id = accountId(row.id), name = string(row.ownerName ?? row.name);
    if (!name) continue;
    const canonical = rosterName(name);
    if (id === "63" || ["燃烧吧团魂", "队伍", "官方", "作者"].includes(string(row.groupName) ?? "")) { if (id) excluded.set(id, { id, name }); continue; }
    // Former members can also be absent from today's website. Their directory
    // entries are candidates only, and still need an explicit official isStar.
    const matches = [...candidates.values()].filter(entry => entry.name === canonical);
    const direct = matches.filter(entry => id && (entry.officialPocketIds.includes(id) || (!entry.officialIds.length && entry.candidateIds.includes(id))));
    const officialMatches = matches.filter(entry => entry.officialIds.length);
    if (!id && matches.length) continue;
    const selected = direct.length ? direct : officialMatches.length === 1 ? officialMatches : [];
    const entry = selected[0] ?? { name: canonical, officialIds: [], officialPocketIds: [], candidateIds: [], groups: [], teams: [], officialStatuses: [] };
    if (id) entry.candidateIds.push(id);
    // Same-name website records remain unresolved. A specific native account
    // can still be verified independently without claiming either website ID.
    if (!selected.length) candidates.set(`supplemental:${canonical}:${id ?? "unmapped"}`, entry);
  }
  for (const entry of candidates.values()) {
    entry.officialIds = [...new Set(entry.officialIds)].sort((a, b) => Number(a) - Number(b));
    entry.officialPocketIds = [...new Set(entry.officialPocketIds)];
    entry.candidateIds = [...new Set([...entry.officialPocketIds, ...entry.candidateIds])];
    entry.groups = [...new Set(entry.groups)]; entry.teams = [...new Set(entry.teams)]; entry.officialStatuses = [...new Set(entry.officialStatuses)];
    if (entry.officialIds.length && !entry.officialPocketIds.length && [...candidates.values()].filter(other => other.name === entry.name && other.officialIds.length).length > 1) entry.ambiguousName = true;
  }
  return { candidates: [...candidates.values()].sort((a, b) => Number(a.officialIds[0] ?? Infinity) - Number(b.officialIds[0] ?? Infinity) || a.name.localeCompare(b.name, "zh-CN")), excluded: [...excluded.values()], officialRows: rows.length };
}
