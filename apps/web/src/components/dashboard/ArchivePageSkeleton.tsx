import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ArchivePageShell, ArticlePageShell } from "./ArchivePageShell";
import { ActivitySkeleton, FiltersSkeleton, HeadingSkeleton, LoadingRegion, MemberDetailSkeleton, MembersTableSkeleton, MessageListSkeleton, RankingRowsSkeleton, TypeBreakdownSkeleton } from "./ArchiveSkeletons";

function HomeSkeleton() {
  return <ArchivePageShell>
    <HeadingSkeleton action />
    <div aria-busy="true" className="flex min-w-0 flex-col gap-3">
      <section aria-hidden="true" className="grid grid-cols-2 gap-2 sm:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Card key={index} className="gap-1 rounded-lg py-2.5"><CardHeader className="flex flex-row items-center justify-between gap-2 px-3"><Skeleton className="h-4 w-16" /><Skeleton className="size-4" /></CardHeader><CardContent className="px-3"><Skeleton className="h-7 w-20" /></CardContent></Card>)}</section>
      <section className="overflow-hidden rounded-lg border border-border">
        <div aria-hidden="true" className="flex flex-col gap-3 border-b px-3 py-2"><div className="flex h-8 justify-between gap-2">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-5 w-16 max-w-full" />)}</div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-8 w-full" />)}</div></div>
        <div aria-hidden="true" className="rank-columns border-b px-3 py-2"><Skeleton className="h-4 w-5" /><Skeleton className="h-4 w-16" /><Skeleton className="h-4 w-10 justify-self-end" />{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="hidden h-4 w-10 justify-self-end sm:block" />)}</div>
        <RankingRowsSkeleton />
        <div aria-hidden="true" className="flex justify-between border-t px-3 py-2"><Skeleton className="h-8 w-28" /><Skeleton className="h-8 w-32" /></div>
      </section>
      <div aria-hidden="true" className="grid min-w-0 gap-3 lg:grid-cols-[1.5fr_1fr]">{["activity", "types"].map(kind => <Card key={kind} className="min-w-0 gap-3 rounded-lg py-3"><CardHeader className="px-3"><Skeleton className="h-5 w-24" /></CardHeader><CardContent className="px-3">{kind === "activity" ? <ActivitySkeleton /> : <TypeBreakdownSkeleton />}</CardContent></Card>)}</div>
      <div className="flex flex-col gap-2"><Skeleton aria-hidden="true" className="h-6 w-24" /><MessageListSkeleton /></div>
    </div>
  </ArchivePageShell>;
}

export function ArchivePageSkeleton({ kind }: { kind: "home" | "members" | "member" | "messages" | "images" | "articles" | "article" }) {
  if (kind === "home") return <HomeSkeleton />;
  if (kind === "article") return <ArticlePageShell><LoadingRegion>
    <div className="mb-6 flex flex-col gap-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-8 w-72 max-w-full sm:h-9" /><Skeleton className="h-5 w-96 max-w-full" /><Skeleton className="h-4 w-24" /></div>
    <div className="flex flex-col gap-6">{[0, 1, 2].map(index => <div key={index} className="flex flex-col gap-3"><Skeleton className="h-6 w-40 max-w-full" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-3/4" /></div>)}</div>
  </LoadingRegion></ArticlePageShell>;
  return <ArchivePageShell>
    {kind === "member" ? <div aria-hidden="true" className="flex items-center gap-2"><Skeleton className="size-11 sm:size-8" /><HeadingSkeleton /></div> : <HeadingSkeleton />}
    {kind === "members" ? <><FiltersSkeleton members /><MembersTableSkeleton /></> : kind === "member" ? <MemberDetailSkeleton /> : kind === "articles" ? <LoadingRegion className="overflow-hidden rounded-lg border border-border bg-card"><div className="divide-y divide-border/60">{[0, 1, 2].map(index => <div key={index} className="flex flex-col justify-between gap-2 px-3 py-3 sm:flex-row sm:gap-4"><div className="flex min-w-0 flex-1 flex-col gap-2"><Skeleton className="h-5 w-48 max-w-full" /><Skeleton className="h-4 w-80 max-w-full" /></div><Skeleton className="h-4 w-24 shrink-0" /></div>)}</div></LoadingRegion> : <><FiltersSkeleton /><MessageListSkeleton images={kind === "images"} rows={kind === "images" ? 2 : 4} /></>}
  </ArchivePageShell>;
}
