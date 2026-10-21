import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Compose the installed Skeleton/Card and the real page shells. Only these
// archive-specific arrangements are new; widths stay bounded by their columns.
export function LoadingRegion({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  return <div role={label ? "status" : undefined} aria-busy="true" className={cn("min-w-0", className)}>
    {label ? <span className="sr-only">{label}</span> : null}
    <div aria-hidden="true">{children}</div>
  </div>;
}

export function HeadingSkeleton({ action = false }: { action?: boolean }) {
  return <div className="flex min-h-7 items-center justify-between gap-3 sm:min-h-8"><Skeleton className="h-7 w-36 max-w-full sm:h-8" />{action ? <Skeleton className="hidden h-8 w-28 sm:block" /> : null}</div>;
}

export function FiltersSkeleton({ members = false }: { members?: boolean }) {
  return members ? <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_8rem] gap-2 sm:grid-cols-[minmax(0,24rem)_10rem_1fr]">
    <Skeleton className="h-11 w-full sm:h-9" /><Skeleton className="h-11 w-full sm:h-9" />
  </div> : <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-2 sm:p-3">
    <div className="flex min-w-0 flex-col gap-2 md:flex-row">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 md:flex-1"><Skeleton className="h-11 w-full sm:h-9" /><Skeleton className="h-11 w-14 sm:h-9" /></div>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 md:flex-1"><Skeleton className="h-11 w-full sm:h-9" /><Skeleton className="h-11 w-full sm:h-9" /><Skeleton className="h-11 w-20 sm:h-9" /></div>
    </div>
  </div>;
}

export function MembersTableSkeleton({ label }: { label?: string }) {
  return <LoadingRegion label={label} className="overflow-hidden rounded-lg border border-border bg-card">
    <div className="hidden grid-cols-[1fr_1fr_repeat(4,minmax(0,.5fr))] gap-3 bg-muted/40 px-3 py-2 md:grid">
      {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-4 w-16 max-w-full" />)}
    </div>
    <div className="divide-y divide-border/60">{Array.from({ length: 6 }, (_, index) => <div key={index} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-3 md:grid-cols-[1fr_1fr_repeat(4,minmax(0,.5fr))]">
      <Skeleton className="h-5 w-20 max-w-full" /><Skeleton className="h-4 w-28 max-w-full md:w-24" />
      <div className="col-span-2 flex gap-3 md:hidden">{Array.from({ length: 4 }, (_, key) => <Skeleton key={key} className="h-3 w-12 max-w-full" />)}</div>
      {Array.from({ length: 4 }, (_, key) => <Skeleton key={key} className="hidden h-4 w-10 max-w-full justify-self-end md:block" />)}
    </div>)}</div>
  </LoadingRegion>;
}

export function MessageListSkeleton({ label, images = false, rows = 4 }: { label?: string; images?: boolean; rows?: number }) {
  const widths = ["w-64", "w-40", "w-52", "w-32"];
  return <LoadingRegion label={label} className="rounded-xl border border-border bg-card p-2 sm:p-3">
    <div className="mb-2 flex items-center gap-3 border-b border-border/60 px-2 pb-2 pt-1"><Skeleton className="h-4 w-28" /><Skeleton className="h-3 w-12" /></div>
    {Array.from({ length: rows }, (_, index) => <div key={index} className="flex min-w-0 flex-col gap-0.5 px-2 py-1.5">
      <div className="flex min-h-5 min-w-0 items-center gap-2"><Skeleton className="h-3 w-9" /><Skeleton className="h-3 w-16" /><Skeleton className="h-3 w-12" /></div>
      <div className="flex min-h-[22px] min-w-0 items-center"><Skeleton className={cn("h-3 max-w-full", widths[index % widths.length])} /></div>
      {images ? <div className="mt-1 min-w-0 pb-1.5"><Skeleton className="aspect-square w-[300px] max-w-full rounded-lg" /></div> : null}
    </div>)}
  </LoadingRegion>;
}

export function MemberDetailSkeleton({ label }: { label?: string }) {
  return <div className="flex min-w-0 flex-col gap-3 sm:gap-4">
    <LoadingRegion label={label} className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="grid grid-cols-4 gap-3">{Array.from({ length: 4 }, (_, index) => <div key={index} className="flex min-w-0 flex-col gap-0.5"><Skeleton className="h-6 w-12 max-w-full sm:h-7" /><Skeleton className="h-4 w-16 max-w-full" /></div>)}</div>
    </LoadingRegion>
    <div className="flex flex-col gap-2"><Skeleton aria-hidden="true" className="h-5 w-24" /><MessageListSkeleton /></div>
  </div>;
}

export function RankingRowsSkeleton({ label, rows = 5 }: { label?: string; rows?: number }) {
  return <LoadingRegion label={label}>
    <div className="divide-y divide-border">{Array.from({ length: rows }, (_, index) => <div key={index} className="rank-columns px-3 py-2">
      <Skeleton className="h-4 w-5 max-w-full" />
      <div className="flex min-w-0 items-center gap-2"><Skeleton className="size-8 shrink-0 rounded-full" /><div className="flex min-w-0 flex-col gap-0.5"><Skeleton className="h-5 w-20 max-w-full" /><Skeleton className="h-4 w-24 max-w-full" /></div></div>
      <Skeleton className="h-4 w-10 justify-self-end" />
      {Array.from({ length: 4 }, (_, key) => <Skeleton key={key} className="hidden h-4 w-10 justify-self-end sm:block" />)}
      <div className="col-start-2 col-end-4 flex flex-wrap gap-3 sm:hidden">{Array.from({ length: 4 }, (_, key) => <Skeleton key={key} className="h-4 w-12" />)}</div>
    </div>)}</div>
  </LoadingRegion>;
}

export function ActivitySkeleton() {
  const heights = ["h-6", "h-12", "h-8", "h-20", "h-14", "h-10", "h-16"];
  return <div aria-hidden="true" className="flex h-24 items-end justify-around gap-1 overflow-hidden border-b border-border pb-1">{heights.map((height, index) => <Skeleton key={index} className={cn("min-w-0 max-w-8 flex-1 rounded-t-sm", height)} />)}</div>;
}

export function TypeBreakdownSkeleton() {
  return <div aria-hidden="true" className="flex min-h-24 flex-col gap-2">{["w-3/4", "w-1/2", "w-1/3"].map(width => <div key={width} className="flex flex-col gap-1.5"><div className="flex justify-between"><Skeleton className="h-3 w-14" /><Skeleton className="h-3 w-8" /></div><Skeleton className={cn("h-1", width)} /></div>)}</div>;
}

