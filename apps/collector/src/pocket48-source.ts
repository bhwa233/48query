import type { CollectorMember, CollectorMessage, CollectorPage, CollectorRecording, CollectorSource } from "./types";

type PocketResponse = { status?: number; success?: boolean; message?: string; content?: unknown };
type Pocket48Options = {
  token: string;
  deviceId?: string;
  pa?: string;
  paFactory?: () => Promise<string> | string;
  apiBaseUrl?: string;
  directoryUrl?: string;
  minIntervalMs?: number;
  memberScope?: "followed" | "all";
  fetchImpl?: typeof fetch;
};

const DIRECTORY_URL = "https://fastly.jsdelivr.net/gh/duan602728596/qqtools@main/packages/NIMTest/node/roomId.json";
const asObject = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const asString = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : null;
function parseJson(value: unknown): unknown { if (typeof value !== "string") return value; try { return JSON.parse(value) as unknown; } catch { return value; } }
const compactJson = (value: unknown) => { try { const result = JSON.stringify(value); return result && result.length <= 2000 ? result : null; } catch { return null; } };
const nextCursor = (value: unknown, previous: string | null) => { const cursor = asString(value); return cursor && cursor !== "0" && cursor !== previous ? cursor : null; };

function normalizeDirectory(payload: unknown): CollectorMember[] {
  const root = asObject(payload);
  const list = Array.isArray(root.roomId) ? root.roomId : Array.isArray(root.members) ? root.members : [];
  return list.flatMap((entry): CollectorMember[] => {
    const item = asObject(entry);
    const id = asString(item.id);
    const name = asString(item.ownerName ?? item.name ?? item.nickname);
    const channelId = asString(item.channelId ?? item.roomId);
    const serverId = asString(item.serverId);
    if (!id || !name) return [];
    return [{ id, name, pinyin: asString(item.pinyin), groupName: asString(item.groupName) ?? "未知", team: asString(item.team ?? item.periodName), roomId: asString(item.roomId ?? item.channelId), channelId, serverId, liveRoomId: asString(item.liveRoomId), status: channelId && serverId ? "active" : "gone" }];
  });
}

function dateValue(value: string): string | null {
  const numeric = Number(value);
  const date = Number.isFinite(numeric) && numeric > 0 ? new Date(numeric) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export class Pocket48Source implements CollectorSource {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly directoryUrl: string;
  private readonly interval: number;
  private lastRequestAt = 0;
  private requestTurn: Promise<void> = Promise.resolve();
  private readonly rooms = new Map<string, Promise<{ channelId: string; serverId: string }>>();

  constructor(private readonly options: Pocket48Options) {
    if (!options.token.trim() || (!options.pa?.trim() && !options.paFactory)) throw new Error("Pocket48 source requires a token and a dynamic pa signer.");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = (options.apiBaseUrl ?? "https://pocketapi.48.cn").replace(/\/$/, "");
    this.directoryUrl = options.directoryUrl ?? DIRECTORY_URL;
    this.interval = Math.max(0, options.minIntervalMs ?? 5000);
  }

  private async rateLimit() {
    let release!: () => void;
    const previous = this.requestTurn;
    this.requestTurn = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const wait = this.interval - (Date.now() - this.lastRequestAt);
    try {
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastRequestAt = Date.now();
    } finally {
      release();
    }
  }

  private async post(pathname: string, body: Record<string, unknown>) {
    await this.rateLimit();
    const pa = this.options.paFactory ? await this.options.paFactory() : this.options.pa;
    const requestHeaders: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json;charset=utf-8",
      appInfo: JSON.stringify({ vendor: "apple", appVersion: "7.1.35", appBuild: "25101021", osVersion: "16.3.0", osType: "ios", deviceName: "iPhone 14 Pro", os: "ios", ...(this.options.deviceId ? { deviceId: this.options.deviceId } : {}) }),
      "User-Agent": "PocketFans201807/7.1.35 (iPhone; iOS 16.3; Scale/3.00)",
    };
    requestHeaders["token"] = this.options["token"];
    if (pa) requestHeaders["pa"] = pa;
    const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, { method: "POST", headers: requestHeaders, body: JSON.stringify(body) });
    const payload = await response.json() as PocketResponse;
    if (!response.ok || (payload.status !== undefined && payload.status !== 200) || payload.success === false) throw new Error(payload.message || `Pocket48 request failed with HTTP ${response.status}`);
    return asObject(payload.content);
  }

  async listMembers(): Promise<CollectorMember[]> {
    await this.rateLimit();
    const response = await this.fetchImpl(this.directoryUrl, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Pocket48 directory request failed with HTTP ${response.status}`);
    const members = normalizeDirectory(await response.json());
    if (this.options.memberScope === "all") return members;
    const followed = await this.post("/user/api/v1/friendships/friends/id", {});
    if (!Array.isArray(followed.data)) throw new Error("Pocket48 returned no followed-member list.");
    const ids = new Set(followed.data.map(value => asString(value)));
    return members.filter(member => ids.has(member.id));
  }

  async listMessages(member: CollectorMember, cursor: string | null): Promise<CollectorPage<CollectorMessage>> {
    // Like 48tools, resolve by member ID; the public directory's channel/server
    // IDs may be stale or missing. Cache only for this source's current batch.
    let room = this.rooms.get(member.id);
    if (!room) {
      room = this.post("/im/api/v1/im/server/jump", { starId: Number(member.id), targetType: 1, tabId: 0 }).then(content => {
        const channelId = asString(content.channelId);
        const serverId = asString(asObject(content.jumpServerInfo).serverId ?? content.serverId);
        if (!channelId && content.star === true && content.friend === false) throw new Error(`Pocket48 member ${member.id} is not followed by this account; select a followed member or follow them in Pocket48 first.`);
        if (!channelId || !serverId) throw new Error(`Pocket48 returned no current room for member ${member.id}.`);
        return { channelId, serverId };
      });
      this.rooms.set(member.id, room);
    }
    const currentRoom = await room;
    member.channelId = currentRoom.channelId;
    member.serverId = currentRoom.serverId;
    member.status = "active";
    // Each ingest unit accepts at most 25 messages. Preserve the upstream cursor
    // and request that page size rather than dropping half of a larger page.
    const content = await this.post("/im/api/v1/team/message/list/homeowner", { channelId: Number(currentRoom.channelId), serverId: Number(currentRoom.serverId), nextTime: Number(cursor ?? 0), limit: 25 });
    const values = Array.isArray(content.message) ? content.message : [];
    const items = values.flatMap((value): CollectorMessage[] => {
      const item = asObject(value);
      const id = asString(item.msgIdServer);
      const timestamp = asString(item.msgTime);
      const occurredAt = timestamp ? dateValue(timestamp) : null;
      if (!id || !occurredAt) return [];
      const body = asObject(parseJson(item.bodys));
      const ext = asObject(parseJson(item.extInfo));
      const sender = asObject(ext.user ?? ext.sender);
      const text = asString(body.text ?? body.content ?? body.message ?? body.msg ?? body.body) ?? (typeof item.bodys === "string" && !item.bodys.trim().startsWith("{") ? item.bodys : null);
      return [{ id, memberId: member.id, occurredAt, type: asString(item.msgType) ?? "UNKNOWN", text, senderId: asString(sender.userId ?? sender.id), senderName: asString(sender.nickName ?? sender.nickname ?? sender.userName ?? sender.name), senderType: asString(sender.roleName ?? sender.role), sourceJson: compactJson(value) }];
    });
    return { items, nextCursor: nextCursor(content.nextTime, cursor) };
  }

  async listRecordings(member: CollectorMember, cursor: string | null): Promise<CollectorPage<CollectorRecording>> {
    let next = cursor ?? "0";
    let first: Record<string, unknown> | undefined;
    // Pocket48 ignores userId at next=0 (also handled by 48tools). Establish
    // a real liveId boundary first, then request this member's own recordings.
    if (Number(next) === 0) {
      const latest = await this.post("/live/api/v1/live/getLiveList", { debug: true, next: 0, record: true });
      if (!Array.isArray(latest.liveList) || latest.liveList.length === 0) return { items: [], nextCursor: null };
      const head = asObject(latest.liveList[0]);
      const latestId = asString(head.liveId);
      if (!latestId || latestId === "0") throw new Error("Pocket48 returned no recording pagination boundary.");
      next = latestId;
      if (asString(asObject(head.userInfo).userId) === member.id) first = head;
    }
    const content = await this.post("/live/api/v1/live/getLiveList", { debug: true, next, record: true, userId: Number(member.id) });
    const values: unknown[] = Array.isArray(content.liveList) ? content.liveList : [];
    if (first) values.unshift(first);
    const items = values.flatMap((value): CollectorRecording[] => {
      const item = asObject(value);
      if (asString(asObject(item.userInfo).userId) !== member.id) throw new Error("Pocket48 returned recordings for a different member; refusing to ingest them.");
      const id = asString(item.liveId);
      const occurredAt = asString(item.ctime ?? item.stime);
      const iso = occurredAt ? dateValue(occurredAt) : null;
      if (!id || !iso) return [];
      return [{ id, memberId: member.id, title: asString(item.title), occurredAt: iso, danmakuCount: 0, danmakuStatus: "pending", sourceJson: compactJson(value) }];
    });
    return { items, nextCursor: nextCursor(content.next, cursor) };
  }
}
