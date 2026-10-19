"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ArchiveMemberDetail, ArchiveMembers, ArchiveMessages } from "@starter/shared";
import { AppPageContainer } from "@/components/app-page-shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { archiveLabels, Coverage, formatTime, MessageCard, QueryStatus, useArchiveQuery } from "./ArchiveData";

export function MembersView({ locale, apiBaseUrl }: { locale: string; apiBaseUrl?: string }) {
  const t = archiveLabels(locale);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const state = useArchiveQuery<ArchiveMembers>(apiBaseUrl, "/api/query/members");
  const groups = [...new Set(state.data?.data.map(member => member.groupName) ?? [])];
  const members = useMemo(() => state.data?.data.filter(member => (!group || member.groupName === group) && `${member.name} ${member.pinyin ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [], [state.data, group, query]);
  return <ExplorerLayout title={t.members!} description={t.memberDescription!} locale={locale}><QueryStatus state={state} locale={locale} />{state.data ? <><Coverage value={state.data.coverage} locale={locale} /><div className="flex flex-col gap-3 sm:flex-row"><Input value={query} onChange={event => setQuery(event.target.value)} placeholder={t.searchMembers} aria-label={t.searchMembers} /><select aria-label={t.allGroups} value={group} onChange={event => setGroup(event.target.value)} className="h-10 rounded-lg border border-input bg-background px-3 text-sm"><option value="">{t.allGroups}</option>{groups.map(value => <option key={value}>{value}</option>)}</select></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{members.map(member => <Link key={member.id} href={`/${locale}/members/${encodeURIComponent(member.id)}`} className="min-w-0 rounded-xl border border-border bg-card p-5 hover:border-foreground/30"><p className="text-lg font-semibold">{member.name}</p><p className="mt-1 text-sm text-muted-foreground">{member.groupName} · {member.team ?? ""}</p><div className="mt-5 grid grid-cols-3 gap-3"><Metric label={t.messages!} value={member.messages} /><Metric label={t.images!} value={member.images} /><Metric label={t.activeDays!} value={member.activeDays} /></div></Link>)}</div>{!members.length ? <Empty text={t.empty!} /> : null}</> : null}</ExplorerLayout>;
}

export function MessagesView({ locale, apiBaseUrl, initialKind = "" }: { locale: string; apiBaseUrl?: string; initialKind?: string }) {
  const t = archiveLabels(locale);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [member, setMember] = useState("");
  const [kind, setKind] = useState(initialKind);
  const [source, setSource] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [cursors, setCursors] = useState<string[]>([]);
  const params = new URLSearchParams({ limit: "30" });
  for (const [key, value] of Object.entries({ q: query, memberId: member, kind, source, from, to, before: cursors.at(-1) })) if (value) params.set(key, value);
  const state = useArchiveQuery<ArchiveMessages>(apiBaseUrl, `/api/query/messages?${params}`);
  const members = useArchiveQuery<ArchiveMembers>(apiBaseUrl, "/api/query/members");
  const selectClass = "h-10 min-w-0 rounded-lg border border-input bg-background px-3 text-sm";
  const sources = ["room", "album", "essence", "posts", "post_images", "weibo", "room_posts"];
  return <ExplorerLayout title={initialKind === "image" ? t.images! : t.messages!} description={initialKind === "image" ? t.imageDescription! : t.messageDescription!} locale={locale}><form className="grid gap-3 sm:grid-cols-[1fr_auto]" onSubmit={event => { event.preventDefault(); setQuery(draft); setCursors([]); }}><Input disabled={!state.data} aria-label={t.searchMessages} placeholder={t.searchMessages} value={draft} onChange={event => setDraft(event.target.value)} /><Button disabled={!state.data} type="submit">{t.search}</Button></form><div className="grid gap-3 sm:grid-cols-3"><select className={selectClass} aria-label={t.allMembers} value={member} onChange={event => { setMember(event.target.value); setCursors([]); }}><option value="">{t.allMembers}</option>{members.data?.data.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select className={selectClass} aria-label={t.allTypes} value={kind} onChange={event => { setKind(event.target.value); setCursors([]); }}><option value="">{t.allTypes}</option>{["text", "image", "reply", "post", "excluded", "unknown"].map(value => <option key={value} value={value}>{t[`kind_${value}`]}</option>)}</select><select className={selectClass} aria-label={t.allSources} value={source} onChange={event => { setSource(event.target.value); setCursors([]); }}><option value="">{t.allSources}</option>{sources.map(value => <option key={value} value={value}>{t[`source_${value}`]}</option>)}</select><label className="text-xs text-muted-foreground">{t.from}<Input type="date" value={from} onChange={event => { setFrom(event.target.value); setCursors([]); }} /></label><label className="text-xs text-muted-foreground">{t.to}<Input type="date" value={to} onChange={event => { setTo(event.target.value); setCursors([]); }} /></label></div><QueryStatus state={state} locale={locale} />{state.data ? <><Coverage value={state.data.coverage} locale={locale} /><div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">{state.data.data.map(message => <MessageCard key={message.id} message={message} locale={locale} />)}{!state.data.data.length ? <Empty text={t.empty!} /> : null}</div><div className="flex items-center justify-between gap-3"><Button variant="outline" disabled={!cursors.length} onClick={() => setCursors(values => values.slice(0, -1))}>{t.previous}</Button><span className="text-xs text-muted-foreground">{cursors.length + 1} {t.page}</span><Button variant="outline" disabled={!state.data.nextCursor} onClick={() => { if (state.data?.nextCursor) setCursors(values => [...values, state.data!.nextCursor!]); }}>{t.next}</Button></div></> : null}<p className="text-xs leading-6 text-muted-foreground">{t.notice}</p></ExplorerLayout>;
}

export function MemberDetailView({ locale, id, apiBaseUrl }: { locale: string; id: string; apiBaseUrl?: string }) {
  const t = archiveLabels(locale);
  const state = useArchiveQuery<ArchiveMemberDetail>(apiBaseUrl, `/api/query/members/${encodeURIComponent(id)}`);
  const data = state.data?.data;
  return <ExplorerLayout title={data?.name ?? t.members!} description={data ? `${data.groupName} · ${data.team ?? ""}` : t.memberDescription!} locale={locale} backHref={`/${locale}/members`}><QueryStatus state={state} locale={locale} />{data && state.data ? <><Coverage value={state.data.coverage} locale={locale} /><section className="rounded-xl border border-border bg-card p-5"><h2 className="mb-5 font-medium">{t.stats}</h2><div className="grid grid-cols-2 gap-5 sm:grid-cols-4"><Metric label={t.messages!} value={data.messages} /><Metric label={t.images!} value={data.images} /><Metric label={t.replies!} value={data.replies} /><Metric label={t.activeDays!} value={data.activeDays} /></div></section><section className="rounded-xl border border-border bg-card p-5"><h2 className="mb-4 font-medium">{t.sourceStatus}</h2><div className="divide-y divide-border">{data.sync.map(sync => <div key={sync.source} className="space-y-2 py-4 text-sm"><div className="flex flex-wrap items-center gap-3"><strong>{t[`source_${sync.source}`]}</strong><Badge variant="outline">{t[`status_${sync.status}`]}</Badge></div><p className="text-xs text-muted-foreground">{t.lastSuccess}: {formatTime(sync.lastSuccessAt, locale)} · {t.lastNonempty}: {formatTime(sync.lastNonemptyAt, locale)}</p><p className="text-xs text-muted-foreground">{sync.lastNonemptyAt && sync.historyDone ? t.historyDone : t.historyPending}</p>{!sync.lastNonemptyAt ? <p className="text-xs text-muted-foreground">{t.notObserved}</p> : null}{sync.lastError ? <p className="break-words text-xs text-destructive">{sync.lastError}</p> : null}</div>)}{!data.sync.length ? <Empty text={t.notObserved!} /> : null}</div></section><section><h2 className="mb-4 font-medium">{t.latestMessages}</h2><div className="divide-y divide-border rounded-xl border border-border bg-card">{data.recentMessages.map(message => <MessageCard key={message.id} message={message} locale={locale} />)}{!data.recentMessages.length ? <Empty text={t.noMessages!} /> : null}</div></section></> : null}</ExplorerLayout>;
}

function ExplorerLayout({ title, description, locale, children, backHref }: { title: string; description: string; locale: string; children: ReactNode; backHref?: string }) {
  const t = archiveLabels(locale);
  return <AppPageContainer width="content" className="gap-6"><header>{backHref ? <Link href={backHref} className="mb-4 inline-block text-sm text-muted-foreground hover:underline">← {t.back}</Link> : null}<p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">48query / archive</p><h1 className="mt-3 text-4xl font-semibold tracking-tight">{title}</h1><p className="mt-3 text-base leading-7 text-muted-foreground">{description}</p></header>{children}</AppPageContainer>;
}
function Metric({ label, value }: { label: string; value: number }) { return <div><p className="text-2xl font-semibold">{value.toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">{label}</p></div>; }
function Empty({ text }: { text: string }) { return <p role="status" className="p-8 text-center text-sm text-muted-foreground">{text}</p>; }
