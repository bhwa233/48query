import type { ImageAttachment, VideoAttachment, MediaRetryProgress } from "@starter/shared";
import type { CollectorStore } from "./types";
import type { CollectionBudget } from "./budget";
import { SourceRequestSkipped } from "./types";
import { initializeSourceHealth, recordSourceIssue, sourceIsFailed, sourceFreshness, sourceRecovered } from "./source-health";
import { randomUUID } from "node:crypto";

// Share the existing image/video store and gallery callbacks. The retry loop
// belongs here so both queues use the same bounded, failure-safe traversal.
export async function retryMedia(store: CollectorStore, options: {
  archiveImage?: (image: ImageAttachment) => Promise<void>;
  archiveVideo?: (video: VideoAttachment) => Promise<void>;
  imageLimit?: number;
  maxBatches?: number;
  mediaOnly?: boolean;
  budget?: CollectionBudget;
  since?: string;
  runId?: string;
}) {
  const limit = options.imageLimit ?? (options.mediaOnly ? 100 : 25);
  const batches = options.maxBatches ?? (options.mediaOnly ? 100 : 1);
  if (!Number.isInteger(limit) || limit < 0 || limit > 100) throw new Error("Image retry limit must be between 0 and 100.");
  if (!Number.isInteger(batches) || batches < 1 || batches > 100) throw new Error("Media retry batches must be between 1 and 100.");
  let failures = 0;
  let persistentFailures = 0;
  const health: MediaRetryProgress[] = [];
  const runId = options.runId ?? (process.env.GITHUB_RUN_ID ? `gha-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}` : randomUUID());
  const imageBudget = options.budget && Number.isFinite(options.budget.deadline) ? options.budget.slice(Math.max(0, (options.budget.deadline - Date.now()) / 2000)) : options.budget;
  async function drain<T extends ImageAttachment | VideoAttachment>(kind: "image" | "video", size: number,
    read: ((limit: number, afterId?: string) => Promise<T[]>) | undefined,
    save: ((item: T) => Promise<void>) | undefined, archive: ((item: T) => Promise<void>) | undefined, budget = options.budget) {
    if (!read || !archive || size === 0) return 0;
    if (!save) throw new Error("Media retries require durable upload progress.");
    let progress: MediaRetryProgress | null = null;
    if (store.mediaProgress && store.saveMediaProgress) {
      progress = await store.mediaProgress(kind);
      const since = progress?.since ?? options.since;
      if (!since) throw new Error("Media retry health requires a date scope.");
      progress ??= { kind, since, revision: 0, health: { status: "pending", lastError: null } };
      progress.health = initializeSourceHealth(progress.health);
      health.push(progress);
      if (progress.health.paused || progress.health.nextRetryAt && Date.parse(progress.health.nextRetryAt) > Date.now()) {
        if (sourceIsFailed(progress.health) || sourceFreshness(progress.health) === "failed") persistentFailures++;
        return 0;
      }
    }
    let issue: Error | null = null;
    let afterId = options.mediaOnly ? "" : undefined;
    let attempted = 0;
    let successful = 0;
    for (let batch = 0; batch < (options.mediaOnly ? batches : 1); batch++) {
      if (budget?.stopped) break;
      let pending: T[];
      try { pending = await read(size, afterId); }
      catch (error) { if (budget?.stopped) break; throw error; }
      if (!pending.length) break;
      if (afterId !== undefined && pending.some((item, index) => item.id <= (index === 0 ? afterId! : pending[index - 1]!.id))) throw new Error("Media retry queue did not advance its stable cursor.");
      for (const item of pending) {
        if (budget?.stopped) break;
        attempted += 1;
        try { await archive(item); successful += 1; }
        catch (error) {
          if (budget?.stopped) break;
          item.status = "failed"; failures += 1;
          const message = error instanceof Error ? error.message : "Upload failed.";
          const current = /timeout|network|after 3 attempts|HTTP (?:429|5\d\d)|empty response/i.test(message)
            ? new SourceRequestSkipped(message) : new Error(message);
          if (!issue || !(current instanceof SourceRequestSkipped)) issue = current;
          console.error(JSON.stringify({ event: `${kind}_retry_failed`, id: item.id, error: error instanceof Error ? error.message : "Upload failed." }));
        }
        await save(item);
      }
      afterId = options.mediaOnly ? pending.at(-1)!.id : undefined;
      console.log(JSON.stringify({ event: `${kind}_retry_progress`, attempted, failed: failures }));
    }
    if (progress && store.saveMediaProgress) {
      if (issue) progress.health = recordSourceIssue(progress.health, issue, runId);
      else if (!budget?.stopped || successful > 0) progress.health = sourceRecovered(progress.health, true);
      await store.saveMediaProgress(progress);
      if (sourceIsFailed(progress.health) || sourceFreshness(progress.health) === "failed") persistentFailures++;
    }
    return attempted;
  }
  const imageAttempts = await drain("image", limit, store.pendingImages?.bind(store), store.saveImage?.bind(store), options.archiveImage, imageBudget);
  const videoAttempts = await drain("video", options.mediaOnly ? 100 : 25, store.pendingVideos?.bind(store), store.saveVideo?.bind(store), options.archiveVideo);
  return { imageAttempts, videoAttempts, failures, persistentFailures: store.mediaProgress ? persistentFailures : failures,
    health, budgetReached: Boolean(options.budget?.stopped || imageBudget?.stopped) };
}
