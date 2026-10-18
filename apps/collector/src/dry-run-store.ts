import type { CollectorStore, IngestUnit, SyncState } from "./types";

export class DryRunStore implements CollectorStore {
  readonly units: IngestUnit[] = [];

  async getSyncState(memberId: string): Promise<SyncState | null> {
    return { memberId, messageCursor: null, recordingCursor: null, updatedAt: "", lastError: null };
  }

  async ingestUnit(unit: IngestUnit) {
    this.units.push(unit);
    console.log(JSON.stringify({ event: "ingest_unit", memberId: unit.member.id, messages: unit.messages.length, recordings: unit.recordings.length, messageCursor: unit.messageCursor, recordingCursor: unit.recordingCursor }));
  }

  async completeBatch(input: { batchId: string; completedAt: string; membersCovered: number; totalMembers: number; errorCount: number; errorMessage?: string | null }) {
    console.log(JSON.stringify({ event: "batch_complete", status: input.errorCount > 0 ? "failed" : "completed", ...input }));
  }
}
