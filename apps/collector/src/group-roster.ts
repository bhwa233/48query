import { object, string } from "./pocket48-content";

export const OFFICIAL_ROSTER_URL = "https://h5.48.cn/resource/jsonp/allmembers.php?gid=00";
export const COMMUNITY_DIRECTORY_URL = "https://fastly.jsdelivr.net/gh/duan602728596/qqtools@main/packages/NIMTest/node/roomId.json";
const groups: Record<string, string> = { SNH: "SNH48", BEJ: "BEJ48", GNZ: "GNZ48", SHY: "SHY48", CKG: "CKG48", CGT: "CGT48", IDFT: "IDFT" };

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

// No installed collector helper reconciles website IDs with Pocket48 IDs.
// Keep this protocol-specific merge here; names only propose IDs, and the
// official user profile must verify them before collection or ingestion.
export function buildGroupRoster(official: unknown, community: unknown) {
  const rows = object(official).rows;
  const directory = object(community).roomId ?? object(community).members;
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
  const excluded: { id: string; name: string }[] = [];
  for (const value of directory) {
    const row = object(value), id = accountId(row.id), name = string(row.ownerName ?? row.name);
    if (!id || !name) continue;
    const canonical = rosterName(name);
    if (id === "63" || string(row.groupName) === "燃烧吧团魂") { excluded.push({ id, name }); continue; }
    // Former members can also be absent from today's website. Their directory
    // entries are candidates only, and still need an explicit official isStar.
    const matches = [...candidates.values()].filter(entry => entry.name === canonical);
    const direct = matches.filter(entry => entry.officialPocketIds.includes(id));
    const selected = direct.length ? direct : matches.length === 1 ? matches : [];
    if (matches.length && !selected.length) continue;
    const entry = selected[0] ?? { name: canonical, officialIds: [], officialPocketIds: [], candidateIds: [], groups: [], teams: [], officialStatuses: [] };
    entry.candidateIds.push(id);
    if (!matches.length) candidates.set(`supplemental:${canonical}`, entry);
  }
  for (const entry of candidates.values()) {
    entry.officialIds = [...new Set(entry.officialIds)].sort((a, b) => Number(a) - Number(b));
    entry.officialPocketIds = [...new Set(entry.officialPocketIds)];
    entry.candidateIds = [...new Set([...entry.officialPocketIds, ...entry.candidateIds])];
    entry.groups = [...new Set(entry.groups)]; entry.teams = [...new Set(entry.teams)]; entry.officialStatuses = [...new Set(entry.officialStatuses)];
    if (!entry.officialPocketIds.length && [...candidates.values()].filter(other => other.name === entry.name).length > 1) entry.ambiguousName = true;
  }
  return { candidates: [...candidates.values()].sort((a, b) => Number(a.officialIds[0] ?? Infinity) - Number(b.officialIds[0] ?? Infinity) || a.name.localeCompare(b.name, "zh-CN")), excluded, officialRows: rows.length };
}
