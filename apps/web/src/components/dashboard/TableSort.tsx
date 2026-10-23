"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { archiveLabels } from "./ArchiveData";

export type SortDirection = "ascending" | "descending";
export type ColumnSort<Key extends string> = { key: Key; direction: SortDirection };

// Reuse the installed Button/Select primitives. There is no table/sort helper or
// data-table dependency; native comparison is sufficient for these archive rows.
export function nextColumnSort<Key extends string>(current: ColumnSort<Key>, key: Key, initial: SortDirection = "descending"): ColumnSort<Key> {
  return { key, direction: current.key === key ? current.direction === "ascending" ? "descending" : "ascending" : initial };
}

export function compareColumnValues(a: number | string | null | undefined, b: number | string | null | undefined, direction: SortDirection, locale: string) {
  // Missing snapshots always follow measured values, including in ascending order.
  if (a == null) return b == null ? 0 : 1;
  if (b == null) return -1;
  const result = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), locale, { numeric: true });
  return direction === "ascending" ? result : -result;
}

export function TableSortButton({ label, direction, initial = "descending", onClick, locale, className }: {
  label: string; direction?: SortDirection; initial?: SortDirection; onClick: () => void; locale: string; className?: string;
}) {
  const t = archiveLabels(locale);
  const next = direction ? direction === "ascending" ? "descending" : "ascending" : initial;
  const Icon = direction === "ascending" ? ArrowUp : direction === "descending" ? ArrowDown : ArrowUpDown;
  return <Button type="button" variant="ghost" size="xs" onClick={onClick} aria-label={`${label}: ${next === "ascending" ? t.sortAscending : t.sortDescending}`} aria-pressed={Boolean(direction)} data-sort-direction={direction}
    className={cn("h-8 min-w-0 max-w-full gap-0.5 px-0 text-xs [&_svg]:size-3", direction && "text-brand", className)}><span className="truncate">{label}</span><Icon aria-hidden="true" /></Button>;
}

export function TableSortControls<Key extends string>({ options, sort, onChange, locale, className }: {
  options: { key: Key; label: string; initial?: SortDirection }[]; sort: ColumnSort<Key>; onChange: (value: ColumnSort<Key>) => void; locale: string; className?: string;
}) {
  const t = archiveLabels(locale);
  return <div className={cn("flex min-w-0 items-center gap-2", className)}>
    <Select value={sort.key} onValueChange={key => { const option = options.find(item => item.key === key); if (option) onChange({ key: option.key, direction: option.initial ?? "descending" }); }}>
      <SelectTrigger aria-label={t.sortColumn} className="h-9 min-w-0 flex-1"><SelectValue /></SelectTrigger>
      <SelectContent><SelectGroup>{options.map(option => <SelectItem key={option.key} value={option.key}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
    </Select>
    <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1 text-xs" aria-label={sort.direction === "ascending" ? t.sortDescending : t.sortAscending} onClick={() => onChange(nextColumnSort(sort, sort.key))}>
      {sort.direction === "ascending" ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />}{sort.direction === "ascending" ? t.sortAscending : t.sortDescending}
    </Button>
  </div>;
}
