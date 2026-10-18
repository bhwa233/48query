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
};

export type SyncState = {
  memberId: string;
  messageCursor: string | null;
  recordingCursor: string | null;
  updatedAt: string;
  lastError: string | null;
};

export interface CollectorSource {
  listMembers(): Promise<CollectorMember[]>;
  listMessages(member: CollectorMember, cursor: string | null): Promise<CollectorPage<CollectorMessage>>;
  listRecordings(member: CollectorMember, cursor: string | null): Promise<CollectorPage<CollectorRecording>>;
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
};

export interface CollectorStore {
  getSyncState(memberId: string): Promise<SyncState | null>;
  ingestUnit(unit: IngestUnit): Promise<void>;
  completeBatch(input: { batchId: string; completedAt: string; membersCovered: number; totalMembers: number; errorCount: number; errorMessage?: string | null }): Promise<void>;
}
