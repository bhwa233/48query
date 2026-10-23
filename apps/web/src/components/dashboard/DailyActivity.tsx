"use client";

import { useId, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarDays } from "lucide-react";
import type { ArchiveActivity } from "@starter/shared";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArchiveDataRegion, archiveLabels, QueryStatus, useArchiveQuery } from "./ArchiveData";
import { ActivitySkeleton } from "./ArchiveSkeletons";
import { archiveDate, updateArchiveUrl } from "./ArchiveUrlState";
import { cn } from "@/lib/utils";

const levels = ["bg-muted", "bg-brand/20", "bg-brand/40", "bg-brand/65", "bg-brand"];

// Reuse Select/Button and the archive query/loading helpers. There is no chart
// dependency; this bounded year calendar needs only UTC date arithmetic and CSS.
export function DailyActivity({ locale, apiBaseUrl, asOf, memberId, group, team, onDateSelect, onClearDate }: {
  locale: string; apiBaseUrl?: string; asOf: string; memberId?: string; group?: string; team?: string;
  onDateSelect?: (date: string, year: number) => void; onClearDate?: () => void;
}) {
  const t = archiveLabels(locale), search = useSearchParams(), id = useId();
  const rawYear = Number(search.get("year"));
  const requestedYear = Number.isInteger(rawYear) && rawYear >= 1970 && rawYear <= Number(asOf.slice(0, 4)) ? rawYear : undefined;
  const params = new URLSearchParams({ to: asOf });
  for (const [key, value] of Object.entries({ year: requestedYear, memberId, group: group === "all" ? undefined : group, team: team === "all" ? undefined : team })) if (value) params.set(key, String(value));
  const state = useArchiveQuery<ArchiveActivity>(apiBaseUrl, `/api/query/activity?${params}`);
  const data = state.data?.data ?? state.previousData?.data;
  const year = requestedYear ?? data?.year ?? Number(asOf.slice(0, 4));
  const [inspected, setInspected] = useState<string | null>(null);
  const selected = archiveDate(search.get("from")) === archiveDate(search.get("to")) ? archiveDate(search.get("from")) : "";
  const start = Date.UTC(year, 0, 1), length = (Date.UTC(year + 1, 0, 1) - start) / 86400_000;
  const offset = new Date(start).getUTCDay(), weeks = Math.ceil((offset + length) / 7);
  const days = new Map(data?.days.map(day => [day.date, day]));
  const peak = Math.max(1, ...(data?.days.map(day => day.messages) ?? []));
  const number = new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en");
  const month = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", { month: "short", timeZone: "UTC" });
  const weekday = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", { weekday: "narrow", timeZone: "UTC" });
  const detail = (date: string) => {
    const day = days.get(date);
    return `${date} · ${t.messageCount} ${number.format(day?.messages ?? 0)} · ${t.imageCount} ${number.format(day?.images ?? 0)} · ${t.replyCount} ${number.format(day?.replies ?? 0)}`;
  };
  const inspect = inspected?.startsWith(`${year}-`) ? inspected : selected.startsWith(`${year}-`) ? selected : null;

  return <section aria-labelledby={`${id}-title`} className="min-w-0 rounded-lg border border-border bg-card p-3">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 id={`${id}-title`} className="flex items-center gap-2 text-sm font-medium"><CalendarDays className="size-4 text-brand" aria-hidden="true" />{t.dailyActivity}</h2>
      <div className="flex items-center gap-2">
        {search.get("from") || search.get("to") ? <Button variant="ghost" size="xs" onClick={() => { setInspected(null); if (onClearDate) onClearDate(); else updateArchiveUrl({ from: null, to: null, page: null, messagePage: null, imagePage: null }); }}>{t.resetDate}</Button> : null}
        <Select value={String(year)} onValueChange={value => updateArchiveUrl({ year: value })} disabled={state.loading || !state.configured}>
          <SelectTrigger aria-label={t.activityYear} className="h-8 w-24"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>{(data?.years ?? [year]).map(value => <SelectItem key={value} value={String(value)}>{value}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
      </div>
    </div>
    <QueryStatus state={state} locale={locale} />
    <ArchiveDataRegion loading={state.loading} fallback={<ActivitySkeleton />}>
      {data ? <>
        <p className="mb-2 text-xs text-muted-foreground">{number.format(data.totals.activeDays)} {t.activeDayCount} · {number.format(data.totals.messages)} {t.messageCount} · {t.beijingTime}</p>
        <div className="overflow-x-auto pb-2" role="group" aria-label={t.activityCalendar}>
          <div className="grid w-max grid-cols-[1rem_auto] gap-x-2 gap-y-1">
            <span />
            <div className="grid h-4 text-[10px] text-muted-foreground" style={{ gridTemplateColumns: `repeat(${weeks}, 12px)`, columnGap: 3 }}>
              {Array.from({ length: 12 }, (_, index) => <span key={index} className="whitespace-nowrap" style={{ gridColumn: Math.floor((offset + (Date.UTC(year, index, 1) - start) / 86400_000) / 7) + 1 }}>{month.format(new Date(Date.UTC(year, index, 1)))}</span>)}
            </div>
            <div className="grid grid-rows-7 gap-[3px] text-center text-[10px] leading-3 text-muted-foreground">{Array.from({ length: 7 }, (_, index) => <span key={index}>{weekday.format(new Date(Date.UTC(2023, 0, 1 + index)))}</span>)}</div>
            <div className="grid grid-flow-col grid-rows-7 gap-[3px]" style={{ gridTemplateColumns: `repeat(${weeks}, 12px)`, gridTemplateRows: "repeat(7, 12px)" }}>
              {Array.from({ length: offset }, (_, index) => <span key={`blank-${index}`} aria-hidden="true" />)}
              {Array.from({ length }, (_, index) => {
                const date = new Date(start + index * 86400_000).toISOString().slice(0, 10);
                const count = days.get(date)?.messages ?? 0;
                const level = count ? Math.max(1, Math.ceil(Math.log1p(count) / Math.log1p(peak) * 4)) : 0;
                return <button key={date} id={`${id}-${index}`} type="button" data-activity-date={date} data-activity-count={count} title={detail(date)} aria-label={detail(date)} aria-pressed={selected === date} disabled={date > data.asOf}
                  className={cn("size-3 rounded-[2px] outline-none hover:ring-1 hover:ring-foreground/70 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-25", levels[level], selected === date && "ring-2 ring-foreground")}
                  onMouseEnter={() => setInspected(date)} onFocus={() => setInspected(date)} onClick={() => { setInspected(date); if (onDateSelect) onDateSelect(date, year); else updateArchiveUrl({ year, from: date, to: date, page: null, messagePage: null, imagePage: null }); }}
                  onKeyDown={event => {
                    const move: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
                    if (!(event.key in move)) return;
                    const target = document.getElementById(`${id}-${index + move[event.key]!}`);
                    if (target && !(target as HTMLButtonElement).disabled) { event.preventDefault(); target.focus({ preventScroll: true }); target.scrollIntoView({ block: "nearest", inline: "nearest" }); }
                  }} />;
              })}
            </div>
          </div>
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <p aria-live="polite" className="min-h-4">{inspect ? detail(inspect) : t.activityHint}</p>
          <div className="flex items-center gap-1" aria-label={t.activityIntensity}><span>{t.activityLess}</span>{levels.map(level => <span key={level} className={cn("size-3 rounded-[2px]", level)} aria-hidden="true" />)}<span>{t.activityMore}</span></div>
        </div>
        <p className="mt-2 text-[10px] leading-4 text-muted-foreground">{t.activityArchiveNote}</p>
      </> : null}
    </ArchiveDataRegion>
  </section>;
}
