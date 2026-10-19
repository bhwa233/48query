import type { CollectorStore, IngestUnit, SyncState } from "./types";

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export class HttpIngestStore implements CollectorStore {
  constructor(private readonly baseUrl: string, private readonly key: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    headers.set("Accept", "application/json");
    headers.set("Content-Type", "application/json");
    headers.set("X-Ingest-Key", this.key);
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers,
    });
    const payload = (await response.json()) as ApiResponse<T>;
    if (!response.ok || !payload.ok) throw new Error(payload.ok ? `Ingest request failed: ${response.status}` : `${payload.error.code}: ${payload.error.message}`);
    return payload.data;
  }

  async getSyncState(memberId: string) {
    return this.request<SyncState>(`/api/query/ingest/state/${encodeURIComponent(memberId)}`);
  }

  async ingestUnit(unit: IngestUnit) {
    // The existing API caps both JSON bodies (16 KiB) and page arrays (25).
    // Partition this transport payload here; source pagination stays intact.
    const fits = (part: IngestUnit) => part.messages.length <= 25 && part.recordings.length <= 25 && Buffer.byteLength(JSON.stringify(part), "utf8") <= 16_384;
    if (fits(unit)) {
      await this.request(`/api/query/ingest/unit`, { method: "POST", body: JSON.stringify(unit) });
      return;
    }
    const state = await this.getSyncState(unit.member.id);
    const checkpoint = {
      messageCursor: state.messageCursor,
      recordingCursor: state.recordingCursor,
      membersCovered: Math.max(0, unit.membersCovered - 1),
    };
    const parts = [unit];
    for (let index = 0; index < parts.length;) {
      const part = parts[index]!;
      if (fits(part) && fits({ ...part, ...checkpoint })) {
        index += 1;
        continue;
      }
      if (part.messages.length + part.recordings.length <= 1) throw new Error("One collector item exceeds the ingestion request limit; cursors were not advanced.");
      if (part.messages.length >= part.recordings.length) {
        const middle = Math.ceil(part.messages.length / 2);
        parts.splice(index, 1, { ...part, messages: part.messages.slice(0, middle), recordings: [] }, { ...part, messages: part.messages.slice(middle) });
      } else {
        const middle = Math.ceil(part.recordings.length / 2);
        parts.splice(index, 1, { ...part, messages: [], recordings: part.recordings.slice(0, middle) }, { ...part, recordings: part.recordings.slice(middle) });
      }
    }
    for (const [index, current] of parts.entries()) {
      // Earlier chunks retain the previous page's cursors. If any write fails,
      // retry the page: ingestion upserts IDs, so already-written items are safe.
      const part = index === parts.length - 1 ? current : { ...current, ...checkpoint };
      await this.request(`/api/query/ingest/unit`, { method: "POST", body: JSON.stringify(part) });
    }
  }

  async completeBatch(input: { batchId: string; completedAt: string; membersCovered: number; totalMembers: number; errorCount: number; errorMessage?: string | null }) {
    await this.request(`/api/query/ingest/batches/${encodeURIComponent(input.batchId)}/complete`, { method: "POST", body: JSON.stringify(input) });
  }
}
