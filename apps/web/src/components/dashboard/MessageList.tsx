"use client";

import Link from "next/link";
import type { ArchiveMessage } from "@starter/shared";
import { Badge } from "@/components/ui/badge";
import { ArchiveImage, archiveLabels, formatTime } from "./ArchiveData";

export function MessageList({ messages, locale, emptyText }: { messages: ArchiveMessage[]; locale: string; emptyText?: string }) {
  const t = archiveLabels(locale);
  const language = locale === "zh" ? "zh-CN" : "en";
  const dateFormatter = new Intl.DateTimeFormat(language, { timeZone: "Asia/Shanghai", dateStyle: "long" });
  const timeFormatter = new Intl.DateTimeFormat(language, { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const groups: { date: string; dateTime: string; messages: ArchiveMessage[] }[] = [];

  for (const message of messages) {
    const date = dateFormatter.format(new Date(message.occurredAt));
    const previous = groups.at(-1);
    if (previous?.date === date) previous.messages.push(message);
    else groups.push({ date, dateTime: message.occurredAt, messages: [message] });
  }

  return (
    <div className="rounded-xl border border-border bg-card p-2 sm:p-3">
      {groups.map(group => (
        <section key={group.dateTime} className="mb-3 last:mb-0">
          <h3 className="mb-2 flex items-center gap-3 border-b border-border/60 px-2 pb-2 pt-1 text-xs text-muted-foreground">
            <time dateTime={group.dateTime} className="font-medium text-foreground/80">{group.date}</time>
            <span>{t.beijingTime}</span>
          </h3>
          {group.messages.map(message => {
            const content = message.answer ?? message.text;
            const visiting = message.roomOwnerName && (message.roomOwnerId ? message.roomOwnerId !== message.memberId : message.roomOwnerName !== message.memberName);
            return (
              <article key={message.id} className="grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)] gap-x-2 rounded-md px-2 py-1.5 text-sm leading-[22px] hover:bg-muted/50 sm:grid-cols-[4rem_minmax(0,1fr)]">
                <time dateTime={message.occurredAt} title={formatTime(message.occurredAt, locale)} className="pt-px text-xs tabular-nums text-muted-foreground">
                  {timeFormatter.format(new Date(message.occurredAt))}
                </time>
                <div className="min-w-0">
                  <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                    <Link href={`/${locale}/members/${encodeURIComponent(message.memberId)}`} className="font-medium text-brand hover:underline">{message.memberName}</Link>
                    <span className="text-muted-foreground">{t.messageSeparator}</span>
                    <span>{content}</span>
                    {message.kind !== "text" && message.kind !== "image" ? <Badge variant="outline" className="ml-2 align-middle">{t[`type_${message.type}`] ?? message.type}</Badge> : null}
                    {message.source !== "room" ? <span className="ml-2 text-xs text-muted-foreground">{t[`source_${message.source}`]}</span> : null}
                    {message.sourceFlags & 4 ? <Badge variant="secondary" className="ml-2 align-middle">{t.essence}</Badge> : null}
                  </p>
                  {visiting ? <p className="text-xs text-muted-foreground">{t.room}: {message.roomOwnerName} · {t.visitor}</p> : null}
                  {message.question ? <blockquote className="mt-1 border-l-2 border-border pl-2 text-xs leading-5 text-muted-foreground"><p className="font-medium">{t.question}</p><p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.question}</p></blockquote> : null}
                  {message.kind === "excluded" || message.kind === "unknown" ? <p className="text-xs text-muted-foreground">{message.kind === "excluded" ? t.excluded : t.unsupported}</p> : null}
                </div>
                {message.images.length ? <div className="col-span-2 mt-1.5 flex min-w-0 flex-wrap gap-2 pb-1.5 sm:col-span-1 sm:col-start-2">{message.images.map(image => <ArchiveImage key={image.id} image={image} locale={locale} />)}</div> : null}
              </article>
            );
          })}
        </section>
      ))}
      {!messages.length ? <p role="status" className="p-8 text-center text-sm text-muted-foreground">{emptyText ?? t.noMessages}</p> : null}
    </div>
  );
}
