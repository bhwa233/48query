import type { ImageAttachment, VideoAttachment } from "@starter/shared";
import type { CollectorStore } from "./types";
import type { CollectionBudget } from "./budget";

// Share the existing image/video store and gallery callbacks. The retry loop
// belongs here so both queues use the same bounded, failure-safe traversal.
export async function retryMedia(store: CollectorStore, options: {
  archiveImage?: (image: ImageAttachment) => Promise<void>;
  archiveVideo?: (video: VideoAttachment) => Promise<void>;
  imageLimit?: number;
  maxBatches?: number;
  mediaOnly?: boolean;
  budget?: CollectionBudget;
}) {
  const limit = options.imageLimit ?? (options.mediaOnly ? 100 : 25);
  const batches = options.maxBatches ?? (options.mediaOnly ? 100 : 1);
  if (!Number.isInteger(limit) || limit < 0 || limit > 100) throw new Error("Image retry limit must be between 0 and 100.");
  if (!Number.isInteger(batches) || batches < 1 || batches > 100) throw new Error("Media retry batches must be between 1 and 100.");
  let failures = 0;
  const imageBudget = options.budget && Number.isFinite(options.budget.deadline) ? options.budget.slice(Math.max(0, (options.budget.deadline - Date.now()) / 2000)) : options.budget;
  async function drain<T extends ImageAttachment | VideoAttachment>(kind: "image" | "video", size: number,
    read: ((limit: number, afterId?: string) => Promise<T[]>) | undefined,
    save: ((item: T) => Promise<void>) | undefined, archive: ((item: T) => Promise<void>) | undefined, budget = options.budget) {
    if (!read || !archive || size === 0) return 0;
    if (!save) throw new Error("Media retries require durable upload progress.");
    let afterId = options.mediaOnly ? "" : undefined;
    let attempted = 0;
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
        try { await archive(item); }
        catch (error) {
          if (budget?.stopped) break;
          item.status = "failed"; failures += 1;
          console.error(JSON.stringify({ event: `${kind}_retry_failed`, id: item.id, error: error instanceof Error ? error.message : "Upload failed." }));
        }
        await save(item);
      }
      afterId = options.mediaOnly ? pending.at(-1)!.id : undefined;
      console.log(JSON.stringify({ event: `${kind}_retry_progress`, attempted, failed: failures }));
    }
    return attempted;
  }
  const imageAttempts = await drain("image", limit, store.pendingImages?.bind(store), store.saveImage?.bind(store), options.archiveImage, imageBudget);
  const videoAttempts = await drain("video", options.mediaOnly ? 100 : 25, store.pendingVideos?.bind(store), store.saveVideo?.bind(store), options.archiveVideo);
  return { imageAttempts, videoAttempts, failures, budgetReached: Boolean(options.budget?.stopped || imageBudget?.stopped) };
}
