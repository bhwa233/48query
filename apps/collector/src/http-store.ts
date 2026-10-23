import type { CollectorMessage, CollectorStore, IngestUnit, SyncState } from "./types";
import { CollectorStoreError, SourceVerificationPending } from "./types";
import type { ImageAttachment, VideoAttachment, CatalogEntry, CollectorProgress, CollectorRun, MeleePage, MeleeProgress, MediaRetryProgress } from "@starter/shared";
import { object, parsePocketJson, timestamp } from "./pocket48-content";
import type { CollectionBudget } from "./budget";
import { randomUUID } from "node:crypto";

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export class HttpIngestStore implements CollectorStore {
  constructor(private readonly baseUrl: string, private readonly key: string, private readonly since?: string, private readonly budget?: CollectionBudget) {}

  async meleeProgress(periodId: number) { return this.request<MeleeProgress | null>(`/api/query/ingest/melee/${periodId}`); }
  async saveMeleePage(page: MeleePage) { return this.request<MeleeProgress>("/api/query/ingest/melee", { method: "POST", body: JSON.stringify(page) }); }

  async collectionProgress(): Promise<Map<string, CollectorProgress>> {
    if (!this.since) throw new Error("Durable collector progress requires an explicit date scope.");
    const entries = new Map<string, CollectorProgress>();
    let after: string | null = null;
    do {
      const query = new URLSearchParams({ since: this.since, ...(after ? { after } : {}) });
      const page: { data: CollectorProgress[]; nextCursor: string | null } = await this.request(`/api/query/ingest/progress?${query}`, undefined, true);
      for (const entry of page.data) entries.set(entry.memberId, entry);
      if (page.nextCursor && after && page.nextCursor <= after) throw new Error("Collector progress cursor did not advance.");
      after = page.nextCursor;
    } while (after);
    return entries;
  }

  async saveCollectionProgress(progress: CollectorProgress) {
    const saved = await this.request<{ revision: number }>("/api/query/ingest/progress", { method: "POST", body: JSON.stringify({ ...progress, writeId: randomUUID() }) });
    progress.revision = saved.revision;
  }

  async saveRun(run: CollectorRun) {
    await this.request("/api/query/ingest/runs", { method: "POST", body: JSON.stringify(run) });
  }

  async mediaProgress(kind: "image" | "video") {
    if (!this.since) throw new Error("Media health requires a date scope.");
    return this.request<MediaRetryProgress | null>(`/api/query/ingest/media-progress/${kind}?since=${encodeURIComponent(this.since)}`);
  }

  async saveMediaProgress(progress: MediaRetryProgress) {
    const saved = await this.request<{ revision: number }>(`/api/query/ingest/media-progress/${progress.kind}`,
      { method: "POST", body: JSON.stringify({ ...progress, writeId: randomUUID() }) });
    progress.revision = saved.revision;
  }

  private async request<T>(path: string, init?: RequestInit, envelope = false): Promise<T> {
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
        if (attempt === 2) throw new CollectorStoreError("Ingest connection attempts exhausted.", { cause: error });
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }
      const payload = await response.json().catch(() => null) as ApiResponse<T> | null;
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }
      if (!payload || typeof payload.ok !== "boolean") {
        if (response.ok && attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
        throw new CollectorStoreError(`Invalid ingest response (HTTP ${response.status}).`);
      }
      if (!response.ok || !payload.ok) throw new CollectorStoreError(payload.ok ? `Ingest request failed: ${response.status}` : `${payload.error.code}: ${payload.error.message}`);
      return (envelope ? payload : payload.data) as T;
    }
    throw new Error("Ingest request attempts exhausted.");
  }

  private async pendingScopedMedia(kind: "images" | "videos", limit: number, afterId?: string) {
    this.budget?.check();
    const query = new URLSearchParams({ since: this.since!, limit: String(limit), ...(afterId === undefined ? {} : { afterId }) });
    const page = await this.request<{ data: (ImageAttachment | VideoAttachment)[]; since?: string }>(`/api/query/ingest/${kind}?${query}`, undefined, true);
    // An older API may ignore unknown query fields. Require its explicit scope
    // confirmation before any external upload; never fall back to an unbounded queue.
    if (page.since !== this.since) throw new Error("Media queue API did not confirm the requested date scope.");
    return page.data;
  }

  async getSyncState(memberId: string) {
    return this.request<SyncState>(`/api/query/ingest/state/${encodeURIComponent(memberId)}`);
  }

  async pendingCatalog(memberId: string, source: "album" | "post_images", limit: number) {
    const entries = await this.request<CatalogEntry[]>(`/api/query/ingest/catalog?memberId=${encodeURIComponent(memberId)}&source=${source}&limit=${this.since ? 50 : limit}`);
    if (!this.since) return entries;
    const eligible = entries.filter(entry => {
      const raw = object(parsePocketJson(entry.rawJson));
      const item = raw.format === "pocket48-album-lookup-v1" ? object(raw.item) : raw;
      const at = timestamp(source === "album" ? item.createTime : item.createAt);
      if (!at) throw new SourceVerificationPending("Catalog entry has no verifiable date; scoped verification remains incomplete.");
      return Date.parse(at) >= Date.parse(this.since!);
    });
    if (entries.length === 50 && eligible.length === 0) throw new SourceVerificationPending("Older catalog rows fill the queue window; scoped pending coverage remains unverified.");
    return eligible.slice(0, limit);
  }

  async getImage(id: string) { return this.request<ImageAttachment | null>(`/api/query/ingest/images/${encodeURIComponent(id)}`); }
  async saveImage(image: ImageAttachment) { await this.request(`/api/query/ingest/images/${encodeURIComponent(image.id)}`, { method: "POST", body: JSON.stringify(image) }); }
  async pendingImages(limit: number, afterId?: string): Promise<ImageAttachment[]> { return this.since ? this.pendingScopedMedia("images", limit, afterId) as Promise<ImageAttachment[]> : this.request<ImageAttachment[]>(`/api/query/ingest/images?limit=${limit}${afterId === undefined ? "" : `&afterId=${encodeURIComponent(afterId)}`}`); }
  async getVideo(id: string) { return this.request<VideoAttachment | null>(`/api/query/ingest/videos/${encodeURIComponent(id)}`); }
  async saveVideo(video: VideoAttachment) { await this.request(`/api/query/ingest/videos/${encodeURIComponent(video.id)}`, { method: "POST", body: JSON.stringify(video) }); }
  async pendingVideos(limit: number, afterId?: string): Promise<VideoAttachment[]> { return this.since ? this.pendingScopedMedia("videos", limit, afterId) : this.request<VideoAttachment[]>(`/api/query/ingest/videos?limit=${limit}${afterId === undefined ? "" : `&afterId=${encodeURIComponent(afterId)}`}`); }
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
