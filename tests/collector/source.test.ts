import assert from "node:assert/strict";
import { test } from "node:test";
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
  await assert.rejects(source.listMessages({ ...member, id: "2" }, null), /authentication failure/);
  assert.equal(messageRequests, 2, "Failed room lookup must not become an empty successful page");
});

// Pocket48 ignores userId when next=0. Treating that global page as the
// member's recordings assigned other members' videos to the selected member.
test("bootstraps recording pagination without assigning global recordings to a member", async () => {
  const recording = (id: string, owner: number) => ({ liveId: id, userInfo: { userId: owner }, ctime: "2026-10-19T00:00:00.000Z" });
  const source = new Pocket48Source({
    token: "synthetic-token", pa: "synthetic-pa", minIntervalMs: 0,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return Response.json({ status: 200, content: Number(body.next) === 0
        ? { liveList: [recording("100", 63), recording("99", 999)], next: "99" }
        : { liveList: [recording("98", 63)], next: "97" } });
    },
  });
  const page = await source.listRecordings({ id: "63", name: "Synthetic member", groupName: "SNH48" }, null);
  assert.deepEqual(page.items.map(item => item.id).sort(), ["100", "98"]);
  assert.equal(page.nextCursor, "97");
});
