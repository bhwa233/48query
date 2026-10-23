"use client";

import { useEffect } from "react";
import type { ArchiveMessagePage } from "@starter/shared";
import { ArchiveDataRegion, archiveLabels, QueryStatus, useArchiveQuery } from "./ArchiveData";
import { MessageListSkeleton } from "./ArchiveSkeletons";
import { MessageList } from "./MessageList";
import { ArchivePagination } from "./ArchivePagination";
import { contentQuery, updateArchiveUrl, useArchiveFilters, useArchivePage } from "./ArchiveUrlState";

export function PagedMessages({ locale, apiBaseUrl, memberId, to }: { locale: string; apiBaseUrl?: string; memberId?: string; to?: string }) {
  const t = archiveLabels(locale);
  const { filters } = useArchiveFilters(memberId);
  const control = useArchivePage(false, Boolean(memberId));
  const params = contentQuery(filters, { memberId, to });
  params.set("page", String(control.page)); params.set("pageSize", String(control.pageSize));
  const state = useArchiveQuery<ArchiveMessagePage>(apiBaseUrl, `/api/query/message-pages?${params}`);
  const result = state.data ?? state.previousData;
  useEffect(() => {
    if (state.data && state.data.pagination.page !== control.page) updateArchiveUrl({ [control.pageKey]: state.data.pagination.page }, true);
  }, [state.data, control.page, control.pageKey]);
  return <div data-archive-page className="flex min-w-0 scroll-mt-14 flex-col gap-3">
    <QueryStatus state={state} locale={locale} />
    {state.failed && result ? <p className="text-xs text-muted-foreground">{t.previousPageShown}</p> : null}
    {state.configured ? <ArchiveDataRegion loading={state.loading} fallback={<MessageListSkeleton label={t.loading} rows={Math.min(control.pageSize, result?.data.length || 4)} />}>
      {result ? <MessageList messages={result.data} locale={locale} emptyText={t.empty} /> : null}
    </ArchiveDataRegion> : null}
    {result ? <ArchivePagination pagination={result.pagination} {...control} locale={locale} disabled={state.loading || state.failed} /> : null}
  </div>;
}
