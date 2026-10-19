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

// Han Jiale's jump and room-info endpoints no longer locate her channel, but
// the historical essence endpoint still returns her own messages. Missing
// mapping must not suppress that archive or accept an unrelated candidate.
test("recovers member-authored historical essence without treating the candidate as a current room", async () => {
  let essenceRequests = 0;
  let empty = false;
  const source = new Pocket48Source({ token: "synthetic", pa: "synthetic", minIntervalMs: 0, fetchImpl: async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith("/im/server/jump")) return Response.json(body.starId === 4
      ? { status: 401 } : { status: 200, content: { friend: true, star: true } });
    essenceRequests++;
    return Response.json({ status: 200, content: empty ? {} : { essenceMessageList: [
      { msgIdServer: "historical-essence", msgTime: 1772881086647, msgType: "TEXT", bodys: "archived member text", extInfo: { user: { userId: "1" } } },
    ] } });
  } });
  const member = { id: "1", name: "Owner", groupName: "SNH48", channelId: "1345525", serverId: "951570" };
  const page = await source.listContent(member, "essence", null);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.memberId, member.id);
  await assert.rejects(source.listMessages(member, null), /no readable room/, "Historical essence must not authorize ordinary room requests");
  assert.equal(essenceRequests, 1);
  await assert.rejects(source.listContent({ ...member, id: "2" }, "essence", null), /historical essence.*verified/i, "Another sender cannot verify a candidate channel");
  empty = true;
  await assert.rejects(source.listContent({ ...member, id: "3" }, "essence", null), /historical essence.*verified/i, "An empty candidate must not mark unavailable history complete");
  const requestsBeforeDenial = essenceRequests;
  await assert.rejects(source.listContent({ ...member, id: "4" }, "essence", null), /business 401/);
  assert.equal(essenceRequests, requestsBeforeDenial, "An authentication failure must not trigger historical fallback");
});

// Eleven followed accounts have no modern channel, but their legacy share
// feeds still return content. A missing modern room must not block these feeds,
// and a fuzzy name search must never select another member's room. Member 37
// is absent from search; that API supports an owner-only feed with roomId="".
test("reads legacy shares without a modern channel and verifies the searched room owner", async () => {
  let shareRequests = 0;
  const source = new Pocket48Source({ token: "synthetic", pa: "synthetic", minIntervalMs: 0, fetchImpl: async (url, init) => {
    const body = JSON.parse(String(init?.body));
    const content = String(url).endsWith("/im/server/jump") ? { friend: true, star: true }
      : String(url).endsWith("/im/search") ? { data: [{ ownerId: "1", targetType: 0, targetId: "verified-room" }] }
      : (() => {
        assert.equal(body.roomId, body.ownerId === "1" ? "verified-room" : "");
        shareRequests++;
        return { message: [
          { msgidClient: "share", msgTime: 1754995019661, msgType: "CUSTOM", bodys: "", extInfo: { messageType: "WEI_BO", user: { userId: "1" }, content: "verified shared text" } },
          ...(body.ownerId === "2" ? [{ msgidClient: "owner-only", msgTime: 1754995019661, msgType: "CUSTOM", bodys: "", extInfo: { user: { userId: "2" }, content: "owner-only text" } }] : []),
        ], nextTime: 0 };
      })();
    return Response.json({ status: 200, content });
  } });
  const member = { id: "1", name: "Owner", groupName: "SNH48", channelId: "stale-channel", roomId: "stale-room" };
  const page = await source.listContent(member, "weibo", null);
  assert.equal(page.items[0]?.text, "verified shared text");
  assert.equal(member.roomId, "verified-room");
  const other = await source.listContent({ id: "2", name: "Other owner", groupName: "SNH48" }, "weibo", null);
  assert.deepEqual(other.items.map(row => row.memberId), ["2"], "Owner-only lookup must still reject content with an unverified sender");
  assert.equal(other.items[0]?.roomId, null, "A member ID is not evidence of a room ID");
  assert.equal(shareRequests, 2, "Wrong-owner search results must use owner-only lookup instead of the other room");
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
  let historical = false;
  const photo = (name: string) => `https://source.48.cn/${name}.jpg`;
  const original = (id: string, userId: string, time: number) => ({ msgIdServer: id, msgTime: time, msgType: "IMAGE", bodys: { url: photo(id) }, extInfo: { user: { userId } } });
  const makeSource = () => new Pocket48Source({ token: "synthetic", pa: "synthetic", minIntervalMs: 0, memberScope: "all", fetchImpl: async (url, init) => {
    const path = new URL(String(url)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const content = path.endsWith("/im/server/jump") ? historical ? { friend: true, star: true } : { channelId: 22, jumpServerInfo: { serverId: 33 } }
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
    return Response.json(content ? { status: 200, content } : { members: [{ id: "1", name: "Owner", channelId: 22, serverId: 33 }, { id: "2", name: "Visitor" }] });
  } });
  const source = makeSource();
  const members = await source.listMembers();
  const page = await source.listContent(members[0]!, "album", null);
  const catalog = page.items.filter(row => row.sourceFlags === 3);
  assert.deepEqual(catalog.map(row => [row.memberId, row.roomOwnerId]), [["1", "1"], ["2", "1"], ["2", "1"]]);
  assert.ok(page.items.every(row => row.id.startsWith("room:22:") && row.memberId !== "999"));
  assert.equal(catalog.find(row => row.kind === "video")?.videos?.[0]?.status, "pending");
  assert.equal(page.items.find(row => row.type === "TEXT")?.sourceFlags, 1, "Nearby room text must not masquerade as an album entry");
  assert.equal(page.unverified, 2, "Fan impersonation and wrong-time image reuse must remain unverified");
  // Chen Hongyu's historical album survives while jump is empty. Keep matched
  // owner content without promoting the candidate to a verified current room.
  historical = true;
  const archive = makeSource();
  const archivedMembers = await archive.listMembers();
  const archived = await archive.listContent(archivedMembers[0]!, "album", null);
  assert.ok(archived.items.some(row => row.sourceFlags === 3 && row.kind === "image"));
  assert.ok(archived.items.every(row => row.memberId === "1"), "An unconfirmed channel must not attribute visiting members to the selected owner");
  assert.equal(archived.unverified, 4);
  await assert.rejects(archive.listMessages(archivedMembers[0]!, null), /no readable room/);
});

// Han Jiale's image catalog predates her latest text-only posts by months.
// Resolve nearby original posts, but never use the catalog's owner parameter
// as evidence that an image belongs to that member.
test("resolves old post images from original posts and retains unverified catalog entries", async () => {
  const member = { id: "1", name: "Owner", groupName: "SNH48" };
  const photo = (name: string) => `https://source.48.cn/${name}.jpg`;
  const time = 1754995019661;
  let lookups = 0;
  let verified: Awaited<ReturnType<Pocket48Source["listMessages"]>>["items"] = [];
  const source = new Pocket48Source({ token: "synthetic", pa: "synthetic", minIntervalMs: 0,
    readVerifiedPostImages: async () => verified,
    fetchImpl: async (url) => {
      if (String(url).endsWith("/posts/img/list")) return Response.json({ status: 200, content: { list: [
        { imgId: "1162096596169330688", imgUrl: photo("a"), createAt: time },
        { imgId: "1162096596169330687", imgUrl: photo("b"), createAt: time },
        { imgId: "1162096596169330686", imgUrl: photo("unverified"), createAt: time },
      ], next: "older-images" } });
      lookups++;
      return Response.json({ status: 200, content: { postsInfo: [
        { type: "POSTS", data: { postsInfo: { postId: "original", userId: "1", createAt: time + 7, postContent: "original member post", previewImg: [{ imgUrl: photo("a") }, { imgUrl: photo("b") }] } } },
        { type: "POSTS", data: { postsInfo: { postId: "other-author", userId: "2", createAt: time, previewImg: [{ imgUrl: photo("unverified") }] } } },
      ], nextId: "0" } });
    },
  });
  const page = await source.listContent(member, "post_images", null);
  assert.equal(page.unverified, 1, "An image owned only by a different author's post remains unverified");
  assert.equal(lookups, 1, "Images created together should share the original-post lookup");
  assert.ok(page.items.some(row => row.id === "post:original" && row.text === "original member post"));
  assert.ok(page.items.every(row => row.memberId === member.id));
  assert.equal(page.nextCursor, "older-images", "The catalog's pagination remains independent from post lookups");
  verified = page.items;
  await source.listContent(member, "post_images", null);
  assert.equal(lookups, 2, "Only the still-unverified image needs another lookup");
});

// Chen Hongyu's verified 2022 album originals use the older NIM CDN. Preserve
// their image bytes while continuing to reject unrelated source hosts.
test("uploads verified historical NIM images without accepting lookalike hosts", async () => {
  const bytes = Buffer.from("ffd8ffe000104a4649460001", "hex");
  let downloads = 0;
  const gallery = new GalleryUploader({ fetchImpl: async (url, init) => {
    if (!String(url).endsWith("/upload")) { downloads++; return new Response(bytes); }
    assert.ok(init?.body instanceof FormData);
    const file = init.body.get("file");
    assert.ok(file instanceof File);
    assert.equal(file.type, "image/jpeg");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
    return Response.json([{ src: "https://gallery.example/historical.jpg" }]);
  } });
  const image = { id: "historical-image", sourceUrl: "https://nim-nosdn.netease.im/original", galleryUrl: null, thumbnailUrl: null, width: null, height: null, status: "pending" as const };
  await gallery.upload(image);
  assert.equal(image.galleryUrl, "https://gallery.example/historical.jpg");
  await assert.rejects(gallery.upload({ ...image, sourceUrl: "https://nim-nosdn.netease.im.example/original" }), /source host/);
  assert.equal(downloads, 1);
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
