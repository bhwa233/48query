"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, Search, Trophy } from "lucide-react";
import type { QueryMelee } from "@starter/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ArchiveDataRegion, archiveLabels, useArchiveQuery } from "./ArchiveData";

export function MeleeRankingDashboard({ locale, apiBaseUrl }: { locale: string; apiBaseUrl?: string }) {
  const t = archiveLabels(locale);
  const [period, setPeriod] = useState("latest");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const state = useArchiveQuery<QueryMelee>(apiBaseUrl, `/api/query/melee${period === "latest" ? "" : `?periodId=${period}`}`);
  const data = state.data?.data;
  const periods = data?.periods ?? state.previousData?.data.periods ?? [];
  const ranked = (data?.entries ?? []).filter(entry => entry.name.toLowerCase().includes(search.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(ranked.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visible = ranked.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const number = new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en");
  const time = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const columns = "grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2";

  return <section aria-labelledby="melee-ranking-title" className="min-w-0 rounded-lg border border-border">
    <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
      <h2 id="melee-ranking-title" className="flex items-center gap-2 font-medium"><Trophy className="size-4 text-brand" aria-hidden="true" />{t.meleeTitle}</h2>
      <Button variant="ghost" size="icon-sm" aria-label={t.refreshMelee} disabled={state.loading || !state.configured} onClick={state.retry}><RefreshCw className={cn(state.loading && "animate-spin")} /></Button>
    </div>
    <div className="grid grid-cols-2 gap-2 border-b bg-muted/30 p-3 sm:flex sm:items-center">
      <Select value={period} onValueChange={value => { setPeriod(value); setPage(1); }}>
        <SelectTrigger aria-label={t.meleePeriod} className="h-8 w-full min-w-0 sm:w-64"><SelectValue /></SelectTrigger>
        <SelectContent><SelectGroup><SelectItem value="latest">{t.latestMeleePeriod}</SelectItem>{periods.map(item => <SelectItem key={item.id} value={String(item.id)}>#{item.id} · {item.label}</SelectItem>)}</SelectGroup></SelectContent>
      </Select>
      <div className="relative min-w-0 sm:ml-auto sm:w-56"><Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" /><Input className="h-8 pl-8" aria-label={t.searchMeleeMembers} placeholder={t.searchMeleeMembers} value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-[11px] text-muted-foreground" aria-live="polite">
      <span>{t.meleePeriodNote}</span>
      {data?.snapshot && !state.loading ? <>
        <span>#{data.snapshot.periodId} · {data.snapshot.periodLabel} · {data.snapshot.limited ? t.meleeLimited : data.snapshot.complete ? t.meleeComplete : t.meleePartial} · {number.format(data.entries.length)} {t.membersShown}</span>
        <span>{t.followersObservedAt}: <time dateTime={data.snapshot.updatedAt}>{time.format(new Date(data.snapshot.updatedAt))}</time> ({t.beijingTime})</span>
      </> : null}
    </div>
    <div aria-hidden="true" className={cn(columns, "border-y bg-muted/30 text-xs text-muted-foreground")}><span>{t.rankPosition}</span><span>{t.memberColumn}</span><span>{t.meleeScore}</span></div>
    <ArchiveDataRegion loading={state.loading} fallback={<div aria-label={t.meleeLoading} className="divide-y">{Array.from({ length: 5 }, (_, index) => <div key={index} className={columns}><Skeleton className="h-4 w-5" /><Skeleton className="h-5 w-24 max-w-full" /><Skeleton className="h-4 w-16" /></div>)}</div>}>
      {state.failed || !state.configured ? <div className="p-5"><Alert variant={state.failed ? "destructive" : "default"}><AlertTitle>{state.failed ? t.meleeFailed : t.dataNotReady}</AlertTitle>{state.failed ? <AlertDescription><Button variant="outline" size="sm" onClick={state.retry}>{t.retry}</Button></AlertDescription> : null}</Alert></div>
        : visible.length ? <ol aria-label={t.meleeTitle} className="divide-y divide-border">{visible.map(entry => <li key={entry.memberId} className={cn(columns, "hover:bg-muted/40")}>
          <span className={cn("font-mono text-sm tabular-nums", entry.rank <= 3 ? "font-semibold text-brand" : "text-muted-foreground")} aria-label={`${t.rankPosition} ${entry.rank}`}>{String(entry.rank).padStart(2, "0")}</span>
          {entry.memberAvailable ? <Link className="truncate font-medium hover:text-brand" href={`/${locale}/members/${encodeURIComponent(entry.memberId)}`}>{entry.name}</Link> : <span className="truncate font-medium">{entry.name}</span>}
          <span className="font-mono text-sm font-semibold text-brand tabular-nums"><span className="sr-only">{t.meleeScore}: </span>{number.format(entry.score)}</span>
        </li>)}</ol> : <p role="status" className="px-3 py-10 text-center text-sm text-muted-foreground">{search ? t.empty : t.meleeEmpty}</p>}
    </ArchiveDataRegion>
    <div className="flex items-center justify-between gap-3 border-t px-3 py-2">
      <Select value={String(pageSize)} onValueChange={value => { setPageSize(Number(value)); setPage(1); }}><SelectTrigger className="h-8 w-28" aria-label={t.meleePageSize}><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{[20, 50, 100].map(size => <SelectItem key={size} value={String(size)}>{size} / {t.page}</SelectItem>)}</SelectGroup></SelectContent></Select>
      <div className="flex items-center gap-3"><span className="font-mono text-xs text-muted-foreground tabular-nums">{currentPage} {t.ofPages} {pages}</span><Button variant="outline" size="icon-sm" aria-label={t.previousMelee} disabled={currentPage === 1 || state.loading} onClick={() => setPage(currentPage - 1)}><ChevronLeft /></Button><Button variant="outline" size="icon-sm" aria-label={t.nextMelee} disabled={currentPage === pages || state.loading} onClick={() => setPage(currentPage + 1)}><ChevronRight /></Button></div>
    </div>
  </section>;
}
