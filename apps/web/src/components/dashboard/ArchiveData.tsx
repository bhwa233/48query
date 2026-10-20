"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Image from "next/image";
import type { ImageAttachment } from "@starter/shared";
import { messages } from "@/i18n/messages";
import { isLocale } from "@/i18n/config";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

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
  return !state.configured || state.failed ? <div role="status" className="rounded-xl border border-border p-6 text-sm text-muted-foreground">{!state.configured ? t.unavailable : t.failure}{state.failed ? <Button variant="outline" className="ml-3" onClick={state.retry}>{t.retry}</Button> : null}</div> : null;
}

// Keep the last result's geometry during filter requests without displaying or
// announcing stale data. CSS grid reserves its size; no measurement hook is needed.
export function ArchiveDataRegion({ loading, fallback, children }: { loading: boolean; fallback: ReactNode; children: ReactNode }) {
  return <div className="grid min-w-0" aria-busy={loading}>
    <div className={cn("col-start-1 row-start-1 min-w-0", loading && "invisible")} aria-hidden={loading || undefined} inert={loading || undefined}>{children}</div>
    {loading ? <div className="col-start-1 row-start-1 min-w-0">{fallback}</div> : null}
  </div>;
}

export function ArchiveImage({ image, locale }: { image: ImageAttachment; locale: string }) {
  const t = archiveLabels(locale);
  const primary = image.galleryUrl ?? image.sourceUrl;
  const [failed, setFailed] = useState(false);
  const [fullFailed, setFullFailed] = useState(false);
  return <figure className="w-[300px] min-w-0 max-w-full"><Dialog><DialogTrigger asChild><button type="button" aria-label={t.viewImage} className="flex min-h-16 w-full items-center justify-center overflow-hidden rounded-lg border border-border bg-muted text-xs text-muted-foreground">{failed ? t.imageUnavailable : <Image unoptimized width={image.width ?? 1024} height={image.height ?? 1024} src={image.thumbnailUrl ?? primary} alt={t.viewImage!} className="h-auto max-h-[360px] w-auto max-w-full object-contain" loading="lazy" decoding="async" onError={() => setFailed(true)} />}</button></DialogTrigger><DialogContent className="max-h-[90dvh] overflow-auto sm:max-w-4xl"><DialogTitle>{t.viewImage}</DialogTitle>{fullFailed ? <p>{t.imageUnavailable}</p> : <Image unoptimized width={image.width ?? 1024} height={image.height ?? 1024} src={primary} alt={t.viewImage!} className="max-h-[75dvh] w-full object-contain" onError={() => setFullFailed(true)} />}<a href={primary} target="_blank" rel="noreferrer" className="text-sm underline">{t.viewImage}</a></DialogContent></Dialog></figure>;
}
