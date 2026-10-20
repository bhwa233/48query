import { randomUUID } from "node:crypto";
import type { MeleePage, MeleeProgress } from "@starter/shared";
import type { Pocket48Source } from "./pocket48-source";
import { type CollectionBudget, CollectionStopped } from "./budget";

type MeleeStore = {
  meleeProgress(periodId: number): Promise<MeleeProgress | null>;
  saveMeleePage(page: MeleePage): Promise<MeleeProgress>;
};

// Reuse the collector's request limiter, total deadline and private HTTP store.
// Weekly rankings need their own durable cursor; content checkpoints track rooms.
export async function collectMelee(source: Pick<Pocket48Source, "readMeleePeriods" | "readMeleePage">, store: MeleeStore | null, budget: CollectionBudget) {
  let pages = 0;
  try {
    budget.check();
    const periods = (await source.readMeleePeriods()).slice(0, 2);
    for (const period of periods) {
      budget.check();
      const previous = await store?.meleeProgress(period.id);
      if (previous?.complete && Date.now() - Date.parse(previous.updatedAt) < 86400_000) continue;
      let state = previous && !previous.complete ? previous : { snapshotId: randomUUID(), periodId: period.id, periodLabel: period.label, observedAt: new Date().toISOString(), nextCursor: null };
      const cursors = new Set([state.nextCursor]);
      do {
        budget.check();
        const page = await source.readMeleePage(period.id, state.nextCursor);
        if (page.nextCursor !== null && cursors.has(page.nextCursor)) throw new Error("Weekly ranking pagination repeated a cursor.");
        cursors.add(page.nextCursor);
        budget.check();
        if (!store) { console.log(JSON.stringify({ event: "melee_inspected", periodId: period.id, entries: page.entries.length, pending: page.nextCursor !== null })); break; }
        state = await store.saveMeleePage({ ...state, cursor: state.nextCursor, nextCursor: page.nextCursor, entries: page.entries, limited: page.limited });
        pages += 1;
        console.log(JSON.stringify({ event: "melee_page_committed", periodId: period.id, entries: page.entries.length, complete: state.nextCursor === null, limited: page.limited }));
      } while (state.nextCursor !== null);
    }
    return { pages, errors: 0, pending: store === null };
  } catch (error) {
    if (error instanceof CollectionStopped || budget.stopped) return { pages, errors: 0, pending: true };
    console.error(JSON.stringify({ event: "melee_failed", error: error instanceof Error ? error.message : "Weekly ranking collection failed." }));
    return { pages, errors: 1, pending: true };
  }
}
