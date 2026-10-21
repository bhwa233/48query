"use client";

import { useId, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import type { ArchiveMembers } from "@starter/shared";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { archiveLabels, useArchiveQuery } from "./ArchiveData";

export type ArchiveFilters = { query: string; member: string; kind: string; source: string; from: string; to: string };
export const emptyArchiveFilters: ArchiveFilters = { query: "", member: "", kind: "", source: "", from: "", to: "" };

export function ArchiveMessageFilters({ locale, apiBaseUrl, value, onChange, imagesOnly = false }: {
  locale: string; apiBaseUrl?: string; value: ArchiveFilters; onChange: (value: ArchiveFilters) => void; imagesOnly?: boolean;
}) {
  const t = archiveLabels(locale);
  const { query, member, kind, source, from, to } = value;
  const [draft, setDraft] = useState(query);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const advancedId = useId();
  const state = { configured: Boolean(apiBaseUrl) };
  const members = useArchiveQuery<ArchiveMembers>(apiBaseUrl, "/api/query/members");
  const sources = ["room", "album", "essence", "posts", "post_images", "weibo", "room_posts"];
  const summary = [source ? t[`source_${source}`] : "", from ? `${t.from}: ${from}` : "", to ? `${t.to}: ${to}` : ""].filter(Boolean).join(" · ");
  const setQuery = (query: string) => onChange({ ...value, query });
  const setMember = (member: string) => onChange({ ...value, member });
  const setKind = (kind: string) => onChange({ ...value, kind });
  const setSource = (source: string) => onChange({ ...value, source });
  const setFrom = (from: string) => onChange({ ...value, from });
  const setTo = (to: string) => onChange({ ...value, to });
  return (
    <section aria-label={t.messageFilters} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-2 sm:p-3">
      <div className="flex min-w-0 flex-col gap-2 md:flex-row">
        <form className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 md:flex-1" onSubmit={event => { event.preventDefault(); setQuery(draft); }}>
          <Input className="h-11 sm:h-9" disabled={!state.configured} aria-label={t.searchMessages} placeholder={t.searchMessages} value={draft} onChange={event => setDraft(event.target.value)} />
          <Button className="h-11 sm:h-9" disabled={!state.configured} type="submit" size="sm">{t.search}</Button>
        </form>
        <div className="grid min-w-0 gap-2 md:flex-1" style={{ gridTemplateColumns: imagesOnly ? "minmax(0,1fr) auto" : "minmax(0,1fr) minmax(0,1fr) auto" }}>
          <ArchiveFilter label={t.allMembers!} value={member} onChange={value => { setMember(value); }} options={members.data?.data.map(item => ({ value: item.id, label: item.name })) ?? []} />
          {!imagesOnly ? <ArchiveFilter label={t.allTypes!} value={kind} onChange={value => { setKind(value); }} options={["text", "image", "reply", "post"].map(value => ({ value, label: t[`kind_${value}`]! }))} /> : null}
          <Button type="button" variant={summary ? "secondary" : "outline"} size="sm" className="h-11 sm:h-9" aria-expanded={advancedOpen} aria-controls={advancedId} onClick={() => setAdvancedOpen(value => !value)}><SlidersHorizontal data-icon="inline-start" />{t.moreFilters}</Button>
        </div>
      </div>
      <fieldset id={advancedId} hidden={!advancedOpen} className={advancedOpen ? "grid min-w-0 grid-cols-1 items-end gap-2 border-t border-border pt-2 sm:grid-cols-3" : "hidden"}>
        <legend className="sr-only">{t.moreFilters}</legend>
        <ArchiveFilter label={t.allSources!} value={source} onChange={value => { setSource(value); }} options={sources.map(value => ({ value, label: t[`source_${value}`]! }))} />
        <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">{t.from}<Input className="h-11 sm:h-9" type="date" max={to || undefined} value={from} onChange={event => { setFrom(event.target.value); }} /></label>
        <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">{t.to}<Input className="h-11 sm:h-9" type="date" min={from || undefined} value={to} onChange={event => { setTo(event.target.value); }} /></label>
      </fieldset>
      {summary ? <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"><p className="min-w-0 break-words">{summary}</p><Button type="button" variant="ghost" size="xs" onClick={() => { onChange({ ...value, source: "", from: "", to: "" }); }}>{t.clearExtraFilters}</Button></div> : null}
    </section>
  );
}

// Compose the installed Select once for the archive's common "all" option and labels.
export function ArchiveFilter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return <Select value={value || "all"} onValueChange={next => onChange(next === "all" ? "" : next)}>
    <SelectTrigger aria-label={label} className="h-11 min-w-0 sm:h-9"><SelectValue /></SelectTrigger>
    <SelectContent><SelectGroup><SelectItem value="all">{label}</SelectItem>{options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
  </Select>;
}
