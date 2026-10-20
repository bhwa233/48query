"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowDown, ArrowRight, CalendarDays, ChevronLeft, ChevronRight, FileText, ImageIcon, MessageCircle, RefreshCw, Search, ShieldCheck, Trophy, Users } from "lucide-react";
import type { QueryRankings } from "@starter/shared";
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
import { ActivitySkeleton, MessageListSkeleton, RankingRowsSkeleton, TypeBreakdownSkeleton } from "./ArchiveSkeletons";
import { MessageList } from "./MessageList";

type Metric = "messages" | "images" | "replies" | "activeDays";
const metrics = ["messages", "images", "replies", "activeDays"] as const;
const metricLabels = { messages: "messageRank", images: "imageRank", replies: "replyRank", activeDays: "activityRank" };
const columnLabels = { messages: "messageCount", images: "imageCount", replies: "replyCount", activeDays: "activeDayCount" };
const metricIcons = { messages: FileText, images: ImageIcon, replies: MessageCircle, activeDays: CalendarDays };

export function RankingDashboard({ locale, apiBaseUrl, yesterday }: { locale: string; apiBaseUrl?: string; yesterday: string }) {
  const t = archiveLabels(locale);
  const [period, setPeriod] = useState("yesterday");
  const [range, setRange] = useState({ from: yesterday, to: yesterday });
  const [draft, setDraft] = useState(range);
  const [rangeError, setRangeError] = useState(false);
  const [group, setGroup] = useState("all");
  const [team, setTeam] = useState("all");
  const [search, setSearch] = useState("");
  const [metric, setMetric] = useState<Metric>("messages");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const params = new URLSearchParams(range);
  if (group !== "all") params.set("group", group);
  if (team !== "all") params.set("team", team);
  const state = useArchiveQuery<QueryRankings>(apiBaseUrl, `/api/query/rankings?${params}`);
  const data = state.data?.data;
  // Retain only filter options while a new request loads; never show old totals as current data.
  const directory = data?.directory ?? state.previousData?.data.directory ?? [];
  const groups = [...new Set(directory.map(item => item.groupName))];
  const teams = [...new Set(directory.filter(item => group === "all" || item.groupName === group).flatMap(item => item.team ? [item.team] : []))];
  const number = new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en");
  const sorted = (data?.members ?? state.previousData?.data.members ?? []).filter(member => member[metric] > 0)
    .toSorted((a, b) => b[metric] - a[metric] || a.name.localeCompare(b.name, locale) || a.id.localeCompare(b.id));
  const positions = new Map<number, number>();
  const ranked = sorted.map((member, index) => {
    const rank = positions.get(member[metric]) ?? index + 1;
    positions.set(member[metric], rank);
    return { member, rank };
  }).filter(({ member }) => `${member.name} ${member.pinyin ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(ranked.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visible = ranked.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const pending = state.loading;
  const summary = [
    { key: "messages", label: t.summaryMessages, icon: FileText },
    { key: "activeMembers", label: t.summaryActive, icon: Users },
    { key: "images", label: t.summaryImages, icon: ImageIcon },
    { key: "replies", label: t.summaryReplies, icon: MessageCircle },
  ] as const;
  const calendarDays = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400_000) + 1;
  const daily = new Map(data?.dailyActivity.map(item => [item.date, item.count]));
  const peak = Math.max(1, ...daily.values());
  const days = Array.from({ length: calendarDays }, (_, index) => {
    const date = new Date(Date.parse(range.from) + index * 86400_000).toISOString().slice(0, 10);
    return { date, count: daily.get(date) };
  });
  const rangeLabel = range.from === range.to ? range.to : `${range.from} — ${range.to}`;

  function choosePeriod(value: string) {
    setPeriod(value);
    setRangeError(false);
    if (value === "custom") { setDraft(range); return; }
    const length = value === "week" ? 7 : value === "month" ? 30 : 1;
    setRange({ from: new Date(Date.parse(yesterday) - (length - 1) * 86400_000).toISOString().slice(0, 10), to: yesterday });
    setPage(1);
  }

  function resetFilters() {
    setGroup("all"); setTeam("all"); setSearch(""); setPage(1);
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <section aria-label={t.stats} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {summary.map(({ key, label, icon: Icon }) => (
          <Card key={key} className="gap-1 rounded-lg py-2.5">
            <CardHeader className="flex flex-row items-center justify-between gap-2 px-3">
              <CardDescription className="text-xs">{label}</CardDescription><Icon className="size-4 text-muted-foreground" aria-hidden="true" />
            </CardHeader>
            <CardContent className="px-3">
              <div className="font-mono text-2xl font-semibold leading-7 tracking-tight tabular-nums">
                {pending ? <Skeleton className="h-7 w-20" /> : data?.members.length ? number.format(data.totals[key]) : <span className="text-muted-foreground">—</span>}
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      <section id="rankings" aria-label={t.rankings} className="flex min-w-0 flex-col rounded-lg border border-border">
        <Tabs value={metric} onValueChange={value => { setMetric(value as Metric); setPage(1); }} className="flex-col gap-0">
          <div className="flex items-center justify-between gap-2 border-b px-2 pt-1 sm:px-3">
            <TabsList variant="line" aria-label={t.rankMetric} className="rank-tabs h-10 min-w-0 flex-1 justify-between gap-0 sm:flex-none sm:gap-1">
              {metrics.map(key => {
                const Icon = metricIcons[key];
                return <TabsTrigger value={key} key={key} className="gap-2 px-1 sm:px-4"><Icon className="rank-tab-icon hidden sm:block" aria-hidden="true" />{t[metricLabels[key]]}</TabsTrigger>;
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
            {period === "custom" ? (
              <form className="grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap" onSubmit={event => {
                event.preventDefault();
                if (!draft.from || !draft.to || draft.from > draft.to || draft.to > yesterday || Date.parse(draft.to) - Date.parse(draft.from) > 365 * 86400_000) { setRangeError(true); return; }
                setRange(draft); setPage(1); setRangeError(false);
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
              <span className="flex items-center gap-1.5"><CalendarDays className="size-3.5" aria-hidden="true" />{rangeLabel}</span>
            </div>
            <div className="rank-columns border-y bg-muted/30 px-3 py-2 text-xs text-muted-foreground" aria-hidden="true">
              <span>{t.rankPosition}</span><span>{t.memberColumn}</span>
              {metrics.map(key => <span key={key} className={cn("ranking-metric justify-self-end", key !== metric ? "hidden sm:block" : "sm:block")} data-selected={key === metric}>{t[columnLabels[key]]}{key === metric ? <ArrowDown className="ml-1 inline size-3" /> : null}</span>)}
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
                    {metrics.map(key => <span key={key} data-selected={key === metric} className={cn("ranking-metric justify-self-end font-mono text-sm tabular-nums", key !== metric ? "hidden sm:block" : "sm:block")}><span className="sr-only">{t[columnLabels[key]]}: </span>{number.format(member[key])}</span>)}
                    <div className="col-start-2 col-end-4 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground sm:hidden">{metrics.filter(key => key !== metric).map(key => <span key={key}>{t[columnLabels[key]]} <span className="font-mono tabular-nums">{number.format(member[key])}</span></span>)}</div>
                  </li>
                ))}
              </ol>
            ) : (
              <div role="status" className="flex flex-col items-center gap-3 px-5 py-12 text-center"><Trophy className="size-7 text-muted-foreground" aria-hidden="true" /><p className="font-medium">{t.rankingEmpty}</p>{group !== "all" || team !== "all" || search ? <Button variant="outline" size="sm" onClick={resetFilters}>{t.clearFilters}</Button> : null}</div>
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

      <div className="grid min-w-0 gap-3 lg:grid-cols-[1.5fr_1fr]">
        <Card className="min-w-0 gap-3 rounded-lg py-3">
          <CardHeader className="px-3"><CardTitle><h2>{t.activity}</h2></CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2 px-3">
            {pending ? <ActivitySkeleton /> : data?.dailyActivity.length ? <div role="img" aria-label={t.activityDescription} className="flex h-24 items-end justify-around gap-1 overflow-hidden border-b border-border pb-1">{days.map(({ date, count }) => <div key={date} className={cn("min-w-0 max-w-8 flex-1 rounded-t-sm", count ? "bg-brand/80" : "border-b border-dashed border-border")} style={{ height: count ? `${Math.max(2, count / peak * 100)}%` : "3px" }} title={`${date}: ${count === undefined ? t.noActivityDay : number.format(count)}`} />)}</div> : <div className="flex h-24 items-center justify-center border-b border-dashed border-border text-xs text-muted-foreground">{t.noActivity}</div>}
            <div className="flex justify-between font-mono text-[10px] text-muted-foreground"><span>{range.from}</span><span>{t.beijingTime}</span><span>{range.to}</span></div>
          </CardContent>
        </Card>
        <Card className="min-w-0 gap-3 rounded-lg py-3">
          <CardHeader className="px-3"><CardTitle><h2>{t.types}</h2></CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2 px-3">{pending ? <TypeBreakdownSkeleton /> : data?.typeBreakdown.length ? data.typeBreakdown.map(item => <div key={item.type} className="flex flex-col gap-1.5"><div className="flex justify-between gap-3 text-xs"><span>{t[`type_${item.type}`] ?? item.type}</span><span className="font-mono tabular-nums">{number.format(item.count)}</span></div><div className="h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-brand/70" style={{ width: `${item.count / data.totals.messages * 100}%` }} /></div></div>) : <p className="flex h-24 items-center justify-center text-xs text-muted-foreground">{t.noMessages}</p>}</CardContent>
        </Card>
      </div>

      <section className="flex flex-col gap-2" aria-labelledby="rank-recent-title">
        <div className="flex items-center justify-between gap-3"><h2 id="rank-recent-title" className="font-medium">{t.latestMessages}</h2><Button asChild variant="ghost" size="sm"><Link href={`/${locale}/messages`}>{t.viewAll}<ArrowRight data-icon="inline-end" /></Link></Button></div>
        <ArchiveDataRegion loading={pending} fallback={<MessageListSkeleton label={t.loading} rows={state.previousData?.data.recentMessages.length || 4} />}><MessageList messages={(data ?? state.previousData?.data)?.recentMessages ?? []} locale={locale} /></ArchiveDataRegion>
      </section>


    </div>
  );
}
