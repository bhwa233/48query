"use client";

import { useState } from "react";
import type { ArchiveMessage, ArchiveMessages } from "@starter/shared";
import { Button } from "@/components/ui/button";
import { archiveLabels, useArchiveQuery } from "./ArchiveData";
import { MessageList } from "./MessageList";

export function MemberMessageHistory({ memberId, initialMessages, totalMessages, locale, apiBaseUrl, to }: {
  memberId: string;
  initialMessages: ArchiveMessage[];
  totalMessages: number;
  locale: string;
  apiBaseUrl?: string;
  to?: string;
}) {
  const t = archiveLabels(locale);
  const [history, setHistory] = useState(() => {
    const last = initialMessages.at(-1);
    return {
      messages: initialMessages,
      nextCursor: totalMessages > initialMessages.length && last ? JSON.stringify({ at: last.occurredAt, id: last.id }) : null,
    };
  });
  const [requestedCursor, setRequestedCursor] = useState<string | null>(null);
  const params = new URLSearchParams({ memberId, limit: "20" });
  if (to) params.set("to", to);
  if (requestedCursor) params.set("before", requestedCursor);
  // Reuse the archive hook's cancellation and retry; only accumulate member history here.
  const page = useArchiveQuery<ArchiveMessages>(requestedCursor ? apiBaseUrl : undefined, `/api/query/messages?${params}`);

  let messages = history.messages;
  if (page.data) {
    const ids = new Set(history.messages.map(message => message.id));
    messages = [...history.messages, ...page.data.data.filter(message => {
      if (ids.has(message.id)) return false;
      ids.add(message.id);
      return true;
    })];
  }
  const nextCursor = page.data ? page.data.nextCursor : history.nextCursor;
  const pending = page.loading;
  return (
    <div className="space-y-3" aria-busy={pending}>
      <MessageList messages={messages} locale={locale} />
      <div className="flex flex-col items-center gap-2">
        <p role="status" className="text-center text-xs text-muted-foreground">
          {page.failed ? t.failure : pending ? t.loading : messages.length && !nextCursor ? t.noMoreMessages : null}
        </p>
        {nextCursor ? <Button type="button" variant="outline" disabled={pending} onClick={() => {
          if (page.failed) page.retry();
          else {
            setHistory({ messages, nextCursor });
            setRequestedCursor(nextCursor);
          }
        }}>{pending ? t.loading : page.failed ? t.retry : t.loadMoreMessages}</Button> : null}
      </div>
    </div>
  );
}
