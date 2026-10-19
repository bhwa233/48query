import type { CollectorMember, CollectorPage, CollectorMessage, CollectorSource } from "./types";

const member: CollectorMember = {
  id: "collector-demo",
  name: "采集演示成员",
  pinyin: "caijiyanshichengyuan",
  groupName: "SNH48",
  team: "Team SII",
  roomId: "demo-room",
};

export class DemoSource implements CollectorSource {
  readonly sources = ["room"] as const;

  async listContent(member: CollectorMember, _source: string, cursor: string | null) { return this.listMessages(member, cursor); }
  async listMembers() {
    return [member];
  }

  async listMessages(_member: CollectorMember, cursor: string | null): Promise<CollectorPage<CollectorMessage>> {
    if (cursor !== null) return { items: [], nextCursor: null };
    return {
      items: [{ id: "collector-demo-message", memberId: member.id, occurredAt: "2026-10-17T12:00:00.000Z", type: "TEXT", text: "每日批次演示消息", senderId: member.id, senderName: member.name, senderType: "成员" }],
      nextCursor: null,
    };
  }

}
