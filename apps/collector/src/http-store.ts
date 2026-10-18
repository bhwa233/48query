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
    await this.request(`/api/query/ingest/unit`, { method: "POST", body: JSON.stringify(unit) });
  }

  async completeBatch(input: { batchId: string; completedAt: string; membersCovered: number; totalMembers: number; errorCount: number; errorMessage?: string | null }) {
    await this.request(`/api/query/ingest/batches/${encodeURIComponent(input.batchId)}/complete`, { method: "POST", body: JSON.stringify(input) });
  }
}
