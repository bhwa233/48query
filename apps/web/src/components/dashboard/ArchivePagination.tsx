"use client";

import { useLayoutEffect, useRef } from "react";
import type { ArchivePagination as Pagination } from "@starter/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { archiveLabels } from "./ArchiveData";
import { updateArchiveUrl } from "./ArchiveUrlState";

// Compose installed controls; page links retain real hrefs for copy/open-in-tab.
export function ArchivePagination({ pagination, pageKey, sizeKey, sizes, locale, disabled, onNavigate }: {
  pagination: Pagination; pageKey: string; sizeKey: string; sizes: number[]; locale: string; disabled?: boolean; onNavigate?: () => void;
}) {
  const t = archiveLabels(locale), { page, pageSize, total, totalPages } = pagination;
  const number = new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en");
  const target = useRef<HTMLDivElement>(null);
  const previous = useRef(pagination);
  useLayoutEffect(() => {
    const old = previous.current;
    previous.current = pagination;
    if (!disabled && (old.page !== page || old.pageSize !== pageSize)) {
      // The list wrapper supplies the top anchor so long image pages do not
      // leave the visitor at the bottom of a newly selected page.
      target.current?.closest("[data-archive-page]")?.scrollIntoView({ block: "start", behavior: "instant" });
    }
  }, [pagination, disabled, page, pageSize]);
  const href = (value: number) => {
    const search = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
    if (value === 1) search.delete(pageKey); else search.set(pageKey, String(value));
    return `?${search}`;
  };
  const navigate = (value: number) => { onNavigate?.(); updateArchiveUrl({ [pageKey]: value === 1 ? null : value }); };
  const pages = [...new Set([1, ...Array.from({ length: 5 }, (_, i) => page + i - 2).filter(value => value > 0 && value <= totalPages), totalPages])].toSorted((a, b) => a - b);
  return <div ref={target} className="flex min-w-0 flex-col gap-2 border-t pt-3" aria-label={t.pagination}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p role="status" className="text-xs text-muted-foreground">{t.totalResults} {number.format(total)} · {page} / {totalPages}</p>
      <Select value={String(pageSize)} onValueChange={value => { onNavigate?.(); updateArchiveUrl({ [pageKey]: null, [sizeKey]: Number(value) }); }} disabled={disabled}>
        <SelectTrigger aria-label={t.perPage} className="h-9 w-28"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{sizes.map(size => <SelectItem key={size} value={String(size)}>{size} / {t.page}</SelectItem>)}</SelectGroup></SelectContent>
      </Select>
    </div>
    <nav aria-label={t.pagination} className="flex flex-wrap items-center justify-between gap-2">
      <Button type="button" variant="outline" size="sm" disabled={disabled || page === 1} onClick={() => navigate(page - 1)}>{t.previous}</Button>
      <div className="hidden items-center gap-1 sm:flex">{pages.map((value, index) => <span key={value} className="inline-flex items-center gap-1">{index > 0 && value > pages[index - 1]! + 1 ? <span className="px-1 text-muted-foreground">…</span> : null}<Button asChild variant={value === page ? "secondary" : "ghost"} size="icon-sm"><a href={href(value)} aria-current={value === page ? "page" : undefined} aria-label={`${t.page} ${value}`} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined} onClick={event => {
        if (disabled) { event.preventDefault(); return; }
        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); navigate(value);
      }}>{value}</a></Button></span>)}</div>
      <form key={`${page}:${pageSize}`} className="flex items-center gap-1" onSubmit={event => { event.preventDefault(); const value = Number(new FormData(event.currentTarget).get("page")); if (Number.isInteger(value) && value >= 1 && value <= totalPages) navigate(value); }}>
        <Input type="number" name="page" aria-label={t.jumpPage} min={1} max={totalPages} defaultValue={page} required disabled={disabled} className="h-9 w-16 px-2 text-center" /><Button type="submit" variant="ghost" size="sm" disabled={disabled}>{t.goPage}</Button>
      </form>
      <Button type="button" variant="outline" size="sm" disabled={disabled || page === totalPages} onClick={() => navigate(page + 1)}>{t.next}</Button>
    </nav>
  </div>;
}
