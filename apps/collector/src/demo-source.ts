import type { CollectorMember, CollectorPage, CollectorMessage, CollectorRecording, CollectorSource } from "./types";

const member: CollectorMember = {
  id: "collector-demo",
  name: "采集演示成员",
  pinyin: "caijiyanshichengyuan",
  groupName: "SNH48",
  team: "Team SII",
  roomId: "demo-room",
};

export class DemoSource implements CollectorSource {
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

  async listRecordings(_member: CollectorMember, cursor: string | null): Promise<CollectorPage<CollectorRecording>> {
    if (cursor !== null) return { items: [], nextCursor: null };
    return {
      items: [{ id: "collector-demo-recording", memberId: member.id, title: "每日批次演示录播", occurredAt: "2026-10-17T13:00:00.000Z", durationSeconds: 120, danmakuCount: 4, danmakuStatus: "parsed" }],
      nextCursor: null,
    };
  }
}
