import type { CollectorSource, CollectorStore } from "./types";

function shanghaiDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export async function runBatch(source: CollectorSource, store: CollectorStore, options: { statDate?: string; batchId?: string; maxPagesPerMember?: number; maxMembers?: number } = {}) {
  const startedAt = new Date().toISOString();
  const statDate = options.statDate ?? shanghaiDate();
  const batchId = options.batchId ?? `batch-${statDate}-${Date.now()}`;
  const maxPages = options.maxPagesPerMember ?? 10;
  const allMembers = await source.listMembers();
  const members = options.maxMembers && options.maxMembers > 0 ? allMembers.slice(0, options.maxMembers) : allMembers;
  if (members.length === 0) throw new Error("No members found for collection.");
  let membersCovered = 0;
  let errorCount = 0;
  let lastError: string | null = null;

  for (const member of members) {
    try {
      const state = await store.getSyncState(member.id);
      let messageCursor = state?.messageCursor ?? null;
      let recordingCursor = state?.recordingCursor ?? null;
      // Register the batch and member before upstream requests can fail. Reuse
      // the existing ingest transaction without advancing either saved cursor.
      await store.ingestUnit({ batchId, statDate, startedAt, member, messages: [], recordings: [], messageCursor, recordingCursor, totalMembers: members.length, membersCovered, errorCount });
      let pages = 0;
      do {
        const [messagePage, recordingPage] = await Promise.all([
          source.listMessages(member, messageCursor),
          source.listRecordings(member, recordingCursor),
        ]);
        messageCursor = messagePage.nextCursor;
        recordingCursor = recordingPage.nextCursor;
        await store.ingestUnit({ batchId, statDate, startedAt, member, messages: messagePage.items, recordings: recordingPage.items, messageCursor, recordingCursor, totalMembers: members.length, membersCovered: membersCovered + 1, errorCount });
        pages += 1;
      } while ((messageCursor !== null || recordingCursor !== null) && pages < maxPages);
      membersCovered += 1;
    } catch (error) {
      errorCount += 1;
      lastError = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ event: "member_failed", memberId: member.id, error: lastError }));
    }
  }

  await store.completeBatch({ batchId, completedAt: new Date().toISOString(), membersCovered, totalMembers: members.length, errorCount, errorMessage: lastError });
  return { batchId, statDate, totalMembers: members.length, membersCovered, errorCount };
}
