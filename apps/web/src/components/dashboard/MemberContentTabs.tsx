"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FileText, ImageIcon } from "lucide-react";
import type { ArchiveMemberDetail } from "@starter/shared";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { archiveLabels } from "./ArchiveData";
import { MemberImageGallery } from "./ImageGallery";
import { MemberMessageHistory } from "./MemberMessageHistory";

type MemberTab = "messages" | "images";

// Compose the installed Tabs and archive views. Only per-tab window positions
// live here; force-mounted panels retain their own pagination and loaded content.
export function MemberContentTabs({ member, locale, apiBaseUrl, asOf }: {
  member: ArchiveMemberDetail["data"]; locale: string; apiBaseUrl?: string; asOf: string;
}) {
  const t = archiveLabels(locale);
  const search = useSearchParams();
  const tab: MemberTab = search.get("tab") === "images" ? "images" : "messages";
  const [imagesMounted, setImagesMounted] = useState(tab === "images");
  if (tab === "images" && !imagesMounted) setImagesMounted(true);
  const active = useRef<MemberTab | null>(null);
  const positions = useRef<Record<MemberTab, number>>({ messages: 0, images: 0 });
  const restoring = useRef(false);
  const number = new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en");

  useEffect(() => {
    const remember = () => { if (active.current && !restoring.current) positions.current[active.current] = window.scrollY; };
    window.addEventListener("scroll", remember, { passive: true });
    return () => window.removeEventListener("scroll", remember);
  }, []);

  useLayoutEffect(() => {
    const previous = active.current;
    active.current = tab;
    if (!previous || previous === tab) return;
    restoring.current = true;
    const top = positions.current[tab];
    const frame = requestAnimationFrame(() => {
      window.scrollTo({ top, behavior: "instant" });
      restoring.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [tab]);

  function chooseTab(value: string) {
    if (value !== "messages" && value !== "images") return;
    const url = new URL(window.location.href);
    const current: MemberTab = url.searchParams.get("tab") === "images" ? "images" : "messages";
    // Pointer activation and focus can arrive before the URL subscription renders.
    // Compare the live URL so one selection creates exactly one history entry.
    if (value === current) return;
    positions.current[current] = window.scrollY;
    if (value === "messages") url.searchParams.delete("tab");
    else url.searchParams.set("tab", value);
    // The installed router integrates native history writes with useSearchParams;
    // changing a view does not need another server render or member request.
    window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  return <Tabs value={tab} onValueChange={chooseTab} className="min-w-0 flex-col gap-3">
    <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
      <TabsList variant="line" className="rank-tabs h-10 w-full justify-start gap-1" aria-label={t.memberContent}>
        <TabsTrigger value="messages" className="flex-none gap-2 px-3"><FileText aria-hidden="true" />{t.messages}<span className="font-mono text-xs tabular-nums">{number.format(member.messages)}</span></TabsTrigger>
        <TabsTrigger value="images" className="flex-none gap-2 px-3"><ImageIcon aria-hidden="true" />{t.images}<span className="font-mono text-xs tabular-nums">{number.format(member.images)}</span></TabsTrigger>
      </TabsList>
    </div>
    <TabsContent value="messages" forceMount hidden={tab !== "messages"} inert={tab !== "messages" || undefined} className="m-0 min-w-0 data-[state=inactive]:hidden">
      <MemberMessageHistory memberId={member.id} initialMessages={member.recentMessages} totalMessages={member.messages} locale={locale} apiBaseUrl={apiBaseUrl} to={asOf} />
    </TabsContent>
    <TabsContent value="images" forceMount hidden={tab !== "images"} inert={tab !== "images" || undefined} className="m-0 min-w-0 data-[state=inactive]:hidden">
      {imagesMounted ? <MemberImageGallery memberId={member.id} locale={locale} apiBaseUrl={apiBaseUrl} active={tab === "images"} to={asOf} /> : null}
    </TabsContent>
  </Tabs>;
}
