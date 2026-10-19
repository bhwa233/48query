import type { CollectionSource, CollectorMember, CollectorMessage, CollectorPage, CollectorSource } from "./types";
import { contentList, normalizeMessage, object, parsePocketJson, string, timestamp } from "./pocket48-content";

type Pocket48Options = {
  token: string; deviceId?: string; pa?: string; paFactory?: () => Promise<string> | string;
  apiBaseUrl?: string; directoryUrl?: string; minIntervalMs?: number; memberScope?: "followed" | "all";
  sources?: CollectionSource[]; fetchImpl?: typeof fetch;
};
const DIRECTORY_URL = "https://fastly.jsdelivr.net/gh/duan602728596/qqtools@main/packages/NIMTest/node/roomId.json";
export const COLLECTION_SOURCES: CollectionSource[] = ["room", "album", "essence", "posts", "post_images", "weibo", "room_posts"];

export class Pocket48Source implements CollectorSource {
  readonly sources: CollectionSource[];
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private lastRequestAt = 0;
  private requestTurn: Promise<void> = Promise.resolve();
  private readonly rooms = new Map<string, Promise<{ channelId: string; serverId: string; roomId: string | null }>>();
  private readonly directory = new Map<string, CollectorMember>();

  constructor(private readonly options: Pocket48Options) {
    if (!options.token.trim() || (!options.pa?.trim() && !options.paFactory)) throw new Error("Pocket48 source requires a token and a dynamic pa signer.");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = (options.apiBaseUrl ?? "https://pocketapi.48.cn").replace(/\/$/, "");
    this.sources = options.sources ?? COLLECTION_SOURCES;
  }

  private async rateLimit() {
    let release!: () => void;
    const previous = this.requestTurn;
    this.requestTurn = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const wait = Math.max(0, this.options.minIntervalMs ?? 5000) - (Date.now() - this.lastRequestAt);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastRequestAt = Date.now();
    } finally { release(); }
  }

  private async post(pathname: string, body: Record<string, unknown>) {
    await this.rateLimit();
    const pa = this.options.paFactory ? await this.options.paFactory() : this.options.pa;
    const headers: Record<string, string> = {
      Accept: "application/json", "Content-Type": "application/json;charset=utf-8", "Accept-Language": "zh-Hans-CN;q=1",
      appInfo: JSON.stringify({ vendor: "apple", appVersion: "7.1.35", appBuild: "25101021", osVersion: "16.3.0", osType: "ios", deviceName: "iPhone 14 Pro", os: "ios", ...(this.options.deviceId ? { deviceId: this.options.deviceId } : {}) }),
      "User-Agent": "PocketFans201807/7.1.35 (iPhone; iOS 16.3; Scale/3.00)", token: this.options.token,
    };
    if (pathname.endsWith("/aim/type")) {
      headers.appInfo = JSON.stringify({ vendor: "apple", deviceId: this.options.deviceId, appVersion: "7.1.38", appBuild: "26042402", osVersion: "26.5.0", osType: "ios", deviceName: "iPhone17,1", os: "ios" });
      headers["User-Agent"] = "PocketFans201807/7.1.38 (iPhone; iOS 26.5; Scale/3.00)";
      headers["P-Sign-Type"] = "V0";
    } else if (pathname.endsWith("/posts/img/list")) {
      const deviceId = this.options.deviceId?.replace(/[^a-f0-9]/gi, "").slice(0, 16).toLowerCase();
      headers.appInfo = JSON.stringify({ IMEI: deviceId, deviceId, appName: "pocket48", appVersion: "7.1.43", appBuild: "26082801", osType: "android", osVersion: "12", deviceName: "SM-G9730", phoneName: "SM-G9730", phoneSystemVersion: "12", vendor: "Samsung" });
      headers["User-Agent"] = "PocketFans201807/7.1.43_26082801 (SM-G9730:Android 12;Samsung V417IR release-keys)";
    }
    if (pa) headers.pa = pa;
    const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    const payload = object(parsePocketJson(await response.text()));
    if (!response.ok || (payload.status !== undefined && payload.status !== 200) || payload.success === false) {
      // Do not include upstream free-form error text, which can contain user data.
      throw new Error(`Pocket48 ${pathname} failed (HTTP ${response.status}, business ${string(payload.status) ?? "unknown"}).`);
    }
    if (!("content" in payload)) throw new Error(`Pocket48 ${pathname} returned no content.`);
    return payload.content;
  }

  async listMembers(): Promise<CollectorMember[]> {
    await this.rateLimit();
    const response = await this.fetchImpl(this.options.directoryUrl ?? DIRECTORY_URL, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Pocket48 directory request failed with HTTP ${response.status}`);
    const root = object(parsePocketJson(await response.text()));
    const entries = Array.isArray(root.roomId) ? root.roomId : Array.isArray(root.members) ? root.members : [];
    for (const entry of entries) {
      const item = object(entry);
      const id = string(item.id);
      const name = string(item.ownerName ?? item.name ?? item.nickname);
      if (!id || !name) continue;
      this.directory.set(id, { id, name, pinyin: string(item.pinyin), groupName: string(item.groupName) ?? "未知", team: string(item.team ?? item.periodName),
        roomId: string(item.roomId), channelId: string(item.channelId), serverId: string(item.serverId), status: "active" });
    }
    const members = [...this.directory.values()];
    if (this.options.memberScope === "all") return members;
    const followed = object(await this.post("/user/api/v1/friendships/friends/id", {}));
    if (!Array.isArray(followed.data)) throw new Error("Pocket48 returned no followed-member list.");
    const ids = new Set(followed.data.map(value => string(value)));
    return members.filter(member => ids.has(member.id));
  }

  private async resolveRoom(member: CollectorMember) {
    let room = this.rooms.get(member.id);
    if (!room) {
      room = this.post("/im/api/v1/im/server/jump", { starId: Number(member.id), targetType: 1, tabId: 0 }).then(value => {
        const content = object(value);
        const channelId = string(content.channelId);
        const serverId = string(object(content.jumpServerInfo).serverId ?? content.serverId);
        if (!channelId || !serverId) throw new Error(`Pocket48 returned no readable room for member ${member.id}; account access or room mapping requires verification.`);
        const roomId = string(content.imRoomId ?? content.roomId);
        return { channelId, serverId, roomId };
      });
      this.rooms.set(member.id, room);
    }
    const current = await room;
    member.channelId = current.channelId; member.serverId = current.serverId; member.roomId = current.roomId; member.status = "active";
    return current;
  }

  async listMessages(member: CollectorMember, cursor: string | null) { return this.listContent(member, "room", cursor); }

  async listContent(member: CollectorMember, source: CollectionSource, cursor: string | null): Promise<CollectorPage<CollectorMessage>> {
    let content: unknown;
    if (source === "posts" || source === "post_images") {
      content = await this.post(source === "posts" ? "/posts/api/v1/posts/timeline/home/new" : "/posts/api/v1/posts/img/list", { userId: Number(member.id), nextId: cursor ?? "0", limit: 25 });
    } else {
      const room = await this.resolveRoom(member);
      const body = { channelId: Number(room.channelId), serverId: Number(room.serverId), nextTime: Number(cursor ?? 0), limit: 25 };
      if (source === "room") {
        // all includes verified members visiting other rooms. Never infer authorship
        // from the selected room, role labels, or a non-empty response alone.
        content = await this.post("/im/api/v1/team/message/list/all", body);
      } else if (source === "album") {
        content = await this.post("/im/api/v1/team/msg/list/img", { channelId: room.channelId, nextTime: Number(cursor ?? 0) });
      } else if (source === "essence") {
        content = await this.post("/im/api/v1/team/essence/message/list", body);
      } else {
        if (!room.roomId) {
          const info = object(await this.post("/im/api/v1/im/team/room/info", { channelId: room.channelId }));
          const roomInfo = object(info.roomInfo ?? info);
          const ownerId = string(roomInfo.ownerId ?? roomInfo.starId);
          if (ownerId && ownerId !== member.id) throw new Error("Pocket48 room owner does not match the selected member.");
          room.roomId = string(roomInfo.imRoomId ?? roomInfo.roomId);
          member.roomId = room.roomId;
        }
        if (!room.roomId) throw new Error("Pocket48 returned no verified legacy room ID for this source.");
        content = await this.post("/im/api/v1/chatroom/msg/list/aim/type", { extMsgType: source === "weibo" ? "WEI_BO" : "POST_INFO", ownerId: member.id, roomId: room.roomId, nextTime: Number(cursor ?? 0) });
      }
    }
    const values = contentList(content);
    const items = values.flatMap(value => { const message = normalizeMessage(value, member, source, this.directory); return message ? [message] : []; });
    console.log(JSON.stringify({ event: "source_page", memberId: member.id, source, observed: values.length, accepted: items.length, images: items.reduce((count, item) => count + (item.images?.length ?? 0), 0), ownerMessages: items.filter(item => item.memberId === member.id).length }));
    const root = object(content);
    const rawCursor = string(root.nextTime ?? root.nextId ?? root.next);
    if (values.length > 0 && rawCursor === cursor) throw new Error("Pocket48 repeated a non-empty page cursor; refusing to mark history complete.");
    const boundary = values.flatMap(value => {
      const item = object(value);
      const id = string(item.msgIdServer ?? item.msgIdClient ?? item.msgidClient ?? item.postId ?? item.id);
      const occurredAt = timestamp(item.msgTime ?? item.createTime ?? item.ctime);
      return id && occurredAt ? [{ id, occurredAt }] : [];
    });
    if (values.length > 0 && boundary.length !== values.length) throw new Error("Pocket48 returned items without a pagination boundary; refusing to advance.");
    return { items, observed: values.length, boundary, nextCursor: rawCursor && rawCursor !== "0" && rawCursor !== "-1" ? rawCursor : null };
  }
}
