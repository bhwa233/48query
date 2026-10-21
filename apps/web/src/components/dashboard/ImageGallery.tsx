"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import type { ArchiveMessage, ArchiveMessages, ImageAttachment } from "@starter/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { archiveLabels, formatTime, QueryStatus, useArchiveQuery } from "./ArchiveData";
import { ArchiveMessageFilters, emptyArchiveFilters, type ArchiveFilters } from "./ArchiveMessageFilters";
import { ImageGallerySkeleton } from "./ArchiveSkeletons";
import { displayMessageText } from "./MessageList";

type GalleryEntry = { image: ImageAttachment; message: ArchiveMessage };

export function ImageGallery({ locale, apiBaseUrl }: { locale: string; apiBaseUrl?: string }) {
  const [filters, setFilters] = useState<ArchiveFilters>({ ...emptyArchiveFilters, kind: "image" });
  const params = new URLSearchParams({ kind: "image", limit: "30" });
  for (const [key, value] of Object.entries({ q: filters.query, memberId: filters.member, source: filters.source, from: filters.from, to: filters.to })) {
    if (value) params.set(key, value);
  }
  return <>
    <ArchiveMessageFilters locale={locale} apiBaseUrl={apiBaseUrl} value={filters} onChange={setFilters} imagesOnly />
    <GalleryResults key={`${apiBaseUrl}:${params}`} locale={locale} apiBaseUrl={apiBaseUrl} query={params.toString()} />
  </>;
}

function GalleryResults({ locale, apiBaseUrl, query }: { locale: string; apiBaseUrl?: string; query: string }) {
  const t = archiveLabels(locale);
  const [history, setHistory] = useState<ArchiveMessage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const params = new URLSearchParams(query);
  if (cursor) params.set("before", cursor);
  // Reuse archive request cancellation/retry and the member-history accumulation pattern.
  // The keyed results boundary discards history and cancels requests when filters change.
  const page = useArchiveQuery<ArchiveMessages>(apiBaseUrl, `/api/query/messages?${params}`);
  const messages = useMemo(() => {
    const ids = new Set<string>();
    return [...history, ...(page.data?.data ?? [])].filter(message => {
      if (ids.has(message.id)) return false;
      ids.add(message.id);
      return true;
    });
  }, [history, page.data]);
  const entries = useMemo(() => {
    const ids = new Set<string>();
    return messages.flatMap(message => message.images.filter(image => {
      if (ids.has(image.id)) return false;
      ids.add(image.id);
      return true;
    }).map(image => ({ image, message })));
  }, [messages]);
  const nextCursor = page.data?.nextCursor !== cursor ? page.data?.nextCursor : null;
  const loadMore = useCallback(() => {
    if (!nextCursor || page.loading || page.failed) return;
    setHistory(messages);
    setCursor(nextCursor);
  }, [messages, nextCursor, page.loading, page.failed]);

  useEffect(() => {
    const target = sentinel.current;
    if (!target || !nextCursor || page.loading || page.failed || selected) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) loadMore();
    }, { rootMargin: "300px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [loadMore, nextCursor, page.loading, page.failed, selected]);

  const selectedIndex = entries.findIndex(entry => entry.image.id === selected);
  const active = entries[selectedIndex];
  const selectOffset = (offset: number) => {
    const next = entries[selectedIndex + offset];
    if (next) setSelected(next.image.id);
  };

  return <div className="gallery-shell flex min-w-0 flex-col gap-3">
    {!entries.length ? <QueryStatus state={page} locale={locale} /> : null}
    {page.loading && !entries.length ? <ImageGallerySkeleton label={t.loading} /> : null}
    {!page.loading && page.data && !entries.length ? <p role="status" className="py-12 text-center text-sm text-muted-foreground">{t.empty}</p> : null}
    <Dialog open={Boolean(active)} onOpenChange={open => { if (!open) setSelected(null); }}>
      <GalleryMasonry entries={entries} locale={locale} onSelect={(entry, button) => {
        opener.current = button;
        setSelected(entry.image.id);
      }} />
      {active ? <DialogContent
        className="flex max-h-[94dvh] w-[calc(100%-1rem)] max-w-5xl flex-col gap-3 overflow-y-auto p-3 pt-12 motion-reduce:animate-none sm:p-5 sm:pt-12"
        closeLabel={t.closePreview}
        onCloseAutoFocus={event => { event.preventDefault(); opener.current?.focus({ preventScroll: true }); }}
        onKeyDown={event => {
          if (event.altKey || event.ctrlKey || event.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test((event.target as HTMLElement).tagName)) return;
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            selectOffset(event.key === "ArrowLeft" ? -1 : 1);
          }
        }}
      >
        <DialogTitle className="sr-only">{t.imagePreview}</DialogTitle>
        <DialogDescription className="sr-only">{t.previewHelp}</DialogDescription>
        <div className="flex min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground">
          <Link className="truncate font-medium text-brand hover:underline" href={`/${locale}/members/${encodeURIComponent(active.message.memberId)}`}>{active.message.memberName}</Link>
          <time className="shrink-0" dateTime={active.message.occurredAt}>{formatTime(active.message.occurredAt, locale)}</time>
        </div>
        <PreviewImage key={active.image.id} image={active.image} locale={locale} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" aria-label={t.previousImage} disabled={selectedIndex === 0} onClick={() => selectOffset(-1)}><ChevronLeft /></Button>
            <span aria-live="polite" className="min-w-12 text-center font-mono text-xs tabular-nums">{selectedIndex + 1} / {entries.length}</span>
            <Button variant="outline" size="icon" aria-label={t.nextImage} disabled={selectedIndex === entries.length - 1} onClick={() => selectOffset(1)}><ChevronRight /></Button>
          </div>
          <Button asChild variant="outline" size="sm"><a href={active.image.galleryUrl ?? active.image.sourceUrl} target="_blank" rel="noreferrer">{t.imageSource}<ExternalLink data-icon="inline-end" /></a></Button>
        </div>
        <section className="flex min-w-0 flex-col gap-2 border-t pt-3 text-sm" aria-label={t.relatedMessage}>
          <h2 className="text-xs font-medium text-muted-foreground">{t.relatedMessage} · {t[`source_${active.message.source}`]}</h2>
          {active.message.text || active.message.answer ? <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{displayMessageText(active.message.answer ?? active.message.text)}</p> : null}
          {active.message.question ? <blockquote className="border-l-2 pl-2 text-muted-foreground">{displayMessageText(active.message.question)}</blockquote> : null}
          {active.message.images.length > 1 ? <p className="text-xs text-muted-foreground">{active.message.images.length} {t.messageImageCount}</p> : null}
          {active.message.roomOwnerName && active.message.roomOwnerId !== active.message.memberId ? <p className="text-xs text-muted-foreground">{t.room}: {active.message.roomOwnerName}</p> : null}
        </section>
      </DialogContent> : null}
    </Dialog>
    <div ref={sentinel} className="flex min-h-12 flex-col items-center justify-center gap-2" aria-busy={page.loading}>
      <p role="status" className="text-center text-xs text-muted-foreground">{page.failed && entries.length ? t.failure : page.loading && entries.length ? t.loading : entries.length && !nextCursor ? `${entries.length} ${t.allImagesLoaded}` : null}</p>
      {page.failed && entries.length ? <Button variant="outline" size="sm" onClick={page.retry}>{t.retry}</Button> : nextCursor ? <Button variant="outline" size="sm" disabled={page.loading} onClick={loadMore}>{t.loadMoreImages}</Button> : null}
    </div>
  </div>;
}

// Existing archive images/installed UI cover previews, not masonry. The reference's
// CSS columns rebalance on append; react-masonry-css also orders by column, and
// masonic adds virtual-list measurement we do not need. Only place these archive
// cards here: preserve DOM/time order and derive fixed frames from stored dimensions.
function GalleryMasonry({ entries, locale, onSelect }: { entries: GalleryEntry[]; locale: string; onSelect: (entry: GalleryEntry, button: HTMLButtonElement) => void }) {
  const container = useRef<HTMLUListElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setWidth(entry.contentRect.width); });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const columns = width >= 1080 ? 5 : width >= 880 ? 4 : width >= 600 ? 3 : 2;
  const cardWidth = Math.max(0, (width - (columns - 1) * 8) / columns);
  const heights = Array<number>(columns).fill(0);
  const positions = entries.map(({ image }) => {
    const column = heights.indexOf(Math.min(...heights));
    const height = cardWidth * Math.min(2.5, image.width && image.height ? image.height / image.width : 4 / 3);
    const top = heights[column] ?? 0;
    const position = { width: cardWidth, height, left: column * (cardWidth + 8), top };
    heights[column] = top + height + 8;
    return position;
  });
  const t = archiveLabels(locale);
  return <ul ref={container} aria-label={t.imageGallery} className="gallery-grid relative w-full" style={width ? { display: "block", height: Math.max(0, ...heights) - (entries.length ? 8 : 0) } : undefined}>
    {entries.map((entry, index) => <li key={entry.image.id} data-image-id={entry.image.id} className={width ? "absolute" : "min-w-0"} style={width ? positions[index] : undefined}>
      <GalleryCard entry={entry} locale={locale} onSelect={onSelect} />
    </li>)}
  </ul>;
}

function GalleryCard({ entry, locale, onSelect }: { entry: GalleryEntry; locale: string; onSelect: (entry: GalleryEntry, button: HTMLButtonElement) => void }) {
  const { image, message } = entry;
  const t = archiveLabels(locale);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return <button type="button" aria-label={t.viewImage} onClick={event => onSelect(entry, event.currentTarget)} className="gallery-card group relative block size-full overflow-hidden rounded-lg bg-muted text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" style={{ aspectRatio: image.width && image.height ? `${image.width} / ${Math.min(image.height, image.width * 2.5)}` : "3 / 4" }}>
    {!loaded && !failed ? <Skeleton className="absolute inset-0 size-full rounded-none" /> : null}
    {failed ? <span className="flex size-full min-h-24 items-center justify-center p-3 text-xs text-muted-foreground">{t.imageUnavailable}</span> : <Image unoptimized src={image.thumbnailUrl ?? image.galleryUrl ?? image.sourceUrl} width={image.width ?? 600} height={image.height ?? 800} alt={`${message.memberName} · ${formatTime(message.occurredAt, locale)}`} loading="lazy" decoding="async" className="relative size-full object-contain" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />}
    <span className="gallery-caption absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-2 pb-2 pt-8 text-xs text-white">
      <span className="truncate font-medium">{message.memberName}</span><time className="shrink-0 text-[10px] tabular-nums" dateTime={message.occurredAt}>{new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit" }).format(new Date(message.occurredAt))}</time>
    </span>
  </button>;
}

function PreviewImage({ image, locale }: { image: ImageAttachment; locale: string }) {
  const [failed, setFailed] = useState(false);
  const t = archiveLabels(locale);
  return failed ? <p className="flex h-[50dvh] items-center justify-center text-sm text-muted-foreground">{t.imageUnavailable}</p> : <Image unoptimized src={image.galleryUrl ?? image.sourceUrl} width={image.width ?? 1200} height={image.height ?? 1600} alt={t.viewImage!} className="h-[min(60dvh,42rem)] w-full rounded-md bg-muted/30 object-contain" onError={() => setFailed(true)} />;
}
