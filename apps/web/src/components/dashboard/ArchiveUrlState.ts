"use client";

import { useSearchParams } from "next/navigation";
import type { ArchiveFilters } from "./ArchiveMessageFilters";

// No URL-state library is installed. Reuse the router's native-history support;
// every view reads its state from the URL rather than a separate cursor stack.
export function updateArchiveUrl(values: Record<string, string | number | null>, replace = false) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, String(value));
  }
  const href = `${url.pathname}${url.search}${url.hash}`;
  if (href === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
  if (replace) window.history.replaceState(null, "", href);
  else window.history.pushState(null, "", href);
}

export function archiveDate(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value ? value : "";
}

export function useArchiveFilters(memberId?: string, initialKind = "") {
  const search = useSearchParams();
  const from = archiveDate(search.get("from")), to = archiveDate(search.get("to"));
  const kind = search.get("kind") ?? initialKind;
  const source = search.get("source") ?? "";
  const filters: ArchiveFilters = { query: (search.get("q") ?? "").slice(0, 100), member: memberId ?? search.get("memberId") ?? "", kind: ["", "text", "image", "video", "reply", "post"].includes(kind) ? kind : initialKind, source: ["room", "album", "essence", "posts", "post_images", "weibo", "room_posts"].includes(source) ? source : "", from, to: from && to && to < from ? "" : to };
  const setFilters = (value: ArchiveFilters) => updateArchiveUrl({ q: value.query, memberId: memberId ? null : value.member, kind: value.kind, source: value.source, from: value.from, to: value.to, page: null, messagePage: null, imagePage: null });
  return { filters, setFilters };
}

export function contentQuery(filters: ArchiveFilters, options: { memberId?: string; to?: string; images?: boolean } = {}) {
  const params = new URLSearchParams();
  const to = filters.to && options.to ? filters.to < options.to ? filters.to : options.to : filters.to || options.to;
  for (const [key, value] of Object.entries({ q: filters.query, memberId: options.memberId ?? filters.member, kind: options.images ? "" : filters.kind, source: filters.source, from: filters.from, to })) if (value) params.set(key, value);
  return params;
}

export function useArchivePage(images = false, member = false) {
  const search = useSearchParams();
  const pageKey = member ? images ? "imagePage" : "messagePage" : "page";
  const sizeKey = member ? images ? "imageSize" : "messageSize" : "pageSize";
  const sizes = images ? [30, 60, 120] : [20, 50, 100];
  const requested = Number(search.get(pageKey) ?? 1), requestedSize = Number(search.get(sizeKey) ?? sizes[0]);
  const page = Number.isSafeInteger(requested) && requested >= 1 && requested <= 1_000_000 ? requested : 1;
  const pageSize = sizes.includes(requestedSize) ? requestedSize : sizes[0]!;
  return { page, pageSize, pageKey, sizeKey, sizes };
}
