import assert from "node:assert/strict";
import { test } from "node:test";
import { contentList, normalizeMessage, parsePocketJson } from "../../apps/collector/src/pocket48-content";
import { runBatch } from "../../apps/collector/src/run";
import { DryRunStore } from "../../apps/collector/src/dry-run-store";
import { DemoSource } from "../../apps/collector/src/demo-source";
import type { IngestUnit } from "../../apps/collector/src/types";
import { Pocket48Source } from "../../apps/collector/src/pocket48-source";
import { GalleryUploader } from "../../apps/collector/src/gallery";

// Variable signing latency must not let simultaneous callers send a burst
// after their pre-signing rate-limit slots have already elapsed.
test("spaces actual Pocket48 requests even when signing completes out of order", async context => {
  const start = Date.parse("2026-10-19T00:00:00Z");
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: start });
  let finishSigning!: (pa: string) => void;
  const slowSignature = new Promise<string>(resolve => { finishSigning = resolve; });
  let signatures = 0;
  const attempts: number[] = [];
  const source = new Pocket48Source({ token: "synthetic-token", minIntervalMs: 1200,
    paFactory: () => ++signatures === 1 ? slowSignature : "synthetic-pa",
    fetchImpl: async () => { attempts.push(Date.now()); return Response.json({ status: 200, content: { nextId: "0" } }); },
  });
  const member = { id: "1", name: "Member", groupName: "SNH48" };
  const done = Promise.all([source.listContent(member, "posts", null), source.listContent(member, "posts", null)]);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(attempts, [start]);
  context.mock.timers.tick(500);
  finishSigning("synthetic-pa");
  await new Promise<void>(resolve => setImmediate(resolve));
  context.mock.timers.tick(699);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(attempts.length, 1, "Finishing a slow signature must not bypass the request delay");
  context.mock.timers.tick(1);
  await done;
  assert.deepEqual(attempts, [start, start + 1200]);
});

// The public directory's channel IDs went stale. Production requested those
// directly and got "频道不存在" instead of resolving the member's current room.
test("resolves stale directory rooms once per member and preserves upstream failures", async () => {
  let roomLookups = 0;
  let messageRequests = 0;
  let denyLookup = false;
  let emptyEssence = false;
  const source = new Pocket48Source({
    token: "synthetic-token",
    pa: "synthetic-pa",
    minIntervalMs: 0,
    fetchImpl: async (url, init) => {
      const body = JSON.parse(String(init?.body));
      if (String(url).endsWith("/im/server/jump")) {
        roomLookups += 1;
        return Response.json(denyLookup
          ? { status: 401, success: false, message: "synthetic authentication failure" }
          : { status: 200, content: body.tabId === 0
            ? { channelId: 22, jumpServerInfo: { serverId: 33 } }
            : { friend: false, star: true } });
      }
      messageRequests += 1;
      if (body.channelId !== 22 || body.serverId !== 33) {
        return Response.json({ status: 500, success: false, message: "频道不存在" });
      }
      if (String(url).endsWith("/essence/message/list")) return Response.json({ status: 200, content: emptyEssence ? {} : { essenceMessageList: [{ msgIdServer: "essence-id", msgTime: 1792368000000, msgType: "TEXT", bodys: "member text", extInfo: { user: { userId: "1" } } }] } });
      return Response.json({ status: 200, content: { message: [], nextTime: body.nextTime } });
    },
  });
  const member = { id: "1", name: "Synthetic member", groupName: "SNH48", channelId: "old-channel", serverId: "old-server" };
  await source.listMessages(member, null);
  await source.listMessages(member, "123");
  assert.equal(roomLookups, 1);
  assert.equal(messageRequests, 2);
  denyLookup = true;
  await assert.rejects(source.listMessages({ ...member, id: "2" }, null), /business 401/);
  assert.equal(messageRequests, 2, "Failed room lookup must not become an empty successful page");
  // Live essence responses have no nextTime. Missing cursors must not compare
  // equal to the initial null cursor and reject a valid finite list.
  const essence = await source.listContent(member, "essence", null);
  assert.equal(essence.items[0]?.text, "member text");
  assert.equal(essence.nextCursor, null);
  emptyEssence = true;
  assert.deepEqual((await source.listContent(member, "essence", null)).items, []);
});

// Reference formats place old TEXT content in extInfo, and use integers too
// large for IEEE-754 IDs. A room name or member role must never assign fan text.
test("preserves member authorship, large IDs, legacy text and public question/answer meaning", () => {
  const owner = { id: "1", name: "Owner", groupName: "SNH48", channelId: "10" };
  const visitor = { id: "2", name: "Visitor", groupName: "SNH48" };
  const directory = new Map([[owner.id, owner], [visitor.id, visitor]]);
  const raw = parsePocketJson('{"msgIdServer":9007199254740993,"msgType":0,"msgTime":1792368000000,"bodys":"","extInfo":{"senderId":"2","messageType":"TEXT","text":"legacy member text"}}');
  const message = normalizeMessage(raw, owner, "room", directory);
  assert.equal(message?.id, "room:10:9007199254740993");
  assert.equal(message.memberId, visitor.id);
  assert.equal(message.roomOwnerId, owner.id);
  assert.equal(message.text, "legacy member text");
  assert.equal(normalizeMessage({ ...(raw as object), extInfo: { senderId: "999", roleId: 3 } }, owner, "room", directory), null);
  const reply = normalizeMessage({ msgIdClient: "reply", msgTime: 1792368000000, extInfo: { senderId: "1", messageObject: "faipaiText", faipaiContent: "public question", messageText: "member answer" } }, owner, "room", directory);
  assert.equal(reply?.question, "public question");
  assert.equal(reply.answer, "member answer");
  // Live 2026 responses wrap posts twice and use createAt/previewImg. The
  // previous parser silently skipped the entire member timeline.
  assert.deepEqual(contentList({ nextId: "0" }), []);
  assert.throws(() => contentList({ nextId: "123" }), /unknown content list shape/);
  const posts = contentList({ postsInfo: [{ type: "POST", data: { postsInfo: { postId: "large-post-id", userId: "1", createAt: "1792368000000", title: "Title", postContent: "Full member post", previewImg: [{ imgUrl: "https://source.48.cn/test.jpg", imgWidth: 640, imgHeight: 480 }] } } }] });
  const post = normalizeMessage(posts[0], owner, "posts", directory);
  assert.equal(post?.id, "post:large-post-id");
  assert.equal(post.text, "Title\nFull member post");
  assert.equal(post.images?.[0]?.width, 640);
  assert.equal(normalizeMessage({ imgId: "anonymous", imgUrl: "https://source.48.cn/test.jpg", createAt: "1792368000000" }, owner, "post_images", directory), null, "Catalog request parameters cannot invent member authorship");

});

// The old batch always fetched recordings, and daily runs resumed only old
// history. Exercise the actual state machine across a partial increment/restart.
test("keeps latest sync and history independent, with zero recording requests", async () => {
  const member = { id: "owner", name: "Owner", groupName: "SNH48" };
  const calls: (string | null)[] = [];
  const store = new DryRunStore();
  let saved = {
    source: "room" as const, historyCursor: "old-history", historyDone: false,
    latestAt: "2026-10-17T00:00:00.000Z", latestIds: ["old"], incrementalCursor: null as string | null,
    pendingLatestAt: null as string | null, pendingLatestIds: [] as string[],
    status: "ok" as const, lastError: null, lastSuccessAt: null, lastNonemptyAt: "2026-10-17T00:00:00.000Z",
  };
  store.getSyncState = async memberId => ({ memberId, messageCursor: null, recordingCursor: null, updatedAt: "", lastError: null, sources: [saved] });
  store.ingestUnit = async (unit: IngestUnit) => { assert.deepEqual(unit.recordings, []); if (unit.sync) saved = unit.sync as typeof saved; };
  const source = {
    listMembers: async () => [member],
    listMessages: async (_member: typeof member, cursor: string | null) => {
      calls.push(cursor);
      const at = cursor === "old-history" ? "2026-10-01T00:00:00.000Z" : cursor === "increment-tail" ? "2026-10-16T00:00:00.000Z" : "2026-10-19T00:00:00.000Z";
      return { items: [{ id: cursor ?? "new", memberId: member.id, occurredAt: at, type: "TEXT", text: "member text" }], nextCursor: cursor === null ? "increment-tail" : null };
    },
    listRecordings: async () => { throw new Error("Recording requests must be impossible from the batch"); },
  };
  await runBatch(source, store, { maxPagesPerMember: 1 });
  assert.equal(saved.latestAt, "2026-10-17T00:00:00.000Z", "unfinished increment must retain its old high watermark");
  assert.equal(saved.incrementalCursor, "increment-tail");
  assert.equal(saved.historyDone, true);
  assert.deepEqual(calls, [null, "old-history"]);
  calls.length = 0;
  await runBatch(source, store, { maxPagesPerMember: 1 });
  assert.deepEqual(calls, ["increment-tail"]);
  assert.equal(saved.latestAt, "2026-10-19T00:00:00.000Z");
  assert.equal(saved.incrementalCursor, null);
});

test("an empty room is reported as unverified without losing the batch", async () => {
  class EmptySource extends DemoSource {
    override async listMessages() { return { items: [], nextCursor: null }; }
  }
  const store = new DryRunStore();
  const result = await runBatch(new EmptySource(), store);
  assert.equal(result.errorCount, 1);
  assert.equal(result.membersCovered, 0);
  assert.equal(store.units.at(-2)?.sync?.historyDone, false);
});

// Live albums omit sender IDs and may be months older than the latest room
// page. Resolve the original message, without trusting its displayed starName
// or attributing a reused image from a different timestamp.
test("verifies album authors from original room messages, including visiting members", async () => {
  const at = 1792368000000;
  const photo = (name: string) => `https://source.48.cn/${name}.jpg`;
  const original = (id: string, userId: string, time: number) => ({ msgIdServer: id, msgTime: time, msgType: "IMAGE", bodys: { url: photo(id) }, extInfo: { user: { userId } } });
  const source = new Pocket48Source({ token: "synthetic", pa: "synthetic", minIntervalMs: 0, memberScope: "all", fetchImpl: async (url, init) => {
    const path = new URL(String(url)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const content = path.endsWith("/im/server/jump") ? { channelId: 22, jumpServerInfo: { serverId: 33 } }
      : path.endsWith("/msg/list/img") ? { imgAndVideoList: [
        { starName: "SNH48-Owner", sourceType: "IMAGE", createTime: at, bodys: { url: photo("owner") } },
        { starName: "Visitor", sourceType: "IMAGE", createTime: at + 1000, bodys: { url: photo("visitor") } },
        { starName: "Owner", sourceType: "IMAGE", createTime: at + 2000, bodys: { url: photo("fan") } },
        { starName: "Owner", sourceType: "IMAGE", createTime: at + 3000, bodys: { url: photo("stale") } },
        { starName: "Owner", sourceType: "VIDEO", createTime: at + 4000, bodys: { url: "https://source.48.cn/video.mp4" } },
      ], nextTime: 0 }
      : path.endsWith("/message/list/all") ? { message: [
        original("owner", "1", at), original("visitor", "2", at + 1000),
        original("fan", "999", at + 2000), original("stale", "1", at - 1000),
        { msgIdServer: "video", msgTime: at + 4000, msgType: "VIDEO", bodys: { url: "https://source.48.cn/video.mp4" }, extInfo: { user: { userId: "2" } } },
        { msgIdServer: "nearby-text", msgTime: at - 2000, msgType: "TEXT", bodys: "verified nearby text", extInfo: { user: { userId: "1" } } },
      ].filter(row => row.msgTime < body.nextTime), nextTime: 0 }
      : null;
    return Response.json(content ? { status: 200, content } : { members: [{ id: "1", name: "Owner" }, { id: "2", name: "Visitor" }] });
  } });
  const members = await source.listMembers();
  const page = await source.listContent(members[0]!, "album", null);
  const catalog = page.items.filter(row => row.sourceFlags === 3);
  assert.deepEqual(catalog.map(row => [row.memberId, row.roomOwnerId]), [["1", "1"], ["2", "1"], ["2", "1"]]);
  assert.ok(page.items.every(row => row.id.startsWith("room:22:") && row.memberId !== "999"));
  assert.equal(catalog.find(row => row.kind === "video")?.videos?.[0]?.status, "pending");
  assert.equal(page.items.find(row => row.type === "TEXT")?.sourceFlags, 1, "Nearby room text must not masquerade as an album entry");
  assert.equal(page.unverified, 2, "Fan impersonation and wrong-time image reuse must remain unverified");
});

// The size rule must hold when a CDN omits Content-Length or lies about it:
// reject oversized streamed bodies before any upload, and keep MP4 bytes intact.
test("bounds short-video downloads before uploading original MP4 bytes", async () => {
  const bytes = Buffer.from("00000018667479706d7034320000000069736f6d6d703432", "hex");
  let uploads = 0;
  let redirect = false;
  const gallery = new GalleryUploader({ fetchImpl: async (url, init) => {
    if (String(url).endsWith("/upload")) {
      uploads += 1;
      assert.ok(init?.body instanceof FormData);
      const file = init.body.get("file");
      assert.ok(file instanceof File);
      assert.equal(file.type, "video/mp4");
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
      return Response.json([{ src: "https://gallery.example/short.mp4" }]);
    }
    if (redirect) return new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/private" } });
    if (init?.method === "HEAD") return new Response(null, { status: 405 });
    if ((init?.headers as Record<string, string>)?.Range) return new Response(bytes.subarray(0, 1), { status: 206, headers: { "Content-Range": `bytes 0-0/${bytes.length}` } });
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.subarray(0, 12)); controller.enqueue(bytes.subarray(12)); controller.close(); } }));
  } });
  const video = { id: "synthetic-video", sourceUrl: "https://kd48-nosdn.yunxinsvr.com/short-video", galleryUrl: null as string | null, thumbnailUrl: null as string | null, status: "pending" as const };
  assert.equal(await gallery.videoSize(video.sourceUrl), bytes.length);
  await assert.rejects(gallery.uploadVideo(video, bytes.length - 1), /size limit/);
  assert.equal(uploads, 0);
  assert.equal(await gallery.uploadVideo(video, bytes.length), bytes.length);
  assert.equal(video.galleryUrl, "https://gallery.example/short.mp4");
  assert.equal(uploads, 1);
  redirect = true;
  await assert.rejects(gallery.uploadVideo({ ...video, galleryUrl: null }), /source host/);
  assert.equal(uploads, 1, "Untrusted redirects must not result in uploads");
});

// Live followed member 37 was missing from the community directory, while
// system account 63 was incorrectly selected as a member. Only an explicit
// official member flag and matching ID can promote a missing account.
test("recovers followed members missing from the directory without admitting nonmembers", async () => {
  const source = new Pocket48Source({ token: "synthetic", pa: "synthetic", minIntervalMs: 0, fetchImpl: async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (!init?.body) return Response.json({ members: [{ id: "1", name: "Owner" }, { id: "63", name: "System" }] });
    if (path.endsWith("/friends/id")) return Response.json({ status: 200, content: { data: ["1", "37", "63", "999"] } });
    const { userId } = JSON.parse(String(init.body));
    return Response.json({ status: 200, content: { baseUserInfo: { userId, nickname: "Profile account", isStar: userId === "37" } } });
  } });
  assert.deepEqual((await source.listMembers()).map(member => member.id).sort(), ["1", "37"]);
});

// A real gallery outage can hold a page for minutes. If the process is lost
// during that upload, content must already exist, with no advanced checkpoint.
test("persists media-page text before uploading without advancing its checkpoint", async () => {
  const store = new DryRunStore();
  const member = { id: "owner", name: "Owner", groupName: "SNH48" };
  const image = { id: "image", sourceUrl: "https://source.48.cn/image.jpg", galleryUrl: null, thumbnailUrl: null, width: null, height: null, status: "pending" as const };
  const source = { listMembers: async () => [member], listMessages: async () => ({ items: [{ id: "post", memberId: member.id, occurredAt: "2026-10-19T00:00:00.000Z", type: "POST_INFO", kind: "post" as const, text: "member text", images: [image] }], nextCursor: "history" }) };
  let observed = false;
  const result = await runBatch(source, store, { maxPagesPerMember: 1, maxHistoryPagesPerMember: 0, archiveImage: async () => {
    const saved = store.units.find(unit => unit.messages[0]?.id === "post");
    assert.ok(saved);
    assert.equal(saved?.messages[0]?.text, "member text");
    assert.equal(saved.sync, undefined);
    assert.ok(!store.units.some(unit => unit.sync));
    observed = true;
    throw new Error("Gallery unavailable");
  } });
  assert.ok(observed);
  assert.equal(result.imageFailures, 1);
  assert.equal(result.messagesWritten, 1);
  assert.equal(store.units.find(unit => unit.sync)?.sync?.historyCursor, "history");
});

// Gallery production logs exposed Telegram 429s as HTTP 200/[]; pausing only
// the failed file lets queued files keep hitting the same flood window.
test("pauses all queued gallery uploads after an empty success response and retries", async context => {
  const start = Date.parse("2026-10-19T00:00:00Z");
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: start });
  const bytes = Buffer.from("00000018667479706d7034320000000069736f6d6d703432", "hex");
  const attempts: number[] = [];
  const gallery = new GalleryUploader({ fetchImpl: async url => {
    if (!String(url).endsWith("/upload")) return new Response(bytes);
    attempts.push(Date.now());
    return Response.json(attempts.length === 1 ? [] : [{ src: "https://gallery.example/video.mp4" }]);
  } });
  const video = (id: string) => ({ id, sourceUrl: "https://kd48-nosdn.yunxinsvr.com/video", galleryUrl: null as string | null, thumbnailUrl: null as string | null, status: "pending" as const });
  const first = video("first");
  const second = video("second");
  const done = Promise.all([gallery.uploadVideo(first), gallery.uploadVideo(second)]);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(attempts, [start]);
  assert.equal(first.galleryUrl, null, "An empty response cannot mark a file uploaded");
  context.mock.timers.tick(29_999);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(attempts.length, 1, "Other waiting files must also respect the cooldown");
  context.mock.timers.tick(1);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(attempts, [start, start + 30_000]);
  context.mock.timers.tick(3100);
  await done;
  assert.deepEqual(attempts, [start, start + 30_000, start + 33_100]);
  assert.equal(first.galleryUrl, "https://gallery.example/video.mp4");
  assert.equal(second.galleryUrl, first.galleryUrl);
});
