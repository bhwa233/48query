"use client";

import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, FileText, ImageIcon, MessageCircle, RefreshCw, Search, ShieldCheck, Trophy, Users } from "lucide-react";
import type { ArchiveContentTotals, QueryRankings } from "@starter/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { ArchiveDataRegion, archiveLabels, useArchiveQuery } from "./ArchiveData";
import { RankingRowsSkeleton, TypeBreakdownSkeleton } from "./ArchiveSkeletons";
import { DailyActivity } from "./DailyActivity";
import { archiveDate, updateArchiveUrl } from "./ArchiveUrlState";
import { MeleeRankingDashboard } from "./MeleeRankingDashboard";
import { compareColumnValues, nextColumnSort, TableSortButton, TableSortControls, type ColumnSort } from "./TableSort";

const metrics = ["followers", "messages", "images", "replies", "activeDays"] as const;
type Metric = typeof metrics[number];
type SortKey = Metric | "rank" | "name";
const metricLabels = { followers: "followerRank", messages: "messageRank", images: "imageRank", replies: "replyRank", activeDays: "activityRank" };
const columnLabels = { followers: "followerCount", messages: "messageCount", images: "imageCount", replies: "replyCount", activeDays: "activeDayCount" };
const metricIcons = { followers: Users, messages: FileText, images: ImageIcon, replies: MessageCircle, activeDays: CalendarDays };

export function RankingDashboard({ locale, apiBaseUrl, yesterday }: { locale: string; apiBaseUrl?: string; yesterday: string }) {
  const t = archiveLabels(locale);
  const searchParams = useSearchParams();
  const from = archiveDate(searchParams.get("from")), to = archiveDate(searchParams.get("to"));
  const validRange = from && to && from <= to && to <= yesterday && Date.parse(to) - Date.parse(from) <= 365 * 86400_000;
  const range = validRange ? { from, to } : { from: yesterday, to: yesterday };
  const heatmapDate = archiveDate(searchParams.get("heatmapDate"));
  const selectedDate = validRange && heatmapDate === from && from === to ? heatmapDate : "";
  const selectedPeriod = searchParams.get("period") ?? (validRange ? "custom" : "yesterday");
  const period = ["yesterday", "week", "month", "custom"].includes(selectedPeriod) ? selectedPeriod : "yesterday";
  const [draft, setDraft] = useState(range);
  const [draftRange, setDraftRange] = useState(`${range.from}:${range.to}`);
  if (draftRange !== `${range.from}:${range.to}`) { setDraftRange(`${range.from}:${range.to}`); setDraft(range); }
  const [rangeError, setRangeError] = useState(false);
  const [group, setGroup] = useState("all");
  const [team, setTeam] = useState("all");
  const [search, setSearch] = useState("");
  const [metric, setMetric] = useState<Metric>("messages");
  const [sort, setSort] = useState<ColumnSort<SortKey>>({ key: "messages", direction: "descending" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const params = new URLSearchParams(range);
  if (group !== "all") params.set("group", group);
  if (team !== "all") params.set("team", team);
  const state = useArchiveQuery<QueryRankings>(apiBaseUrl, `/api/query/rankings?${params}`);
  const overviewParams = new URLSearchParams(selectedDate ? { from: selectedDate, to: selectedDate } : { to: yesterday });
  const overview = useArchiveQuery<ArchiveContentTotals>(apiBaseUrl, `/api/query/content-summary?${overviewParams}`);
  const data = state.data?.data;
  // Retain only filter options while a new request loads; never show old totals as current data.
  const directory = data?.directory ?? state.previousData?.data.directory ?? [];
  const groups = [...new Set(directory.map(item => item.groupName))];
  const teams = [...new Set(directory.filter(item => group === "all" || item.groupName === group).flatMap(item => item.team ? [item.team] : []))];
  const number = new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en");
  const sorted = (data?.members ?? state.previousData?.data.members ?? []).filter(member => metric === "followers" ? member.followers != null : member[metric] > 0)
    .toSorted((a, b) => (b[metric] ?? 0) - (a[metric] ?? 0) || a.name.localeCompare(b.name, locale) || a.id.localeCompare(b.id));
  const positions = new Map<number, number>();
  const ranked = sorted.map((member, index) => {
    const value = member[metric] ?? 0;
    const rank = positions.get(value) ?? index + 1;
    positions.set(value, rank);
    return { member, rank };
  }).filter(({ member }) => `${member.name} ${member.pinyin ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()))
    .toSorted((a, b) => compareColumnValues(sort.key === "rank" ? a.rank : a.member[sort.key], sort.key === "rank" ? b.rank : b.member[sort.key], sort.direction, locale) || a.rank - b.rank || a.member.id.localeCompare(b.member.id));
  const sortOptions = [{ key: "rank", label: t.rankPosition!, initial: "ascending" }, { key: "name", label: t.memberColumn!, initial: "ascending" }, ...metrics.map(key => ({ key, label: t[columnLabels[key]]! }))] satisfies { key: SortKey; label: string; initial?: "ascending" }[];
  function chooseSort(key: SortKey) {
    setSort(value => nextColumnSort(value, key, key === "rank" || key === "name" ? "ascending" : "descending"));
    setPage(1);
  }
  const pages = Math.max(1, Math.ceil(ranked.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visible = ranked.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const pending = state.loading;
  const summary = [
    { key: "messages", label: t.summaryMessages, icon: FileText },
    { key: "members", label: t.summaryActive, icon: Users },
    { key: "images", label: t.summaryImages, icon: ImageIcon },
    { key: "replies", label: t.summaryReplies, icon: MessageCircle },
  ] as const;
  const rangeLabel = range.from === range.to ? range.to : `${range.from} — ${range.to}`;
  const observationTime = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const followerCoverage = data?.followersCoverage;

  function choosePeriod(value: string) {
    setRangeError(false);
    if (value === "custom") { setDraft(range); updateArchiveUrl({ period: value, heatmapDate: null }); return; }
    const length = value === "week" ? 7 : value === "month" ? 30 : 1;
    updateArchiveUrl({ period: value, from: new Date(Date.parse(yesterday) - (length - 1) * 86400_000).toISOString().slice(0, 10), to: yesterday, heatmapDate: null });
    setPage(1);
  }

  function resetFilters() {
    setGroup("all"); setTeam("all"); setSearch(""); setPage(1);
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <section aria-label={selectedDate ? t.dailyOverview : t.cumulativeOverview}>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="text-sm font-semibold">{selectedDate ? t.dailyOverview : t.cumulativeOverview}</h2>
          <p className="text-xs text-muted-foreground">{selectedDate ? selectedDate : `${t.cumulativeThrough} ${yesterday}`} ({t.beijingTime}) · {t.cumulativeCoverage}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {summary.map(({ key, label, icon: Icon }) => (
          <Card key={key} className="gap-1 rounded-lg py-2.5">
            <CardHeader className="flex flex-row items-center justify-between gap-2 px-3">
              <CardDescription className="text-xs">{label}</CardDescription><Icon className="size-4 text-muted-foreground" aria-hidden="true" />
            </CardHeader>
            <CardContent className="px-3">
              <div className="font-mono text-2xl font-semibold leading-7 tracking-tight tabular-nums">
                {overview.loading ? <Skeleton className="h-7 w-20" /> : overview.data ? number.format(overview.data.data[key]) : <span className="text-muted-foreground">—</span>}
              </div>
            </CardContent>
          </Card>
        ))}
        </div>
        {overview.failed ? <p role="alert" className="mt-2 text-xs text-destructive">{t.failure} <button type="button" className="underline" onClick={overview.retry}>{t.retry}</button></p> : null}
      </section>

      <DailyActivity locale={locale} apiBaseUrl={apiBaseUrl} asOf={yesterday} group={group} team={team} onDateSelect={(date, year) => { updateArchiveUrl({ year, from: date, to: date, period: "custom", heatmapDate: date }); setPage(1); setRangeError(false); }} onClearDate={() => { updateArchiveUrl({ from: null, to: null, period: null, heatmapDate: null }); setPage(1); setRangeError(false); }} />

      <section id="rankings" aria-label={t.rankings} className="flex min-w-0 flex-col rounded-lg border border-border">
        <Tabs value={metric} onValueChange={value => { setMetric(value as Metric); setSort({ key: value as Metric, direction: "descending" }); setPage(1); }} className="flex-col gap-0">
          <div className="flex items-center justify-between gap-2 border-b px-2 pt-1 sm:px-3">
            <TabsList variant="line" aria-label={t.rankMetric} className="rank-tabs h-10 w-0 min-w-0 flex-1 justify-between gap-0 sm:w-auto sm:flex-none sm:gap-1">
              {metrics.map(key => {
                const Icon = metricIcons[key];
                return <TabsTrigger value={key} key={key} className="min-w-0 gap-1 px-0 text-xs sm:gap-2 sm:px-4 sm:text-sm"><Icon className="rank-tab-icon hidden sm:block" aria-hidden="true" />{t[metricLabels[key]]}</TabsTrigger>;
              })}
            </TabsList>
            <Button variant="ghost" size="icon-sm" aria-label={t.refreshRanking} disabled={pending || !state.configured} onClick={state.retry}>
              <RefreshCw className={cn(pending && "animate-spin")} aria-hidden="true" />
            </Button>
          </div>

          <div className="flex flex-col gap-2 border-b bg-muted/30 p-3">
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
              <Select value={period} onValueChange={choosePeriod}>
                <SelectTrigger aria-label={t.range} className="h-8 w-full sm:w-36"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>
                  <SelectItem value="yesterday">{t.yesterday}</SelectItem><SelectItem value="week">{t.last7Days}</SelectItem>
                  <SelectItem value="month">{t.last30Days}</SelectItem><SelectItem value="custom">{t.customRange}</SelectItem>
                </SelectGroup></SelectContent>
              </Select>
              <Select value={group} onValueChange={value => { setGroup(value); setTeam("all"); setPage(1); }}>
                <SelectTrigger aria-label={t.allGroups} className="h-8 w-full sm:w-36"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup><SelectItem value="all">{t.allGroups}</SelectItem>{groups.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
              <Select value={team} onValueChange={value => { setTeam(value); setPage(1); }}>
                <SelectTrigger aria-label={t.allTeams} className="h-8 w-full sm:w-36"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup><SelectItem value="all">{t.allTeams}</SelectItem>{teams.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
              <div className="relative min-w-0 sm:ml-auto sm:w-56">
                <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" aria-hidden="true" />
                <Input className="h-8 pl-8" aria-label={t.searchMembers} placeholder={t.searchMembers} value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} />
              </div>
            </div>
            <TableSortControls options={sortOptions} sort={sort} onChange={value => { setSort(value); setPage(1); }} locale={locale} className="sm:hidden" />
            {period === "custom" ? (
              <form className="grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap" onSubmit={event => {
                event.preventDefault();
                if (!draft.from || !draft.to || draft.from > draft.to || draft.to > yesterday || Date.parse(draft.to) - Date.parse(draft.from) > 365 * 86400_000) { setRangeError(true); return; }
                updateArchiveUrl({ ...draft, period: "custom", heatmapDate: null }); setPage(1); setRangeError(false);
              }}>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-44"><Label htmlFor="rank-from">{t.from}</Label><Input required id="rank-from" type="date" className="rank-date h-8" max={draft.to || yesterday} value={draft.from} onChange={event => setDraft(value => ({ ...value, from: event.target.value }))} aria-invalid={rangeError} aria-describedby={rangeError ? "rank-range-help" : undefined} /></div>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-44"><Label htmlFor="rank-to">{t.to}</Label><Input required id="rank-to" type="date" className="rank-date h-8" min={draft.from} max={yesterday} value={draft.to} onChange={event => setDraft(value => ({ ...value, to: event.target.value }))} aria-invalid={rangeError} aria-describedby={rangeError ? "rank-range-help" : undefined} /></div>
                <Button type="submit" variant="secondary" size="sm" className="w-fit">{t.applyRange}</Button>
                {rangeError ? <p id="rank-range-help" role="alert" className="col-span-2 w-full text-xs text-destructive">{t.invalidRange}</p> : null}
              </form>
            ) : null}
          </div>

          <TabsContent value={metric} className="m-0">
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground">
              <span aria-live="polite">{pending ? t.rankingLoading : `${number.format(ranked.length)} ${t.rankedMembers}`}</span>
              <span className="flex items-center gap-1.5"><CalendarDays className="size-3.5" aria-hidden="true" />{metric === "followers" ? t.latestFollowerSnapshot : rangeLabel}</span>
            </div>
            <p className="px-3 pb-2 text-[11px] leading-relaxed text-muted-foreground">
              {t.followerSnapshotNote}{!pending && followerCoverage ? ` ${t.followersCovered}: ${number.format(followerCoverage.membersCovered)}` : ""}
              {!pending && followerCoverage?.latestObservedAt ? <> · {t.followersObservedAt}: <time dateTime={followerCoverage.latestObservedAt}>{followerCoverage.earliestObservedAt !== followerCoverage.latestObservedAt && followerCoverage.earliestObservedAt ? `${observationTime.format(new Date(followerCoverage.earliestObservedAt))} — ` : ""}{observationTime.format(new Date(followerCoverage.latestObservedAt))}</time> ({t.beijingTime})</> : null}
            </p>
            <div className="rank-columns border-y bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
              <TableSortButton label={t.rankPosition!} direction={sort.key === "rank" ? sort.direction : undefined} initial="ascending" onClick={() => chooseSort("rank")} locale={locale} className="justify-self-start" />
              <TableSortButton label={t.memberColumn!} direction={sort.key === "name" ? sort.direction : undefined} initial="ascending" onClick={() => chooseSort("name")} locale={locale} className="justify-self-start" />
              {metrics.map(key => <TableSortButton key={key} label={t[columnLabels[key]]!} direction={sort.key === key ? sort.direction : undefined} onClick={() => chooseSort(key)} locale={locale} className={cn("justify-self-end", key !== metric && "hidden sm:inline-flex")} />)}
            </div>
            <ArchiveDataRegion loading={pending} fallback={<RankingRowsSkeleton label={t.rankingLoading} rows={state.previousData ? Math.max(1, visible.length) : 5} />}>
            {state.failed || !state.configured ? (
              <div className="p-5 sm:p-8"><Alert variant={state.failed ? "destructive" : "default"}><ShieldCheck aria-hidden="true" /><AlertTitle>{state.failed ? t.rankingFailed : t.dataNotReady}</AlertTitle>{state.failed ? <AlertDescription>{t.failure}<Button variant="outline" size="sm" className="mt-3" onClick={state.retry}>{t.retry}</Button></AlertDescription> : null}</Alert></div>
            ) : visible.length ? (
              <ol aria-label={t.rankings} className="divide-y divide-border">
                {visible.map(({ member, rank: position }) => (
                  <li key={member.id} className="rank-columns group px-3 py-2 transition-colors hover:bg-muted/40">
                    <span className={cn("font-mono text-sm tabular-nums", position <= 3 ? "font-semibold text-brand" : "text-muted-foreground")} aria-label={`${t.rankPosition} ${position}`}>{String(position).padStart(2, "0")}</span>
                    <Link href={`/${locale}/members/${encodeURIComponent(member.id)}`} className="flex min-w-0 items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted/50 text-sm font-medium">{member.name.slice(-1)}</span>
                      <span className="flex min-w-0 flex-col gap-0.5"><span className="truncate font-medium group-hover:text-brand">{member.name}</span><span className="truncate text-[11px] text-muted-foreground">{member.groupName}{member.team ? ` · ${member.team}` : ""}</span></span>
                    </Link>
                    {metrics.map(key => <span key={key} data-selected={key === metric} title={key === "followers" && member.followersObservedAt ? `${t.followersObservedAt}: ${observationTime.format(new Date(member.followersObservedAt))} (${t.beijingTime})` : undefined} className={cn("ranking-metric justify-self-end font-mono text-sm tabular-nums", key !== metric ? "hidden sm:block" : "sm:block")}><span className="sr-only">{t[columnLabels[key]]}: </span>{member[key] == null ? <span className="text-muted-foreground" aria-label={t.followersUnknown}>—</span> : number.format(member[key])}</span>)}
                    <div className="col-start-2 col-end-4 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground sm:hidden">{metrics.filter(key => key !== metric).map(key => <span key={key}>{t[columnLabels[key]]} <span className="font-mono tabular-nums">{member[key] == null ? <span aria-label={t.followersUnknown}>—</span> : number.format(member[key])}</span></span>)}</div>
                  </li>
                ))}
              </ol>
            ) : (
              <div role="status" className="flex flex-col items-center gap-3 px-5 py-12 text-center"><Trophy className="size-7 text-muted-foreground" aria-hidden="true" /><p className="font-medium">{metric === "followers" && group === "all" && team === "all" && !search ? t.followersEmpty : t.rankingEmpty}</p>{group !== "all" || team !== "all" || search ? <Button variant="outline" size="sm" onClick={resetFilters}>{t.clearFilters}</Button> : null}</div>
            )}
            </ArchiveDataRegion>
            <div className="flex items-center justify-between gap-3 border-t px-3 py-2">
              <Select value={String(pageSize)} onValueChange={value => { setPageSize(Number(value)); setPage(1); }}>
                <SelectTrigger className="h-8 w-28" aria-label={t.perPage}><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{[20, 50, 100].map(size => <SelectItem key={size} value={String(size)}>{size} / {t.page}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
              <div className="flex items-center gap-3"><span className="font-mono text-xs tabular-nums text-muted-foreground">{currentPage} {t.ofPages} {pages}</span><Button variant="outline" size="icon-sm" aria-label={t.previous} disabled={currentPage === 1 || pending} onClick={() => setPage(currentPage - 1)}><ChevronLeft /></Button><Button variant="outline" size="icon-sm" aria-label={t.next} disabled={currentPage === pages || pending} onClick={() => setPage(currentPage + 1)}><ChevronRight /></Button></div>
            </div>
          </TabsContent>
        </Tabs>
      </section>

      <MeleeRankingDashboard locale={locale} apiBaseUrl={apiBaseUrl} />

        <Card className="min-w-0 gap-3 rounded-lg py-3">
          <CardHeader className="px-3"><CardTitle><h2>{t.types}</h2></CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2 px-3">{pending ? <TypeBreakdownSkeleton /> : data?.typeBreakdown.length ? data.typeBreakdown.map(item => <div key={item.type} className="flex flex-col gap-1.5"><div className="flex justify-between gap-3 text-xs"><span>{t[`type_${item.type}`] ?? item.type}</span><span className="font-mono tabular-nums">{number.format(item.count)}</span></div><div className="h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-brand/70" style={{ width: `${item.count / data.totals.messages * 100}%` }} /></div></div>) : <p className="flex h-24 items-center justify-center text-xs text-muted-foreground">{t.noMessages}</p>}</CardContent>
        </Card>

    </div>
  );
}
