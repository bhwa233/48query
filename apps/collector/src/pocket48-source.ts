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
      appInfo: JSON.stringify({ vendor: "apple", appVersion: "7.0.4", appBuild: "23011601", osVersion: "16.3.1", osType: "ios", deviceName: "iPhone XR", os: "ios", ...(this.options.deviceId ? { deviceId: this.options.deviceId } : {}) }),
      "User-Agent": "PocketFans201807/6.0.16 (iPhone; iOS 13.5.1; Scale/2.00)",
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
    return normalizeDirectory(await response.json());
  }

  async listMessages(member: CollectorMember, cursor: string | null): Promise<CollectorPage<CollectorMessage>> {
    if (!member.channelId || !member.serverId) return { items: [], nextCursor: null };
    const content = await this.post("/im/api/v1/team/message/list/homeowner", { channelId: Number(member.channelId), serverId: Number(member.serverId), nextTime: Number(cursor ?? 0), limit: 50 });
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
    const content = await this.post("/live/api/v1/live/getLiveList", { debug: true, next: Number(cursor ?? 0), record: true, userId: Number(member.id) });
    const values = Array.isArray(content.liveList) ? content.liveList : [];
    const items = values.flatMap((value): CollectorRecording[] => {
      const item = asObject(value);
      const id = asString(item.liveId);
      const occurredAt = asString(item.ctime ?? item.stime);
      const iso = occurredAt ? dateValue(occurredAt) : null;
      if (!id || !iso) return [];
      return [{ id, memberId: member.id, title: asString(item.title), occurredAt: iso, danmakuCount: 0, danmakuStatus: "pending", sourceJson: compactJson(value) }];
    });
    return { items, nextCursor: nextCursor(content.next, cursor) };
  }
}
