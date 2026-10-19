"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import type { ArchiveMessage, ImageAttachment } from "@starter/shared";
import { messages } from "@/i18n/messages";
import { isLocale } from "@/i18n/config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export const archiveLabels = (locale: string): Record<string, string> => messages[isLocale(locale) ? locale : "en"].archive;
export const formatTime = (value: string | null | undefined, locale: string) => value ? new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : archiveLabels(locale).unknown;

// Existing example fetches are notes-specific. Keep archive cancellation and
// empty/error states in one small hook; do not add a second data-fetching library.
export function useArchiveQuery<T>(apiBaseUrl: string | undefined, path: string) {
  const [attempt, setAttempt] = useState(0);
  const key = `${apiBaseUrl ?? ""}${path}:${attempt}`;
  const [result, setResult] = useState<{ key: string; data: T | null; failed: boolean }>({ key: "", data: null, failed: false });
  useEffect(() => {
    if (!apiBaseUrl) return;
    const controller = new AbortController();
    fetch(`${apiBaseUrl}${path}`, { headers: { Accept: "application/json" }, signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Archive request failed");
        const payload = await response.json() as T & { ok?: boolean };
        if (payload.ok !== true) throw new Error("Invalid archive response");
        setResult({ key, data: payload, failed: false });
      })
      .catch(() => { if (!controller.signal.aborted) setResult({ key, data: null, failed: true }); });
    return () => controller.abort();
  }, [apiBaseUrl, path, key]);
  return { data: result.key === key ? result.data : null, previousData: result.data, loading: Boolean(apiBaseUrl) && result.key !== key, failed: result.key === key && result.failed, configured: Boolean(apiBaseUrl), retry: () => setAttempt(value => value + 1) };
}

export function QueryStatus({ state, locale }: { state: { loading: boolean; failed: boolean; configured: boolean; retry: () => void }; locale: string }) {
  const t = archiveLabels(locale);
  return !state.configured || state.loading || state.failed ? <div role="status" className="rounded-xl border border-border p-6 text-sm text-muted-foreground">{!state.configured ? t.unavailable : state.loading ? t.loading : t.failure}{state.failed ? <Button variant="outline" className="ml-3" onClick={state.retry}>{t.retry}</Button> : null}</div> : null;
}

export function Coverage({ value, locale }: { value: { status: string; membersCovered: number; totalMembers: number; latestDate: string | null; lastBatchCompletedAt: string | null }; locale: string }) {
  const t = archiveLabels(locale);
  return <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground"><span>{t.coverage}: {value.membersCovered}/{value.totalMembers}</span><span>{t.dataThrough}: {value.latestDate ?? t.unknown}</span><span>{t.latestBatch}: {formatTime(value.lastBatchCompletedAt, locale)}</span><Badge variant="outline">{value.status === "unavailable" ? t.notObserved : t[value.status]}</Badge></div>;
}

function ArchiveImage({ image, locale }: { image: ImageAttachment; locale: string }) {
  const t = archiveLabels(locale);
  const primary = image.galleryUrl ?? image.sourceUrl;
  const [failed, setFailed] = useState(false);
  const [fullFailed, setFullFailed] = useState(false);
  return <figure className="min-w-0 space-y-2"><Dialog><DialogTrigger asChild><button type="button" aria-label={t.viewImage} className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border border-border bg-muted text-xs text-muted-foreground">{failed ? t.imageUnavailable : <Image unoptimized width={image.width ?? 1024} height={image.height ?? 1024} src={image.thumbnailUrl ?? primary} alt={t.viewImage!} className="h-full w-full object-cover" loading="lazy" decoding="async" onError={() => setFailed(true)} />}</button></DialogTrigger><DialogContent className="max-h-[90dvh] overflow-auto sm:max-w-4xl"><DialogTitle>{t.viewImage}</DialogTitle>{fullFailed ? <p>{t.imageUnavailable}</p> : <Image unoptimized width={image.width ?? 1024} height={image.height ?? 1024} src={primary} alt={t.viewImage!} className="max-h-[75dvh] w-full object-contain" onError={() => setFullFailed(true)} />}<a href={primary} target="_blank" rel="noreferrer" className="text-sm underline">{t.viewImage}</a></DialogContent></Dialog><figcaption className="text-xs text-muted-foreground">{image.status === "uploaded" ? t.uploaded : image.status === "failed" ? t.uploadFailed : t.uploadPending}</figcaption></figure>;
}

export function MessageCard({ message, locale }: { message: ArchiveMessage; locale: string }) {
  const t = archiveLabels(locale);
  return <article className="min-w-0 space-y-3 p-4 sm:p-5"><div className="flex flex-wrap items-center gap-2 text-xs"><Link className="font-medium hover:underline" href={`/${locale}/members/${encodeURIComponent(message.memberId)}`}>{message.memberName}</Link><Badge variant="outline">{t[`type_${message.type}`] ?? message.type}</Badge><time className="text-muted-foreground" dateTime={message.occurredAt}>{formatTime(message.occurredAt, locale)}</time><span className="text-muted-foreground">{t[`source_${message.source}`]}</span>{message.sourceFlags & 4 ? <Badge variant="secondary">{t.essence}</Badge> : null}</div>{message.roomOwnerName ? <p className="text-xs text-muted-foreground">{t.room}: {message.roomOwnerName}{message.roomOwnerId !== message.memberId ? ` · ${t.visitor}` : ""}</p> : null}{message.question ? <blockquote className="whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-sm text-muted-foreground"><p className="mb-1 text-xs font-medium">{t.question}</p>{message.question}</blockquote> : null}{message.text || message.answer ? <p className="whitespace-pre-wrap break-words text-sm leading-7">{message.answer ?? message.text}</p> : null}{message.kind === "excluded" || message.kind === "unknown" ? <p className="text-sm text-muted-foreground">{message.kind === "excluded" ? t.excluded : t.unsupported}</p> : null}{message.images.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{message.images.map(image => <ArchiveImage key={image.id} image={image} locale={locale} />)}</div> : null}</article>;
}
