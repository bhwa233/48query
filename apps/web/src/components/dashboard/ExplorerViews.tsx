"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useMemo, useState } from "react";
import type { ArchiveMemberDetail, ArchiveMembers } from "@starter/shared";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArchiveFilter, ArchiveMessageFilters } from "./ArchiveMessageFilters";
import { archiveLabels, QueryStatus, useArchiveQuery } from "./ArchiveData";
import { HeadingSkeleton, MemberDetailSkeleton, MembersTableSkeleton } from "./ArchiveSkeletons";
import { PagedMessages } from "./PagedMessages";
import { useArchiveFilters } from "./ArchiveUrlState";
import { MemberContentTabs } from "./MemberContentTabs";
import { compareColumnValues, nextColumnSort, TableSortButton, TableSortControls, type ColumnSort } from "./TableSort";

type MemberSortKey = "name" | "affiliation" | "messages" | "images" | "replies" | "activeDays";

export function MembersView({ locale, apiBaseUrl }: { locale: string; apiBaseUrl?: string }) {
  const t = archiveLabels(locale);
  const number = new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en");
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [sort, setSort] = useState<ColumnSort<MemberSortKey>>({ key: "messages", direction: "descending" });
  const state = useArchiveQuery<ArchiveMembers>(apiBaseUrl, "/api/query/members");
  const groups = [...new Set(state.data?.data.map(member => member.groupName) ?? [])];
  const members = useMemo(() => state.data?.data.filter(member => (!group || member.groupName === group) && `${member.name} ${member.pinyin ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()))
    .toSorted((a, b) => compareColumnValues(sort.key === "affiliation" ? `${a.groupName} ${a.team ?? ""}` : a[sort.key], sort.key === "affiliation" ? `${b.groupName} ${b.team ?? ""}` : b[sort.key], sort.direction, locale) || a.name.localeCompare(b.name, locale) || a.id.localeCompare(b.id)) ?? [], [state.data, group, query, sort, locale]);
  const metrics = [
    { key: "messages", label: t.messageCount!, mobileLabel: t.messages! }, { key: "images", label: t.imageCount!, mobileLabel: t.images! },
    { key: "replies", label: t.replyCount!, mobileLabel: t.shortReplies! }, { key: "activeDays", label: t.activeDayCount!, mobileLabel: t.shortActiveDays! },
  ] as const;
  const sortOptions: { key: MemberSortKey; label: string; initial?: "ascending" }[] = [{ key: "name", label: t.memberColumn!, initial: "ascending" }, { key: "affiliation", label: t.memberAffiliation!, initial: "ascending" }, ...metrics.map(metric => ({ key: metric.key, label: metric.label }))];
  function chooseSort(key: MemberSortKey) {
    setSort(value => nextColumnSort(value, key, key === "name" || key === "affiliation" ? "ascending" : "descending"));
  }

  return <>
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_8rem] items-center gap-2 sm:grid-cols-[minmax(0,24rem)_10rem_1fr]">
      <Input className="h-11 sm:h-9" disabled={!state.configured} value={query} onChange={event => setQuery(event.target.value)} placeholder={t.searchMembers} aria-label={t.searchMembers} />
      <ArchiveFilter label={t.allGroups!} value={group} onChange={setGroup} options={groups.map(value => ({ value, label: value }))} />
      {state.data ? <p role="status" className="col-span-2 text-xs text-muted-foreground sm:col-span-1 sm:text-right">{number.format(members.length)} {t.membersShown}</p> : null}
    </div>
    <QueryStatus state={state} locale={locale} />
    {state.loading ? <MembersTableSkeleton label={t.loading} /> : null}
    {state.data ? <div className="overflow-hidden rounded-lg border border-border bg-card">
      <TableSortControls options={sortOptions} sort={sort} onChange={setSort} locale={locale} className="border-b p-2 md:hidden" />
      <table className="w-full text-sm" aria-label={t.members}>
        <thead className="hidden bg-muted/40 text-xs text-muted-foreground md:table-header-group">
          <tr>{sortOptions.map(column => <th key={column.key} scope="col" aria-sort={sort.key === column.key ? sort.direction : "none"} className={column.key === "name" || column.key === "affiliation" ? "px-3 py-1 text-left font-medium" : "px-3 py-1 text-right font-medium"}>
            <TableSortButton label={column.label} direction={sort.key === column.key ? sort.direction : undefined} initial={column.initial} onClick={() => chooseSort(column.key)} locale={locale} />
          </th>)}</tr>
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
  const { filters, setFilters } = useArchiveFilters(undefined, initialKind);
  return <>
    <ArchiveMessageFilters locale={locale} apiBaseUrl={apiBaseUrl} value={filters} onChange={setFilters} />
    <PagedMessages locale={locale} apiBaseUrl={apiBaseUrl} />
  </>;
}

export function MemberDetailView({ locale, id, apiBaseUrl, asOf }: { locale: string; id: string; apiBaseUrl?: string; asOf: string }) {
  const t = archiveLabels(locale);
  const state = useArchiveQuery<ArchiveMemberDetail>(apiBaseUrl, `/api/query/members/${encodeURIComponent(id)}?date=${asOf}`);
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
      <MemberContentTabs key={`${apiBaseUrl}:${id}:${asOf}`} member={data} locale={locale} apiBaseUrl={apiBaseUrl} asOf={asOf} />
    </> : null}
  </>;
}


function Metric({ label, value, locale }: { label: string; value: number; locale: string }) {
  return <dl className="flex min-w-0 flex-col-reverse gap-0.5"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="break-all font-mono text-base font-semibold leading-6 tabular-nums sm:text-lg">{new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en").format(value)}</dd></dl>;
}
function Empty({ text }: { text: string }) { return <p role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">{text}</p>; }
