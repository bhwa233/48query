import type { CollectorMessage, CollectorStore, IngestUnit, SyncState } from "./types";
import type { ImageAttachment, VideoAttachment, CatalogEntry } from "@starter/shared";

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export class HttpIngestStore implements CollectorStore {
  constructor(private readonly baseUrl: string, private readonly key: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    headers.set("Accept", "application/json");
    headers.set("Content-Type", "application/json");
    headers.set("X-Ingest-Key", this.key);
    // All ingestion writes upsert stable IDs. Retry temporary bridge outages;
    // a plain-text proxy 503 must not kill an otherwise resumable long backfill.
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, { ...init, headers, signal: AbortSignal.timeout(30_000) });
      } catch (error) {
        if (attempt === 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }
      const payload = await response.json().catch(() => null) as ApiResponse<T> | null;
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }
      if (!payload || typeof payload.ok !== "boolean") throw new Error(`Invalid ingest response (HTTP ${response.status}).`);
      if (!response.ok || !payload.ok) throw new Error(payload.ok ? `Ingest request failed: ${response.status}` : `${payload.error.code}: ${payload.error.message}`);
      return payload.data;
    }
    throw new Error("Ingest request attempts exhausted.");
  }

  async getSyncState(memberId: string) {
    return this.request<SyncState>(`/api/query/ingest/state/${encodeURIComponent(memberId)}`);
  }

  async pendingCatalog(memberId: string, source: "album" | "post_images", limit: number) {
    return this.request<CatalogEntry[]>(`/api/query/ingest/catalog?memberId=${encodeURIComponent(memberId)}&source=${source}&limit=${limit}`);
  }

  async getImage(id: string) { return this.request<ImageAttachment | null>(`/api/query/ingest/images/${encodeURIComponent(id)}`); }
  async saveImage(image: ImageAttachment) { await this.request(`/api/query/ingest/images/${encodeURIComponent(image.id)}`, { method: "POST", body: JSON.stringify(image) }); }
  async pendingImages(limit: number, afterId?: string) { return this.request<ImageAttachment[]>(`/api/query/ingest/images?limit=${limit}${afterId === undefined ? "" : `&afterId=${encodeURIComponent(afterId)}`}`); }
  async getVideo(id: string) { return this.request<VideoAttachment | null>(`/api/query/ingest/videos/${encodeURIComponent(id)}`); }
  async saveVideo(video: VideoAttachment) { await this.request(`/api/query/ingest/videos/${encodeURIComponent(video.id)}`, { method: "POST", body: JSON.stringify(video) }); }
  async pendingVideos(limit: number, afterId?: string) { return this.request<VideoAttachment[]>(`/api/query/ingest/videos?limit=${limit}${afterId === undefined ? "" : `&afterId=${encodeURIComponent(afterId)}`}`); }
  async verifiedRoomMedia(roomId: string, assets: { id: string; occurredAt: string }[]) {
    return this.request<CollectorMessage[]>("/api/query/ingest/verified-media", { method: "POST", body: JSON.stringify({ scope: "room", roomId, assets }) });
  }

  async verifiedPostImages(memberId: string, imageIds: string[]) {
    return this.request<CollectorMessage[]>("/api/query/ingest/verified-media", { method: "POST", body: JSON.stringify({ scope: "posts", memberId, imageIds }) });
  }

  async ingestUnit(unit: IngestUnit) {
    if (unit.recordings.length) throw new Error("Recording ingestion is disabled.");
    // Authenticated content ingestion allows long text and multi-image messages;
    // bound UTF-8 bytes and page arrays, preserving the previous sync checkpoint.
    // Partition this transport payload here; source pagination stays intact.
    const fits = (part: IngestUnit) => part.messages.length <= 25 && part.recordings.length === 0 && (part.catalog?.length ?? 0) <= 50 && Buffer.byteLength(JSON.stringify(part), "utf8") <= 131_072;
    if (fits(unit)) {
      await this.request(`/api/query/ingest/unit`, { method: "POST", body: JSON.stringify(unit) });
      return;
    }
    const state = await this.getSyncState(unit.member.id);
    if (unit.messages.length && unit.catalog?.length) {
      // Large pages commit every original before resolving queue entries. A
      // failed message chunk must never make an unpersisted original look done.
      await this.ingestUnit({ ...unit, catalog: undefined, sync: undefined, messageCursor: state.messageCursor, recordingCursor: state.recordingCursor, membersCovered: Math.max(0, unit.membersCovered - 1) });
      await this.ingestUnit({ ...unit, messages: [] });
      return;
    }
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
      if (part.messages.length + part.recordings.length + (part.catalog?.length ?? 0) <= 1) throw new Error("One collector item exceeds the ingestion request limit; cursors were not advanced.");
      if ((part.catalog?.length ?? 0) > part.messages.length) {
        const middle = Math.ceil(part.catalog!.length / 2);
        parts.splice(index, 1, { ...part, messages: [], recordings: [], catalog: part.catalog!.slice(0, middle) }, { ...part, catalog: part.catalog!.slice(middle) });
      } else if (part.messages.length >= part.recordings.length) {
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
      const part = index === parts.length - 1 ? current : { ...current, ...checkpoint, sync: undefined };
      await this.request(`/api/query/ingest/unit`, { method: "POST", body: JSON.stringify(part) });
    }
  }

  async completeBatch(input: { batchId: string; completedAt: string; membersCovered: number; totalMembers: number; errorCount: number; errorMessage?: string | null }) {
    await this.request(`/api/query/ingest/batches/${encodeURIComponent(input.batchId)}/complete`, { method: "POST", body: JSON.stringify(input) });
  }
}
