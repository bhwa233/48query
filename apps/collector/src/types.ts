import type { CollectionSource, ImageAttachment, SourceSync } from "@starter/shared";
export type { CollectionSource, SourceSync } from "@starter/shared";

export type CollectorMember = {
  id: string;
  name: string;
  pinyin?: string | null;
  groupName: string;
  team?: string | null;
  roomId?: string | null;
  channelId?: string | null;
  serverId?: string | null;
  liveRoomId?: string | null;
  status?: "active" | "gone";
};

export type CollectorMessage = {
  id: string;
  memberId: string;
  occurredAt: string;
  type: string;
  text?: string | null;
  senderId?: string | null;
  senderName?: string | null;
  senderType?: string | null;
  sourceJson?: string | null;
  author?: CollectorMember;
  roomOwnerId?: string | null;
  roomId?: string | null;
  kind?: "text" | "image" | "reply" | "post" | "event" | "excluded" | "unknown";
  question?: string | null;
  answer?: string | null;
  source?: CollectionSource;
  sourceFlags?: number;
  images?: ImageAttachment[];
  parseStatus?: "parsed" | "unsupported";
};

export type CollectorRecording = {
  id: string;
  memberId: string;
  title?: string | null;
  occurredAt: string;
  durationSeconds?: number | null;
  danmakuCount?: number;
  danmakuStatus?: "pending" | "parsed" | "failed";
  sourceJson?: string | null;
};

export type CollectorPage<T> = {
  items: T[];
  nextCursor: string | null;
  boundary?: { id: string; occurredAt: string }[];
  observed?: number;
};

export type SyncState = {
  memberId: string;
  messageCursor: string | null;
  recordingCursor: string | null;
  updatedAt: string;
  lastError: string | null;
  sources?: SourceSync[];
};

export interface CollectorSource {
  listMembers(): Promise<CollectorMember[]>;
  listMessages(member: CollectorMember, cursor: string | null): Promise<CollectorPage<CollectorMessage>>;
  sources?: readonly CollectionSource[];
  listContent?(member: CollectorMember, source: CollectionSource, cursor: string | null): Promise<CollectorPage<CollectorMessage>>;
}

export type IngestUnit = {
  batchId: string;
  statDate: string;
  startedAt: string;
  member: CollectorMember;
  messages: CollectorMessage[];
  recordings: CollectorRecording[];
  messageCursor: string | null;
  recordingCursor: string | null;
  totalMembers: number;
  membersCovered: number;
  errorCount: number;
  sync?: SourceSync;
};

export interface CollectorStore {
  getSyncState(memberId: string): Promise<SyncState | null>;
  ingestUnit(unit: IngestUnit): Promise<void>;
  completeBatch(input: { batchId: string; completedAt: string; membersCovered: number; totalMembers: number; errorCount: number; errorMessage?: string | null }): Promise<void>;
  getImage?(id: string): Promise<ImageAttachment | null>;
  saveImage?(image: ImageAttachment): Promise<void>;
  pendingImages?(limit: number): Promise<ImageAttachment[]>;
}
