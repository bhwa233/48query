import type { CollectionSource, ImageAttachment, VideoAttachment, SourceSync, CatalogEntry, FollowerSnapshot } from "@starter/shared";
export type { CollectionSource, SourceSync } from "@starter/shared";

// Coverage gaps are neither transport failures nor evidence of complete history.
export class SourceVerificationPending extends Error {}
export class SourceAuthenticationError extends Error {}
export class CollectorStoreError extends Error {}

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
  kind?: "text" | "image" | "video" | "reply" | "post" | "event" | "excluded" | "unknown";
  question?: string | null;
  answer?: string | null;
  source?: CollectionSource;
  sourceFlags?: number;
  images?: ImageAttachment[];
  videos?: VideoAttachment[];
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
  observed?: number; unverified?: number;
  reachedSince?: boolean;
  catalog?: CatalogEntry[];
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
  readFollowers?(member: CollectorMember): Promise<FollowerSnapshot | null>;
  listMessages(member: CollectorMember, cursor: string | null): Promise<CollectorPage<CollectorMessage>>;
  sources?: readonly CollectionSource[];
  retryCatalog?(member: CollectorMember, source: "album" | "post_images", entries: CatalogEntry[]): Promise<CollectorPage<CollectorMessage>>;
  listContent?(member: CollectorMember, source: CollectionSource, cursor: string | null): Promise<CollectorPage<CollectorMessage>>;
}

export type IngestUnit = {
  batchId: string;
  statDate: string;
  startedAt: string;
  member: CollectorMember;
  followerSnapshot?: FollowerSnapshot;
  messages: CollectorMessage[];
  recordings: CollectorRecording[];
  messageCursor: string | null;
  recordingCursor: string | null;
  totalMembers: number;
  membersCovered: number;
  errorCount: number;
  sync?: SourceSync;
  catalog?: CatalogEntry[];
};

export interface CollectorStore {
  getSyncState(memberId: string): Promise<SyncState | null>;
  ingestUnit(unit: IngestUnit): Promise<void>;
  completeBatch(input: { batchId: string; completedAt: string; membersCovered: number; totalMembers: number; errorCount: number; errorMessage?: string | null }): Promise<void>;
  getImage?(id: string): Promise<ImageAttachment | null>;
  saveImage?(image: ImageAttachment): Promise<void>;
  pendingImages?(limit: number, afterId?: string): Promise<ImageAttachment[]>;
  getVideo?(id: string): Promise<VideoAttachment | null>;
  saveVideo?(video: VideoAttachment): Promise<void>;
  pendingVideos?(limit: number, afterId?: string): Promise<VideoAttachment[]>;
  pendingCatalog?(memberId: string, source: "album" | "post_images", limit: number): Promise<CatalogEntry[]>;
  verifiedPostImages?(memberId: string, imageIds: string[]): Promise<CollectorMessage[]>;
  verifiedRoomMedia?(roomId: string, assets: { id: string; occurredAt: string }[]): Promise<CollectorMessage[]>;
}
