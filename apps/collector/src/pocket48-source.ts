import type { CatalogEntry } from "@starter/shared";
import { createHash } from "node:crypto";
import type { CollectionSource, CollectorMember, CollectorMessage, CollectorPage, CollectorSource } from "./types";
import { contentList, normalizeMessage, imageUrl, object, parsePocketJson, postObject, sourceFlags, string, timestamp } from "./pocket48-content";
import { directoryEntries, readHistoricalDirectory, rosterName, type RosterCandidate } from "./group-roster";
import { collectionSince } from "./collection-scope";
import type { CollectionBudget } from "./budget";

type Pocket48Options = {
  token: string; deviceId?: string; pa?: string; paFactory?: () => Promise<string> | string;
  apiBaseUrl?: string; directoryUrl?: string; historyDirectoryUrl?: string; minIntervalMs?: number; memberScope?: "followed" | "all";
  requestedMemberId?: string;
  since?: string | null;
  budget?: () => CollectionBudget;
  readVerifiedPostImages?: (memberId: string, imageIds: string[]) => Promise<CollectorMessage[]>;
  readVerifiedMedia?: (roomId: string, assets: { id: string; occurredAt: string }[]) => Promise<CollectorMessage[]>;
  albumOriginalPages?: number;
  maxOriginalLookups?: number;
  sources?: CollectionSource[]; fetchImpl?: typeof fetch;
};
const DIRECTORY_URL = "https://fastly.jsdelivr.net/gh/duan602728596/qqtools@main/packages/NIMTest/node/roomId.json";
export const COLLECTION_SOURCES: CollectionSource[] = ["room", "album", "essence", "posts", "post_images", "weibo", "room_posts"];
export type RoomVideo = {
  id: string; messageId: string; sourceUrl: string; memberId: string; roomOwnerId: string; occurredAt: string;
  declaredBytes: number | null; galleryUrl: string | null; thumbnailUrl: string | null; status: "pending" | "uploaded" | "failed";
};

export class Pocket48Source implements CollectorSource {
  readonly sources: CollectionSource[];
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly since: string | null;
  private lastRequestAt = 0;
  private requestTurn: Promise<void> = Promise.resolve();
  private readonly rooms = new Map<string, Promise<{ channelId: string; serverId: string; roomId: string | null }>>();
  private readonly legacyRooms = new Map<string, Promise<string>>();
  private readonly verifiedMedia = new Map<string, CollectorMessage>();
  private readonly directory = new Map<string, CollectorMember>();
  private readonly groupDirectory = new Map<string, CollectorMember>();
  private readonly archiveAnchors = new Map<string, Promise<{ times: number[]; next: string | null }>>();

  constructor(private readonly options: Pocket48Options) {
    if (!options.token.trim() || (!options.pa?.trim() && !options.paFactory)) throw new Error("Pocket48 source requires a token and a dynamic pa signer.");
    if (options.minIntervalMs !== undefined && (!Number.isFinite(options.minIntervalMs) || options.minIntervalMs < 0)) throw new Error("POCKET48_MIN_INTERVAL_MS must be a finite non-negative number.");
    if (options.albumOriginalPages !== undefined && (!Number.isInteger(options.albumOriginalPages) || options.albumOriginalPages < 1 || options.albumOriginalPages > 20)) throw new Error("Album original page budget must be between 1 and 20.");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.since = options.since === null ? null : collectionSince(options.since);
    this.baseUrl = (options.apiBaseUrl ?? "https://pocketapi.48.cn").replace(/\/$/, "");
    const order: CollectionSource[] = ["room", "essence", "posts", "weibo", "room_posts", "album", "post_images"];
    this.sources = [...(options.sources ?? COLLECTION_SOURCES)].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }

  private inRange(at: string | null) { return !this.since || at !== null && Date.parse(at) >= Date.parse(this.since); }
  private scopedPage(page: CollectorPage<CollectorMessage>): CollectorPage<CollectorMessage> {
    if (!this.since) return page;
    const times = (page.boundary ?? []).map(item => Date.parse(item.occurredAt));
    const reachedSince = times.length > 0 && times.every((at, index) => Number.isFinite(at) && (index === 0 || at <= times[index - 1]!)) && times.some(at => at < Date.parse(this.since!));
    return { ...page, items: page.items.filter(item => this.inRange(item.occurredAt)), reachedSince,
      nextCursor: reachedSince ? null : page.nextCursor };
  }

  private async rateLimit() {
    let release!: () => void;
    const previous = this.requestTurn;
    this.requestTurn = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const wait = Math.max(0, this.options.minIntervalMs ?? 5000) - (Date.now() - this.lastRequestAt);
      this.options.budget?.().check();
      if (wait > 0) {
        if (this.options.budget) await this.options.budget().wait(wait);
        else await new Promise((resolve) => setTimeout(resolve, wait));
      }
      this.lastRequestAt = Date.now();
    } finally { release(); }
  }

  private async post(pathname: string, body: Record<string, unknown>) {
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
    // Signer latency must not consume the delay and bunch actual requests.
    await this.rateLimit();
    let response: Response;
    try { response = await this.fetchImpl(`${this.baseUrl}${pathname}`, { method: "POST", headers, body: JSON.stringify(body), signal: this.options.budget?.().signal(30_000) ?? AbortSignal.timeout(30_000) }); }
    catch (error) { this.options.budget?.().check(); throw error; }
    const payload = object(parsePocketJson(await response.text()));
    if (!response.ok || (payload.status !== undefined && payload.status !== 200) || payload.success === false) {
      // Do not include upstream free-form error text, which can contain user data.
      throw new Error(`Pocket48 ${pathname} failed (HTTP ${response.status}, business ${string(payload.status) ?? "unknown"}).`, { cause: { business: string(payload.status), http: response.status } });
    }
    if (!("content" in payload)) throw new Error(`Pocket48 ${pathname} returned no content.`);
    if (process.env.POCKET48_LOG_SCHEMA === "1") {
      // Schema diagnostics contain field names/types only, never body values,
      // account tokens, image URLs or message text.
      const shape = (value: unknown, depth = 0): unknown => {
        if (depth > 6) return typeof value;
        if (Array.isArray(value)) return { count: value.length, item: value.length ? shape(value[0], depth + 1) : null };
        if (value && typeof value === "object") return Object.fromEntries(Object.entries(object(value)).filter(([key]) => /^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(key)).slice(0, 40).map(([key, entry]) => [key, shape(key === "bodys" || key === "extInfo" ? parsePocketJson(entry) : entry, depth + 1)]));
        return value === null ? "null" : typeof value;
      };
      console.log(JSON.stringify({ event: "source_schema", path: pathname, shape: shape(payload.content) }));
    }
    return payload.content;
  }

  async listMembers(): Promise<CollectorMember[]> {
    await this.rateLimit();
    const response = await this.fetchImpl(this.options.directoryUrl ?? DIRECTORY_URL, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Pocket48 directory request failed with HTTP ${response.status}`);
    this.addDirectory(parsePocketJson(await response.text()));
    if (this.options.requestedMemberId && !this.directory.has(this.options.requestedMemberId)) await this.resolveDirectoryMember(this.options.requestedMemberId);
    if (this.options.memberScope === "all") return [...this.directory.values()];
    const followed = object(await this.post("/user/api/v1/friendships/friends/id", {}));
    if (!Array.isArray(followed.data)) throw new Error("Pocket48 returned no followed-member list.");
    const ids = new Set(followed.data.map(value => string(value)).filter((id): id is string => Boolean(id)));
    for (const id of ids) if (id !== "63" && !this.directory.has(id)) await this.resolveDirectoryMember(id);
    const members = [...this.directory.values()].filter(member => ids.has(member.id));
    console.log(JSON.stringify({ event: "member_scope", followed: ids.size, selected: members.length, nonmemberOrUnknown: ids.size - members.length }));
    return members;
  }

  private addDirectory(payload: unknown) {
    const entries = directoryEntries(payload);
    for (const entry of entries) {
      const item = object(entry);
      const id = string(item.id);
      const name = string(item.ownerName ?? item.name ?? item.nickname);
      // The community room directory also lists Pocket48's system account.
      // Its official user profile reports isStar=false, userRole=999.
      if (!id || !name || id === "63") continue;
      this.directory.set(id, { id, name, pinyin: string(item.pinyin), groupName: string(item.groupName) ?? "未知", team: string(item.team ?? item.periodName),
        roomId: string(item.roomId), channelId: string(item.channelId), serverId: string(item.serverId), status: "active" });
    }
  }

  async prepareGroupDirectory(verifiedMembers: CollectorMember[] = []) {
    await this.listMembers();
    if (this.options.historyDirectoryUrl) {
      this.addDirectory(await readHistoricalDirectory({ url: this.options.historyDirectoryUrl, fetchImpl: this.fetchImpl }));
    }
    for (const member of this.directory.values()) this.groupDirectory.set(member.id, member);
    this.directory.clear();
    for (const member of verifiedMembers) this.directory.set(member.id, member);
  }

  async resolveGroupCandidate(candidate: RosterCandidate): Promise<CollectorMember | null> {
    if (candidate.ambiguousName) return null;
    const ids = new Set(candidate.candidateIds);
    // Missing/stale Pocket48 IDs need official search results, never a website
    // sid used as a userId. Every proposed identity is checked again below.
    const search = async () => {
      const results = contentList(await this.post("/im/api/v1/im/search", { name: candidate.name }));
      for (const value of results) {
        const row = object(value), id = string(row.ownerId);
        if (id && /^\d+$/.test(id) && string(row.targetType) === "0") ids.add(id);
      }
    };
    const verified: CollectorMember[] = [];
    const checked = new Set<string>();
    let failure: unknown;
    for (let pass = 0; pass < 2; pass++) {
      if (pass === 1) { if (verified.length) break; await search(); }
      for (const id of ids) {
        if (id === "63") continue;
        if (checked.has(id)) continue;
        checked.add(id);
        try {
          const home = object(await this.post("/user/api/v1/user/info/home", { userId: id }));
          const user = object(home.baseUserInfo);
          const names = [user.starName, user.realNickName, user.nickname].map(string).filter((name): name is string => Boolean(name));
          if (string(user.userId) !== id || !names.some(name => rosterName(name) === candidate.name)
            || !(user.isStar === true || candidate.officialPocketIds.includes(id))) continue;
          let info: Record<string, unknown> = {};
          try { info = object(object(await this.post("/user/api/v1/user/star/archives", { memberId: id })).starInfo); }
          catch (error) {
            if ([401, 403].includes(Number(object(error instanceof Error ? error.cause : null).http)) || [401, 403, 1001, 2001].includes(Number(object(error instanceof Error ? error.cause : null).business))) throw error;
          }
          if (info.userId !== undefined && string(info.userId) !== id) throw new Error("Official member archives returned a different user ID.");
          const previous = this.groupDirectory.get(id) ?? this.directory.get(id);
          if (!candidate.officialIds.length && ![info.starGroupName, info.periodName].some(value => /^(?:SNH48|BEJ48|GNZ48|SHY48|CKG48|CGT48|IDFT|IDOLS\s*FT)(?:\b|\s)/i.test(string(value) ?? ""))) continue;
          verified.push({ ...previous, id, name: rosterName(string(user.starName) ?? candidate.name),
            groupName: string(info.starGroupName) ?? (candidate.groups.length === 1 ? candidate.groups[0]! : previous?.groupName ?? "未知"),
            team: string(info.starTeamName) ?? (candidate.teams.length === 1 ? candidate.teams[0] : previous?.team),
            pinyin: string(info.pinyin) ?? previous?.pinyin, status: previous?.status ?? "active" });
        } catch (error) {
          const cause = object(error instanceof Error ? error.cause : null);
          if ([401, 403].includes(Number(cause.http)) || [401, 403, 1001, 2001].includes(Number(cause.business))) throw error;
          failure = error;
        }
      }
    }
    if (verified.length > 1) throw new Error("Multiple official Pocket48 identities match this name; manual reconciliation required.");
    const member = verified[0] ?? null;
    if (!member && failure) throw failure instanceof Error ? failure : new Error("Pocket48 member verification failed.");
    if (member) this.directory.set(member.id, member);
    return member;
  }

  private async resolveDirectoryMember(id: string) {
    const home = object(await this.post("/user/api/v1/user/info/home", { userId: id }));
    const user = object(home.baseUserInfo);
    // Missing community-directory entries are not necessarily nonmembers.
    // Require the official account's ID and explicit member flag to add one.
    if (string(user.userId) !== id || user.isStar !== true) return;
    const name = string(user.starName) ?? string(user.realNickName) ?? string(user.nickname);
    if (!name) throw new Error("A verified member profile has no display name.");
    this.directory.set(id, { id, name, groupName: string(user.groupName) ?? "未知", team: string(user.teamName), status: "active" });
  }

  private async resolveRoom(member: CollectorMember) {
    let room = this.rooms.get(member.id);
    if (!room) {
      room = this.post("/im/api/v1/im/server/jump", { starId: Number(member.id), targetType: 1, tabId: 0 }).then(value => {
        const content = object(value);
        const channelId = string(content.channelId);
        const serverId = string(object(content.jumpServerInfo).serverId ?? content.serverId);
        if (!channelId || !serverId) throw new Error(`Pocket48 returned no readable room for member ${member.id}; account access or room mapping requires verification.`, { cause: "missing_room_mapping" });
        const roomId = string(content.imRoomId ?? content.roomId);
        return { channelId, serverId, roomId };
      });
      this.rooms.set(member.id, room);
    }
    const current = await room;
    member.channelId = current.channelId; member.serverId = current.serverId; member.roomId = current.roomId; member.status = "active";
    return current;
  }

  // Reuse Pocket48's official search (also used by DipperStar), rather than
  // trusting directory IDs or coupling legacy feeds to the modern jump API.
  private async resolveLegacyRoom(member: CollectorMember) {
    let room = this.legacyRooms.get(member.id);
    if (!room) {
      room = this.post("/im/api/v1/im/search", { name: member.name }).then(value => {
        const ids = new Set(contentList(value).flatMap(entry => {
          const item = object(entry);
          const id = string(item.targetId);
          return string(item.ownerId) === member.id && string(item.targetType) === "0" && id ? [id] : [];
        }));
        if (ids.size > 1) throw new Error("Pocket48 returned multiple verified legacy rooms for this member.");
        // Historical members can disappear from search. This legacy endpoint
        // supports an empty roomId with ownerId; returned senders still require
        // normal verification, and an unrelated search result is never used.
        return [...ids][0] ?? "";
      });
      this.legacyRooms.set(member.id, room);
    }
    const roomId = await room;
    if (roomId) member.roomId = roomId;
    return roomId;
  }

  async listMessages(member: CollectorMember, cursor: string | null) { return this.listContent(member, "room", cursor); }

  private async legacyMediaPage(member: CollectorMember, kind: "IMAGE" | "VIDEO", cursor: string | null): Promise<CollectorPage<CollectorMessage>> {
    if (cursor !== null && (!/^\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor)))) throw new Error("Legacy media history completeness remains unverified.");
    if (this.since && Number(cursor) > 0 && Number(cursor) < Date.parse(this.since)) return { items: [], boundary: [], observed: 0, reachedSince: true, nextCursor: null };
    const roomId = await this.resolveLegacyRoom(member);
    const content = await this.post("/im/api/v1/chatroom/msg/list/aim/type", { extMsgType: kind, ownerId: member.id, roomId, nextTime: Number(cursor ?? 0) });
    const rows = contentList(content);
    const owner = { ...member, channelId: roomId || null, roomId: roomId || null };
    const items = rows.flatMap(row => {
      const raw = object(row);
      // Legacy serverId is NIM's message server ID, not its room server ID.
      // Keep the existing message namespace across API versions; roomId below
      // still records the independently verified legacy room, or remains null.
      const serverMessageId = string(raw.msgIdServer ?? raw.serverId);
      const message = normalizeMessage({ ...raw, ...(serverMessageId ? { msgIdServer: serverMessageId } : {}) }, owner, "room", this.directory);
      if (message?.memberId !== member.id || message.kind !== (kind === "IMAGE" ? "image" : "video")) return [];
      const namespace = member.channelId && /^\d+$/.test(member.channelId) ? member.channelId : roomId;
      if (serverMessageId && namespace) message.id = `room:${namespace}:${serverMessageId}`;
      // An owner-only feed proves the sender, without inventing a room ID.
      if (!roomId) message.id = message.id.replace(/^room:[^:]+:/, `legacy-owner:${member.id}:`);
      return [message];
    });
    const boundary = rows.map(row => {
      const raw = object(row);
      const id = string(raw.msgIdServer ?? raw.serverId ?? raw.msgIdClient ?? raw.msgidClient);
      const occurredAt = timestamp(raw.msgTime);
      if (!id || !occurredAt) throw new Error("Legacy media has no stable pagination boundary.");
      return { id, occurredAt };
    });
    const next = string(object(content).nextTime);
    const nextCursor = next && next !== "0" && next !== "-1" ? next : null;
    if (nextCursor && (!/^\d+$/.test(nextCursor) || !Number.isSafeInteger(Number(nextCursor)) || (Number(cursor) > 0 && Number(nextCursor) >= Number(cursor)))) throw new Error("Pocket48 repeated or invalidated the legacy media cursor.");
    return this.scopedPage({ items, boundary, observed: rows.length, nextCursor });
  }

  private async legacyRoomMedia(member: CollectorMember, kind: "IMAGE" | "VIDEO", cursor: string | null): Promise<CollectorPage<CollectorMessage>> {
    const page = await this.legacyMediaPage(member, kind, cursor);
    if (page.reachedSince) {
      // The two feeds are independently ordered. Finish images, then inspect
      // the newest videos; neither feed proves ordinary text completeness.
      return { ...page, reachedSince: false, boundary: page.boundary?.filter(item => this.inRange(item.occurredAt)),
        nextCursor: kind === "IMAGE" ? "legacy-video:0" : "legacy-video:end" };
    }
    if (!page.items.length && page.nextCursor === null) {
      if (kind === "IMAGE") return this.legacyRoomMedia(member, "VIDEO", null);
      throw new Error("Legacy room returned no further attributable media; ordinary text history remains unverified.");
    }
    return { ...page, nextCursor: page.nextCursor ? `legacy-${kind.toLowerCase()}:${page.nextCursor}` : kind === "IMAGE" ? "legacy-video:0" : "legacy-video:end" };
  }

  private async legacyRoomPage(member: CollectorMember, cursor: string | null): Promise<CollectorPage<CollectorMessage>> {
    const roomId = await this.resolveLegacyRoom(member);
    if (!roomId) return this.legacyRoomMedia(member, "IMAGE", null);
    const parts = cursor?.startsWith("legacy:") ? cursor.split(":") : null;
    if (parts && (parts[1] !== roomId || !/^\d+$/.test(parts[2] ?? ""))) throw new Error("Legacy room history completeness remains unverified.");
    const nextTime = parts?.[2] ?? "0";
    const content = await this.post("/im/api/v1/chatroom/msg/list/homeowner", { roomId, ownerId: member.id, needTop1Msg: "false", nextTime });
    const rows = contentList(content);
    if (!rows.length) return this.legacyRoomMedia(member, "IMAGE", null);
    const owner = { ...member, channelId: roomId };
    const items = rows.flatMap(row => {
      const message = normalizeMessage(row, owner, "room", this.directory);
      return message?.memberId === member.id ? [message] : [];
    });
    const boundary = rows.map(row => {
      const raw = object(row);
      const id = string(raw.msgIdServer ?? raw.msgIdClient ?? raw.msgidClient);
      const occurredAt = timestamp(raw.msgTime);
      if (!id || !occurredAt) throw new Error("Legacy message has no stable pagination boundary.");
      return { id, occurredAt };
    });
    const next = string(object(content).nextTime);
    if (next === nextTime && next !== "0") throw new Error("Pocket48 repeated the legacy room cursor.");
    return this.scopedPage({ items, boundary, observed: rows.length, nextCursor: `legacy:${roomId}:${next && next !== "0" && next !== "-1" ? next : "end"}` });
  }

  // Reuse the album's real timestamps as seek points across empty history
  // windows; an empty homepage does not prove the room archive is exhausted.
  private async historicalRoomPage(member: CollectorMember, room: { channelId: string; serverId: string }, cursor: string | null): Promise<unknown> {
    const seek = cursor?.startsWith("archive:seek:") ?? false;
    const parts = cursor?.startsWith("archive:") ? cursor.split(":").slice(seek ? 2 : 1) : [cursor ?? "0", "0"];
    if (parts.length !== 2 || !parts.every(value => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)))) throw new Error("Invalid historical room cursor.");
    let time = Number(parts[0]);
    if (this.since && time > 0 && time < Date.parse(this.since)) return { message: [], nextTime: 0 };
    const catalogCursor = parts[1]!;
    const read = async (nextTime: number) => {
      const body = { channelId: Number(room.channelId), serverId: Number(room.serverId), nextTime, limit: 50 };
      try { return await this.post("/im/api/v1/team/message/list/all", body); }
      catch (error) {
        if (!(error instanceof Error) || (object(error.cause).business !== "500" || object(error.cause).http !== 200)) throw error;
        return this.post("/im/api/v1/team/message/list/homeowner", body);
      }
    };
    let content: unknown;
    try { content = seek ? { message: [], nextTime: 0 } : await read(time); }
    catch (error) {
      if (time || !(error instanceof Error) || (object(error.cause).business !== "500" || object(error.cause).http !== 200)) throw error;
      content = { message: [], nextTime: 0 };
    }
    if (!contentList(content).length) {
      const key = `${member.id}:${catalogCursor}`;
      let anchors = this.archiveAnchors.get(key);
      if (!anchors) {
        anchors = (async () => {
          const times: number[] = [];
          let next: string | null = null;
          try {
            const album = await this.post("/im/api/v1/team/msg/list/img", { channelId: room.channelId, nextTime: Number(catalogCursor) });
            const rows = contentList(album);
            for (const row of rows) { const at = timestamp(object(row).createTime); if (at && this.inRange(at)) times.push(Date.parse(at) + 1); }
            const value = string(object(album).nextTime);
            next = value && value !== "0" && value !== "-1" ? value : null;
            if (this.since && rows.length && rows.every(row => { const at = timestamp(object(row).createTime); return at && !this.inRange(at); })) next = null;
            if (next === catalogCursor && times.length) throw new Error("Pocket48 repeated the historical anchor cursor.");
          } catch (error) { if (!(error instanceof Error) || (object(error.cause).business !== "500" || object(error.cause).http !== 200)) throw error; }
          if (catalogCursor === "0") {
            try {
              const essence = await this.post("/im/api/v1/team/essence/message/list", { channelId: Number(room.channelId), serverId: Number(room.serverId), nextTime: 0, limit: 100 });
              for (const row of Object.keys(object(essence)).length ? contentList(essence) : []) {
                const message = normalizeMessage(row, member, "essence", this.directory);
                if (message?.memberId === member.id && this.inRange(message.occurredAt)) times.push(Date.parse(message.occurredAt) + 1);
              }
            } catch (error) {
              // Essence and album availability are independent. Authentication
              // failures still stop the lookup; an unavailable essence does not.
              if (!(error instanceof Error) || object(error.cause).business !== "500" || object(error.cause).http !== 200) throw error;
            }
          }
          return { times: [...new Set(times)].sort((a, b) => b - a), next };
        })();
        this.archiveAnchors.set(key, anchors);
      }
      const page = await anchors;
      const anchor = page.times.find(at => (!this.since || at > Date.parse(this.since)) && (!time || at < time));
      if (anchor !== undefined) { time = anchor; content = await read(time); }
      else {
        if (anchor === undefined && !page.next) throw new Error("Historical room has no further anchors; history completeness remains unverified.", { cause: "history_anchors_exhausted" });
        return { message: [], nextTime: `archive:seek:${time}:${page.next}` };
      }
    }
    const next = string(object(content).nextTime);
    if (next && next !== "0" && next !== "-1" && next === String(time) && contentList(content).length) throw new Error("Pocket48 repeated a non-empty historical room cursor.");
    // A terminal or blank historical window must seek the remaining catalog,
    // rather than falsely declaring the room's complete history collected.
    const rows = contentList(content);
    if (next && next !== "0" && next !== "-1" && next !== String(time)) {
      if (!/^\d+$/.test(next) || !Number.isSafeInteger(Number(next)) || (time && Number(next) > time)) throw new Error("Pocket48 returned an invalid historical room cursor.");
      return { ...object(content), nextTime: `archive:${next}:${catalogCursor}` };
    }
    const oldest = rows.reduce<number>((value, row) => {
      const at = timestamp(object(row).msgTime);
      return at ? Math.min(value, Date.parse(at) + 1) : value;
    }, time || Number.MAX_SAFE_INTEGER);
    return { ...object(content), nextTime: `archive:seek:${oldest}:${catalogCursor}` };
  }

  // Explicit local short-video command; daily text/image collection remains
  // independent. Album names and request ownership never establish authorship.
  async listRoomVideos(member: CollectorMember, cursor: string | null) {
    if (this.since && /^\d{13}$/.test(cursor ?? "") && Number(cursor) < Date.parse(this.since)) return { videos: [], unverified: 0, observed: 0, nextCursor: null };
    const room = await this.resolveRoom(member);
    const content = await this.post("/im/api/v1/team/msg/list/img", { channelId: room.channelId, nextTime: Number(cursor ?? 0) });
    const videos: RoomVideo[] = [];
    let unverified = 0;
    const allRows = contentList(content);
    const rows = allRows.filter(value => string(object(value).sourceType)?.toUpperCase() === "VIDEO" && this.inRange(timestamp(object(value).createTime)));
    for (const value of rows) {
      const raw = object(value);
      const body = object(parsePocketJson(raw.bodys));
      const url = string(body.url);
      const at = timestamp(raw.createTime);
      if (!url || !at) { unverified += 1; continue; }
      const originals = await this.post("/im/api/v1/team/message/list/all", { channelId: Number(room.channelId), serverId: Number(room.serverId), nextTime: Date.parse(at) + 1, limit: 50 });
      const original = contentList(originals).find(value => {
        const row = object(value);
        return timestamp(row.msgTime) === at && string(object(parsePocketJson(row.bodys)).url) === url;
      });
      const message = original ? normalizeMessage(original, member, "room", this.directory) : null;
      if (!message || message.type !== "VIDEO") { unverified += 1; continue; }
      const declaredBytes = Number(body.size);
      videos.push({ id: createHash("sha256").update(url).digest("hex"), messageId: message.id, sourceUrl: url, memberId: message.memberId,
        roomOwnerId: member.id, occurredAt: at, declaredBytes: Number.isSafeInteger(declaredBytes) && declaredBytes > 0 ? declaredBytes : null,
        galleryUrl: null, thumbnailUrl: null, status: "pending" });
    }
    const next = string(object(content).nextTime);
    if (contentList(content).length > 0 && next !== null && next === cursor) throw new Error("Pocket48 repeated the video catalog cursor.");
    const times = allRows.map(value => timestamp(object(value).createTime));
    const reachedSince = this.since && times.length > 0 && times.every((at, index) => at !== null && (index === 0 || Date.parse(at) <= Date.parse(times[index - 1]!))) && times.some(at => !this.inRange(at));
    return { videos, unverified, observed: rows.length, nextCursor: !reachedSince && next && next !== "0" && next !== "-1" ? next : null };
  }

  async retryCatalog(member: CollectorMember, source: "album" | "post_images", entries: CatalogEntry[]) {
    return this.listContent(member, source, null, entries);
  }

  async listContent(member: CollectorMember, source: CollectionSource, cursor: string | null, retryEntries?: CatalogEntry[]): Promise<CollectorPage<CollectorMessage>> {
    if (this.since && !["posts", "post_images"].includes(source) && /^\d{13}$/.test(cursor ?? "") && Number(cursor) < Date.parse(this.since)) return { items: [], boundary: [], observed: 0, reachedSince: true, nextCursor: null };
    // Reuse the private raw JSON queue for versioned lookup progress, keeping
    // the complete original catalog row and its stable identity intact.
    const retryRows = retryEntries?.map(entry => {
      const parsed = parsePocketJson(entry.rawJson);
      const record = object(parsed);
      return record.format === "pocket48-album-lookup-v1" ? { value: record.item, cursors: object(record.originalCursors) } : { value: parsed, cursors: {} };
    });
    const retryItems = retryRows?.map(row => row.value);
    const originalCursors = new Map<string, Partial<Record<"all" | "homeowner", number>>>();
    const legacyOriginalIds = new Set<string>();
    if (source === "room" && (cursor?.startsWith("legacy-image:") || cursor?.startsWith("legacy-video:"))) {
      const [prefix, time, extra] = cursor.split(":");
      if (!time || extra !== undefined) throw new Error("Invalid legacy media cursor.");
      return this.legacyRoomMedia(member, prefix === "legacy-image" ? "IMAGE" : "VIDEO", time);
    }
    if (source === "room" && cursor?.startsWith("legacy:")) return this.legacyRoomPage(member, cursor);
    let content: unknown;
    let historicalRoom: { channelId: string; serverId: string; roomId: null } | null = null;
    if (source === "posts" || source === "post_images") {
      content = retryItems ? { list: retryItems, nextTime: 0 } : await this.post(source === "posts" ? "/posts/api/v1/posts/timeline/home/new" : "/posts/api/v1/posts/img/list", { userId: Number(member.id), nextId: cursor ?? "0", limit: 25 });
    } else if (source === "weibo" || source === "room_posts") {
      const roomId = await this.resolveLegacyRoom(member);
      content = await this.post("/im/api/v1/chatroom/msg/list/aim/type", { extMsgType: source === "weibo" ? "WEI_BO" : "POST_INFO", ownerId: member.id, roomId, nextTime: Number(cursor ?? 0) });
    } else {
      let room;
      try { room = await this.resolveRoom(member); }
      catch (error: unknown) {
        // Yaya queries albums/essence directly by channel/server. Historical
        // content can survive after jump and room-info stop resolving a channel.
        // Keep it as a query candidate and verify actual authors/originals below;
        // never promote it to the current room or bypass authentication failures.
        if (!(error instanceof Error) || error.cause !== "missing_room_mapping"
          || !member.channelId || !member.serverId
          || ![member.channelId, member.serverId].every(id => /^\d+$/.test(id) && Number.isSafeInteger(Number(id)) && Number(id) > 0)) {
          if (source === "room" && error instanceof Error && error.cause === "missing_room_mapping") return this.legacyRoomPage(member, cursor);
          throw error;
        }
        historicalRoom = { channelId: member.channelId, serverId: member.serverId, roomId: null };
        room = historicalRoom;
      }
      const body = { channelId: Number(room.channelId), serverId: Number(room.serverId), nextTime: Number(cursor ?? 0), limit: 25 };
      if (source === "room") {
        // all includes verified members visiting other rooms. Never infer authorship
        // from the selected room, role labels, or a non-empty response alone.
        try { content = historicalRoom || cursor?.startsWith("archive:") ? await this.historicalRoomPage(member, room, cursor) : await this.post("/im/api/v1/team/message/list/all", body); }
        catch (error) {
          if (!historicalRoom || !(error instanceof Error) || !(error.cause === "history_anchors_exhausted" || (object(error.cause).business === "500" && object(error.cause).http === 200))) throw error;
          return this.legacyRoomPage(member, cursor);
        }
      } else if (source === "album") {
        content = retryItems ? { list: retryItems, nextTime: 0 } : await this.post("/im/api/v1/team/msg/list/img", { channelId: room.channelId, nextTime: Number(cursor ?? 0) });
      } else if (source === "essence") {
        content = await this.post("/im/api/v1/team/essence/message/list", body);
      }
    }
    // Live empty essence lists omit their optional list field entirely. This
    // endpoint is finite (no pagination cursor); other unknown shapes still fail.
    const allValues = source === "essence" && content !== null && typeof content === "object" && !Array.isArray(content) && Object.keys(content).length === 0 ? [] : contentList(content);
    const rawTime = (value: unknown) => { const item = object(value), post = postObject(item); return timestamp(item.msgTime ?? item.createTime ?? item.ctime ?? item.createAt ?? post.createAt ?? post.ctime); };
    // Discard old catalog entries BEFORE any original-message lookup or media
    // request. Keep the original boundary solely to stop reverse pagination.
    const values = allValues.filter(value => this.inRange(rawTime(value)));
    if (historicalRoom && source === "essence" && (!values.length || values.some(value => normalizeMessage(value, member, source, this.directory)?.memberId !== member.id))) {
      throw new Error("Pocket48 historical essence candidate could not be verified from target-member messages; source retained for retry.");
    }
    const originalsFound = new Map<string, CollectorMessage>();
    let originalLookups = 0;
    const canLookup = () => !this.options.budget?.().stopped && originalLookups < (this.options.maxOriginalLookups ?? Infinity);
    if (source === "album") {
      const room = historicalRoom ?? await this.resolveRoom(member);
      if (historicalRoom && !values.length) throw new Error("Pocket48 historical album candidate has no verifiable originals; source retained for retry.");
      const assets = values.flatMap(value => {
        const raw = object(value);
        const url = string(object(parsePocketJson(raw.bodys)).url);
        const occurredAt = timestamp(raw.createTime);
        return url && occurredAt ? [{ id: createHash("sha256").update(url).digest("hex"), occurredAt }] : [];
      });
      // Reuse originals already verified in a previous batch, with the same
      // room/URL/time requirements. Only missing originals need upstream reads.
      for (const message of await this.options.readVerifiedMedia?.(room.channelId, assets) ?? []) {
        for (const media of [...(message.images ?? []), ...(message.videos ?? [])]) this.verifiedMedia.set(media.sourceUrl, message);
      }
      if (historicalRoom) {
        // The legacy and modern APIs use different room namespaces. Resolve the
        // legacy owner officially, then require the actual sender and exact
        // asset URL/time; a directory name or candidate channel is not evidence.
        for (const kind of ["IMAGE", "VIDEO"] as const) {
          const wanted = values.flatMap(value => {
            const raw = object(value), url = string(object(parsePocketJson(raw.bodys)).url), at = timestamp(raw.createTime);
            const known = url ? this.verifiedMedia.get(url) : undefined;
            return string(raw.sourceType)?.toUpperCase() === kind && url && at && !(known?.memberId === member.id && known.roomId === room.channelId && known.occurredAt === at) ? [{ url, at }] : [];
          });
          if (!wanted.length) continue;
          let next: string | null = String(Math.max(...wanted.map(item => Date.parse(item.at))) + 1);
          const oldest = Math.min(...wanted.map(item => Date.parse(item.at)));
          try {
            for (let page = 0; page < (this.options.albumOriginalPages ?? 3) && next !== null; page++) {
              if (!canLookup()) break;
              originalLookups += 1;
              const originals = await this.legacyMediaPage(member, kind, next);
              for (const message of originals.items) {
                originalsFound.set(message.id, message); legacyOriginalIds.add(message.id);
                for (const media of [...(message.images ?? []), ...(message.videos ?? [])]) this.verifiedMedia.set(media.sourceUrl, message);
              }
              if (wanted.every(item => { const found = this.verifiedMedia.get(item.url); return found?.memberId === member.id && found.occurredAt === item.at && legacyOriginalIds.has(found.id); })) break;
              next = originals.nextCursor;
              if (next !== null && Number(next) < oldest) break;
            }
          } catch (error) {
            if (error instanceof Error && ([401, 403].includes(Number(object(error.cause).http)) || [401, 403, 1001, 2001].includes(Number(object(error.cause).business)))) throw error;
            console.error(JSON.stringify({ event: "legacy_media_lookup_failed", memberId: member.id, kind, error: error instanceof Error ? error.message : "Legacy media lookup failed." }));
          }
        }
      }
      const groups = new Map<string, string[]>();
      for (const value of values) {
        const raw = object(value);
        const url = string(object(parsePocketJson(raw.bodys)).url);
        const at = timestamp(raw.createTime);
        const known = url ? this.verifiedMedia.get(url) : undefined;
        if (!url || !at || (known?.occurredAt === at && (known.roomId === room.channelId || legacyOriginalIds.has(known.id)) && (!historicalRoom || known.memberId === member.id))) continue;
        const urls = groups.get(at) ?? [];
        urls.push(url);
        groups.set(at, urls);
      }
      for (const [at, urls] of groups) {
        const matched = () => urls.every(url => {
          const found = this.verifiedMedia.get(url);
          return found?.occurredAt === at && found.roomId === room.channelId && (!historicalRoom || found.memberId === member.id);
        });
        const progress: Partial<Record<"all" | "homeowner", number>> = {};
        originalCursors.set(at, progress);
        // Reuse the room parser and its sender-ID checks. Latest room pages can
        // contain only fans while album images are months older; the timestamp
        // cursor retrieves the original without walking every intervening chat.
        for (const endpoint of ["all", "homeowner"] as const) {
          const hints = retryRows?.filter(row => timestamp(object(row.value).createTime) === at).map(row => row.cursors[endpoint]);
          const start = Date.parse(at) + 1;
          let nextTime = hints?.length ? Math.max(...hints.map(value => typeof value === "number" && Number.isSafeInteger(value) && value >= start - 1 && value <= start ? value : start)) : start;
          for (let page = 0; page < (this.options.albumOriginalPages ?? 3); page++) {
            if (!canLookup()) break;
            originalLookups += 1;
            let originals: unknown;
            try { originals = await this.post(`/im/api/v1/team/message/list/${endpoint}`, { channelId: Number(room.channelId), serverId: Number(room.serverId), nextTime, limit: 50 }); }
            catch (error) {
              if (!(error instanceof Error) || object(error.cause).business !== "500" || object(error.cause).http !== 200) throw error;
              break;
            }
            const rows = contentList(originals);
            for (const original of rows) {
              const message = normalizeMessage(original, member, "room", this.directory);
              if (message && (!historicalRoom || message.memberId === member.id)) {
                originalsFound.set(message.id, message);
                for (const media of [...(message.images ?? []), ...(message.videos ?? [])]) this.verifiedMedia.set(media.sourceUrl, message);
              }
            }
            if (matched()) break;
            const next = Number(string(object(originals).nextTime));
            if (!rows.length || !Number.isSafeInteger(next) || next <= 0 || next < Date.parse(at)) break;
            if (next >= nextTime) throw new Error("Pocket48 repeated the album original cursor.");
            nextTime = next;
            progress[endpoint] = next;
          }
          if (matched()) break;
        }
      }
    }
    if (source === "post_images") {
      const ids = values.flatMap(value => {
        const url = imageUrl(object(value).imgUrl);
        return url ? [createHash("sha256").update(url).digest("hex")] : [];
      });
      for (const message of await this.options.readVerifiedPostImages?.(member.id, ids) ?? []) {
        for (const image of message.images ?? []) this.verifiedMedia.set(image.sourceUrl, message);
      }
      // The timeline and image catalog have independent cursors. Reuse our
      // post parser to verify originals near each missing image group; numeric
      // image IDs are search hints only, never evidence of authorship.
      const groups = new Map<string, { anchor: string; urls: string[] }>();
      for (const value of values) {
        const raw = object(value);
        const url = imageUrl(raw.imgUrl);
        const id = string(raw.imgId);
        const at = timestamp(raw.createAt);
        if (!url || !id || !/^\d{1,32}$/.test(id) || !at || this.verifiedMedia.get(url)?.memberId === member.id) continue;
        const group = groups.get(at) ?? { anchor: id, urls: [] };
        if (BigInt(id) > BigInt(group.anchor)) group.anchor = id;
        group.urls.push(url);
        groups.set(at, group);
      }
      for (const group of groups.values()) {
        if (group.urls.every(url => this.verifiedMedia.get(url)?.memberId === member.id)) continue;
        if (!canLookup()) break;
        originalLookups += 1;
        const originals = await this.post("/posts/api/v1/posts/timeline/home/new", { userId: Number(member.id), nextId: String(BigInt(group.anchor) + 1n) });
        for (const original of contentList(originals)) {
          const message = normalizeMessage(original, member, "posts", this.directory);
          if (!message || !message.images?.some(image => group.urls.includes(image.sourceUrl))) continue;
          originalsFound.set(message.id, message);
          for (const image of message.images) this.verifiedMedia.set(image.sourceUrl, message);
        }
      }
    }
    let unverified = 0;
    const items = values.flatMap(value => {
      const raw = object(value);
      let message = normalizeMessage(value, member, source, this.directory);
      if (!message && (source === "album" || source === "post_images")) {
        const body = object(parsePocketJson(raw.bodys));
        const url = source === "album" ? string(body.url) : imageUrl(raw.imgUrl);
        const verified = url ? this.verifiedMedia.get(url) : undefined;
        // Catalogs omit sender IDs. Album attribution requires the original's
        // exact room, image URL and timestamp plus a verified sender ID. Display
        // names can carry group prefixes or change, so they are not identity.
        if (verified && (!historicalRoom || verified.memberId === member.id) && (source === "album" ? (verified.roomId === member.channelId || legacyOriginalIds.has(verified.id)) && timestamp(raw.createTime) === verified.occurredAt : verified.memberId === member.id)) {
          message = { ...verified, images: verified.images?.map(image => ({ ...image })), videos: verified.videos?.map(video => ({ ...video })), sourceFlags: (verified.sourceFlags ?? 0) | sourceFlags[source] };
        } else unverified += 1;
      }
      if (historicalRoom && source === "room" && message?.memberId !== member.id) message = null;
      if (message) for (const media of [...(message.images ?? []), ...(message.videos ?? [])]) this.verifiedMedia.set(media.sourceUrl, message);
      return message ? [message] : [];
    });
    // These are genuine room records discovered while resolving a catalog item,
    // including nearby text/replies. Preserve their original IDs and source bit;
    // discovering an older message must not move the room pagination checkpoint.
    const retained = new Map(items.map(message => [message.id, message]));
    for (const message of originalsFound.values()) if (!retained.has(message.id)) retained.set(message.id, message);
    const result = [...retained.values()].filter(message => this.inRange(message.occurredAt));
    console.log(JSON.stringify({ event: "source_page", memberId: member.id, source, unverified, observed: values.length, accepted: result.length, images: result.reduce((count, item) => count + (item.images?.length ?? 0), 0), videos: result.reduce((count, item) => count + (item.videos?.length ?? 0), 0), ownerMessages: result.filter(item => item.memberId === member.id).length }));
    const root = object(content);
    const rawCursor = string(root.nextTime ?? root.nextId ?? root.next);
    if (rawCursor !== null && rawCursor !== "0" && rawCursor !== "-1" && rawCursor === cursor) throw new Error("Pocket48 repeated a page cursor; refusing to mark history complete.");
    const boundary = allValues.flatMap(value => {
      const item = object(value);
      const post = postObject(item);
      const id = string(item.imgId ?? post.postId ?? item.msgIdServer ?? item.msgIdClient ?? item.msgidClient ?? item.postId ?? item.id);
      const occurredAt = timestamp(item.msgTime ?? item.createTime ?? item.ctime ?? item.createAt ?? post.createAt ?? post.ctime);
      // Album rows have no message IDs; their canonical image URL identifies
      // the discovery boundary only, never a new attributable archive record.
      const assetId = id ?? (source === "album" ? string(object(parsePocketJson(item.bodys)).url) : null);
      return assetId && occurredAt ? [{ id: source === "album" ? createHash("sha256").update(assetId).digest("hex") : assetId, occurredAt }] : [];
    });
    if (allValues.length > 0 && boundary.length !== allValues.length) throw new Error("Pocket48 returned items without a pagination boundary; refusing to advance.");
    const catalog = source === "album" || source === "post_images" ? values.map(value => {
      const raw = object(value);
      const url = source === "album" ? string(object(parsePocketJson(raw.bodys)).url) : imageUrl(raw.imgUrl);
      const at = timestamp(source === "album" ? raw.createTime : raw.createAt);
      const resolved = result.some(message => (message.sourceFlags ?? 0) & sourceFlags[source] && [...(message.images ?? []), ...(message.videos ?? [])].some(media => media.sourceUrl === url) && (source !== "album" || message.occurredAt === at));
      const progress = at ? originalCursors.get(at) : undefined;
      const rawJson = !resolved && progress && Object.keys(progress).length ? JSON.stringify({ format: "pocket48-album-lookup-v1", item: value, originalCursors: progress }) : JSON.stringify(value);
      return { id: createHash("sha256").update(JSON.stringify([member.id, source, url, at])).digest("hex"), source, rawJson, status: resolved ? "resolved" as const : "pending" as const };
    }) : undefined;
    return this.scopedPage({ items: result, unverified, catalog, observed: allValues.length, boundary, nextCursor: rawCursor && rawCursor !== "0" && rawCursor !== "-1" ? rawCursor : null });
  }
}
