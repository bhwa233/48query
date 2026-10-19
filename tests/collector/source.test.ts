import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeMessage, parsePocketJson } from "../../apps/collector/src/pocket48-content";
import { runBatch } from "../../apps/collector/src/run";
import { DryRunStore } from "../../apps/collector/src/dry-run-store";
import { DemoSource } from "../../apps/collector/src/demo-source";
import type { IngestUnit } from "../../apps/collector/src/types";
import { Pocket48Source } from "../../apps/collector/src/pocket48-source";

// The public directory's channel IDs went stale. Production requested those
// directly and got "频道不存在" instead of resolving the member's current room.
test("resolves stale directory rooms once per member and preserves upstream failures", async () => {
  let roomLookups = 0;
  let messageRequests = 0;
  let denyLookup = false;
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
