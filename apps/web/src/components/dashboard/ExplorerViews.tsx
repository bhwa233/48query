"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useMemo, useState } from "react";
import type { ArchiveMemberDetail, ArchiveMembers, ArchiveMessages } from "@starter/shared";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArchiveFilter, ArchiveMessageFilters, emptyArchiveFilters, type ArchiveFilters } from "./ArchiveMessageFilters";
import { ArchiveDataRegion, archiveLabels, QueryStatus, useArchiveQuery } from "./ArchiveData";
import { HeadingSkeleton, MemberDetailSkeleton, MembersTableSkeleton, MessageListSkeleton } from "./ArchiveSkeletons";
import { MessageList } from "./MessageList";
import { MemberMessageHistory } from "./MemberMessageHistory";

export function MembersView({ locale, apiBaseUrl }: { locale: string; apiBaseUrl?: string }) {
  const t = archiveLabels(locale);
  const number = new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en");
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const state = useArchiveQuery<ArchiveMembers>(apiBaseUrl, "/api/query/members");
  const groups = [...new Set(state.data?.data.map(member => member.groupName) ?? [])];
  const members = useMemo(() => state.data?.data.filter(member => (!group || member.groupName === group) && `${member.name} ${member.pinyin ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [], [state.data, group, query]);
  const metrics = [
    { key: "messages", label: t.messageCount!, mobileLabel: t.messages! }, { key: "images", label: t.imageCount!, mobileLabel: t.images! },
    { key: "replies", label: t.replyCount!, mobileLabel: t.shortReplies! }, { key: "activeDays", label: t.activeDayCount!, mobileLabel: t.shortActiveDays! },
  ] as const;

  return <>
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_8rem] items-center gap-2 sm:grid-cols-[minmax(0,24rem)_10rem_1fr]">
      <Input className="h-11 sm:h-9" disabled={!state.configured} value={query} onChange={event => setQuery(event.target.value)} placeholder={t.searchMembers} aria-label={t.searchMembers} />
      <ArchiveFilter label={t.allGroups!} value={group} onChange={setGroup} options={groups.map(value => ({ value, label: value }))} />
      {state.data ? <p role="status" className="col-span-2 text-xs text-muted-foreground sm:col-span-1 sm:text-right">{number.format(members.length)} {t.membersShown}</p> : null}
    </div>
    <QueryStatus state={state} locale={locale} />
    {state.loading ? <MembersTableSkeleton label={t.loading} /> : null}
    {state.data ? <div className="overflow-hidden rounded-lg border border-border bg-card">
      <table className="w-full text-sm" aria-label={t.members}>
        <thead className="hidden bg-muted/40 text-xs text-muted-foreground md:table-header-group">
          <tr><th scope="col" className="px-3 py-2 text-left font-medium">{t.memberColumn}</th><th scope="col" className="px-3 py-2 text-left font-medium">{t.memberAffiliation}</th>{metrics.map(metric => <th key={metric.key} scope="col" className="px-3 py-2 text-right font-medium">{metric.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {members.map(member => <tr key={member.id} className="hover:bg-muted/40">
            <td className="min-w-0">
              <Link href={`/${locale}/members/${encodeURIComponent(member.id)}`} className="block px-3 py-2.5 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:py-3">
                <span className="flex items-baseline justify-between gap-2"><span className="font-medium text-brand">{member.name}</span><span className="text-xs text-muted-foreground md:hidden">{[member.groupName, member.team].filter(Boolean).join(" · ")}</span></span>
                <span className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground md:hidden">{metrics.map(metric => <span key={metric.key}><span className="font-mono tabular-nums text-foreground">{number.format(member[metric.key])}</span> {metric.mobileLabel}</span>)}</span>
              </Link>
            </td>
            <td className="hidden px-3 py-2 text-xs text-muted-foreground md:table-cell">{[member.groupName, member.team].filter(Boolean).join(" · ")}</td>
            {metrics.map(metric => <td key={metric.key} className="hidden px-3 py-2 text-right font-mono tabular-nums md:table-cell">{number.format(member[metric.key])}</td>)}
          </tr>)}
          {!members.length ? <tr><td colSpan={6}><Empty text={t.empty!} /></td></tr> : null}
        </tbody>
      </table>
    </div> : null}
  </>;
}

export function MessagesView({ locale, apiBaseUrl, initialKind = "" }: { locale: string; apiBaseUrl?: string; initialKind?: string }) {
  const t = archiveLabels(locale);
  const [filters, setFilters] = useState<ArchiveFilters>({ ...emptyArchiveFilters, kind: initialKind });
  const [cursors, setCursors] = useState<string[]>([]);
  const { query, member, kind, source, from, to } = filters;
  const params = new URLSearchParams({ limit: "30" });
  for (const [key, value] of Object.entries({ q: query, memberId: member, kind, source, from, to, before: cursors.at(-1) })) if (value) params.set(key, value);
  const state = useArchiveQuery<ArchiveMessages>(apiBaseUrl, `/api/query/messages?${params}`);
  const displayed = state.data ?? state.previousData;

  return <>
    <ArchiveMessageFilters locale={locale} apiBaseUrl={apiBaseUrl} value={filters} onChange={value => { setFilters(value); setCursors([]); }} />
    <QueryStatus state={state} locale={locale} />
    {state.loading || state.data ? <>
      <ArchiveDataRegion loading={state.loading} fallback={<MessageListSkeleton label={t.loading} images={kind === "image"} rows={state.previousData?.data.length || (kind === "image" ? 2 : 4)} />}>
        {displayed ? <MessageList messages={displayed.data} locale={locale} emptyText={t.empty} /> : null}
      </ArchiveDataRegion>
      <div className="flex items-center justify-between gap-3"><Button variant="outline" size="sm" disabled={state.loading || !cursors.length} onClick={() => setCursors(values => values.slice(0, -1))}>{t.previous}</Button><span className="text-xs text-muted-foreground">{cursors.length + 1} {t.page}</span><Button variant="outline" size="sm" disabled={state.loading || !state.data?.nextCursor} onClick={() => { if (state.data?.nextCursor) setCursors(values => [...values, state.data!.nextCursor!]); }}>{t.next}</Button></div>
    </> : null}
  </>;
}

export function MemberDetailView({ locale, id, apiBaseUrl }: { locale: string; id: string; apiBaseUrl?: string }) {
  const t = archiveLabels(locale);
  const state = useArchiveQuery<ArchiveMemberDetail>(apiBaseUrl, `/api/query/members/${encodeURIComponent(id)}`);
  const data = state.data?.data;
  return <>
    <header className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <Button asChild variant="ghost" size="icon-lg" className="sm:size-8"><Link href={`/${locale}/members`} aria-label={t.back}><ArrowLeft /></Link></Button>
      {state.loading ? <HeadingSkeleton /> : <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{data?.name ?? t.members}</h1>}
      {data ? <p className="text-xs text-muted-foreground sm:ml-1 sm:text-sm">{[data.groupName, data.team].filter(Boolean).join(" · ")}</p> : null}
    </header>
    <QueryStatus state={state} locale={locale} />
    {state.loading ? <MemberDetailSkeleton label={t.loading} /> : null}
    {data ? <>
      <section aria-labelledby="member-stats-title" className="rounded-lg border border-border bg-card px-3 py-2.5">
        <h2 id="member-stats-title" className="sr-only">{t.stats}</h2>
        <div className="grid grid-cols-4 gap-3"><Metric label={t.messages!} value={data.messages} locale={locale} /><Metric label={t.images!} value={data.images} locale={locale} /><Metric label={t.replies!} value={data.replies} locale={locale} /><Metric label={t.activeDays!} value={data.activeDays} locale={locale} /></div>
      </section>
      <section aria-labelledby="member-messages-title" className="flex min-w-0 flex-col gap-2"><h2 id="member-messages-title" className="text-sm font-medium">{t.latestMessages}</h2><MemberMessageHistory key={`${apiBaseUrl}:${id}`} memberId={id} initialMessages={data.recentMessages} totalMessages={data.messages} locale={locale} apiBaseUrl={apiBaseUrl} /></section>
    </> : null}
  </>;
}


function Metric({ label, value, locale }: { label: string; value: number; locale: string }) {
  return <dl className="flex min-w-0 flex-col-reverse gap-0.5"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="break-all font-mono text-base font-semibold leading-6 tabular-nums sm:text-lg">{new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en").format(value)}</dd></dl>;
}
function Empty({ text }: { text: string }) { return <p role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">{text}</p>; }
