"use client";

import Link from "next/link";
import { ArrowUpRight, CalendarDays, ChevronRight, Database, MessageSquare, PlaySquare, Search, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { QueryOverview } from "@starter/shared";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { demoDailyActivity, demoMembers, demoMessages } from "@/data/demo";
import type { Message } from "@/data/demo";

const formatNumber = (value: number) => new Intl.NumberFormat("zh-CN").format(value);

const typeLabel: Record<string, string> = { TEXT: "文字", IMAGE: "图片", REPLY: "回复", AUDIO: "语音" };

type LiveOverview = QueryOverview;

export function DashboardHome({ locale, apiBaseUrl }: { locale: string; apiBaseUrl?: string }) {
  const [query, setQuery] = useState("");
  const [liveOverview, setLiveOverview] = useState<LiveOverview | null>(null);
  const [sourceState, setSourceState] = useState<"demo" | "live" | "error">(apiBaseUrl ? "demo" : "demo");
  useEffect(() => {
    if (!apiBaseUrl) return;
    let cancelled = false;
    fetch(`${apiBaseUrl}/api/query/overview`, { headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`overview request failed: ${response.status}`);
        const payload = (await response.json()) as LiveOverview;
        if (!payload.ok || !payload.data || !payload.coverage) throw new Error("Invalid overview response");
        return payload;
      })
      .then((payload) => {
        if (cancelled) return;
        if (payload.coverage.status === "unavailable") return;
        setLiveOverview(payload);
        setSourceState("live");
      })
      .catch(() => {
        if (!cancelled) setSourceState("error");
      });
    return () => { cancelled = true; };
  }, [apiBaseUrl]);
  const filteredMembers = useMemo(
    () => demoMembers.filter((member) => `${member.name} ${member.pinyin}`.toLowerCase().includes(query.toLowerCase().trim())),
    [query],
  );
  const liveData = liveOverview?.data;
  const fallbackMember = demoMembers[0];
  const totals = liveData?.totals ?? { messages: 1218, activeMembers: 42, recordings: 18, danmaku: 6925 };
  const peak = Math.max(...(liveData?.dailyActivity.map((item) => item.count) ?? demoDailyActivity), 1);
  const activity = liveData?.dailyActivity.map((item) => item.count) ?? demoDailyActivity;
  const ranking = liveData?.ranking.length && fallbackMember ? liveData.ranking.map((item, index) => ({ ...(demoMembers[index % demoMembers.length] ?? fallbackMember), id: item.memberId, name: item.memberName, group: item.groupName, team: item.team ?? "", messages: item.messages, activeDays: item.activeDays, initials: item.memberName.slice(0, 1) })) : demoMembers;
  const recentMessages: Message[] = liveData?.recentMessages.length ? liveData.recentMessages.map((item) => {
    const senderType: Message["senderType"] = item.senderType === "成员" || item.senderType === "粉丝" || item.senderType === "系统" ? item.senderType : "系统";
    return { id: item.id, memberId: item.memberId, member: item.memberName, type: item.type as Message["type"], text: item.text ?? "媒体消息", time: item.occurredAt, sender: item.senderName ?? "未知发送者", senderType };
  }) : demoMessages;
  const breakdown = liveData?.typeBreakdown.length ? liveData.typeBreakdown : [{ type: "TEXT", count: 968 }, { type: "IMAGE", count: 126 }, { type: "REPLY", count: 78 }, { type: "AUDIO", count: 46 }];

  return (
    <main className="mx-auto flex w-full max-w-[92rem] flex-1 flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-emerald-500" /> 每日数据站</span>
            <Badge variant="outline" className="normal-case tracking-normal">{sourceState === "live" ? "已连接数据" : sourceState === "error" ? "演示数据 · API 暂不可用" : "演示数据"}</Badge>
          </div>
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-foreground sm:text-6xl">看见每一次发言，<span className="text-muted-foreground">从历史开始。</span></h1>
          <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">48query 将口袋房间消息、录播与弹幕整理成可检索的公开档案。数据每日跑批，今天看到的是昨天完成的统计。</p>
        </div>
        <div className="border-l border-border pl-5 text-sm text-muted-foreground lg:mb-1">
          <p className="mb-2 font-medium text-foreground">数据状态</p>
          <div className="flex items-center justify-between gap-4 border-b border-border/70 py-2"><span>最近批次</span><span className="font-mono text-xs text-foreground">2026-10-18 06:20</span></div>
          <div className="flex items-center justify-between gap-4 py-2"><span>数据截止</span><span className="font-medium text-foreground">2026-10-17</span></div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={<MessageSquare />} label="昨日消息" value={formatNumber(totals.messages)} change="按已完成批次统计" />
        <Stat icon={<Users />} label="活跃成员" value={formatNumber(totals.activeMembers)} change="统计日内出现消息的成员" />
        <Stat icon={<PlaySquare />} label="已发现录播" value={formatNumber(totals.recordings)} change="接口已发现的场次" />
        <Stat icon={<Database />} label="已收录弹幕" value={formatNumber(totals.danmaku)} change="成功解析的弹幕文本" />
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
        <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div><p className="text-sm font-medium">消息活跃度</p><p className="mt-1 text-sm text-muted-foreground">最近 14 个统计日 · 全部已采集成员</p></div>
            <Badge variant="outline"><CalendarDays className="size-3" />北京时间</Badge>
          </div>
          <div className="flex h-48 items-end gap-2 sm:gap-3">
            {activity.map((value, index) => <div className="group flex min-w-0 flex-1 flex-col items-center gap-2" key={`${value}-${index}`}><div className="relative w-full rounded-t-sm bg-primary/80 transition-colors group-hover:bg-primary" style={{ height: `${(value / peak) * 100}%` }}><span className="absolute -top-6 left-1/2 hidden -translate-x-1/2 text-[11px] text-muted-foreground group-hover:block">{value}</span></div><span className="text-[10px] text-muted-foreground">{index + 4}</span></div>)}
          </div>
          <div className="mt-4 flex justify-between border-t border-border pt-3 text-xs text-muted-foreground"><span>10 月 4 日</span><span>10 月 17 日</span></div>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
            <div className="mb-5 flex items-start justify-between"><div><p className="text-sm font-medium">消息类型</p><p className="mt-1 text-sm text-muted-foreground">昨日房间消息构成</p></div><span className="text-2xl font-semibold">{formatNumber(totals.messages)}</span></div>
          <div className="space-y-4">{breakdown.slice(0, 4).map((item, index) => <Distribution key={item.type} label={typeLabel[item.type] ?? item.type} value={item.count} total={Math.max(totals.messages, 1)} color={["bg-primary", "bg-emerald-500", "bg-amber-400", "bg-rose-400"][index] ?? "bg-primary"} />)}</div>
          <p className="mt-6 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">统计只包含已成功采集的消息。失败批次不会被计为零。</p>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
          <div className="mb-5 flex items-center justify-between"><div><p className="text-sm font-medium">消息榜</p><p className="mt-1 text-sm text-muted-foreground">昨日 · 成员本人消息</p></div><Link className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" href={`/${locale}/members`}>全部成员 <ArrowUpRight className="size-4" /></Link></div>
          <div className="space-y-1">{ranking.slice(0, 5).map((member, index) => <MemberRow key={member.id} member={member} rank={index + 1} locale={locale} />)}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
          <div className="mb-5 flex items-center justify-between"><div><p className="text-sm font-medium">最近动态</p><p className="mt-1 text-sm text-muted-foreground">已收录的房间消息</p></div><Link className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" href={`/${locale}/messages`}>检索消息 <ArrowUpRight className="size-4" /></Link></div>
          <div className="divide-y divide-border">{recentMessages.slice(0, 5).map((message) => <MessageRow key={message.id} message={message} />)}</div>
        </div>
      </section>

      <section className="border-y border-border py-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-medium">查找成员</p><p className="mt-1 text-sm text-muted-foreground">按姓名或拼音进入成员统计页</p></div><div className="relative w-full sm:w-72"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索成员" className="h-10 pl-9" aria-label="搜索成员" /></div></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{filteredMembers.map((member) => <MemberCard key={member.id} member={member} locale={locale} />)}{filteredMembers.length === 0 ? <p className="py-6 text-sm text-muted-foreground">没有找到匹配成员。</p> : null}</div>
      </section>
    </main>
  );
}

function Stat({ icon, label, value, change }: { icon: React.ReactNode; label: string; value: string; change: string }) { return <div className="rounded-xl border border-border bg-card p-4"><div className="mb-4 flex items-center justify-between"><span className="text-muted-foreground [&_svg]:size-4">{icon}</span><span className="text-[11px] uppercase tracking-wider text-muted-foreground">昨日</span></div><p className="text-3xl font-semibold tracking-tight">{value}</p><p className="mt-1 text-sm text-muted-foreground">{label}</p><p className="mt-4 text-xs text-muted-foreground">{change}</p></div>; }
function Distribution({ label, value, total, color }: { label: string; value: number; total: number; color: string }) { return <div><div className="mb-1.5 flex justify-between text-xs"><span>{label}</span><span className="text-muted-foreground">{formatNumber(value)} · {Math.round((value / total) * 100)}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${color}`} style={{ width: `${(value / total) * 100}%` }} /></div></div>; }
function MemberRow({ member, rank, locale }: { member: (typeof demoMembers)[number]; rank: number; locale: string }) { return <Link href={`/${locale}/members/${member.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted"><span className="w-5 text-center font-mono text-xs text-muted-foreground">0{rank}</span><span className="flex size-8 items-center justify-center rounded-full text-sm font-semibold text-white" style={{ backgroundColor: member.accent }}>{member.initials}</span><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{member.name}</span><span className="block text-xs text-muted-foreground">{member.group} · {member.team}</span></span><span className="text-sm font-semibold">{member.messages}</span><ChevronRight className="size-4 text-muted-foreground" /></Link>; }
function MessageRow({ message }: { message: (typeof demoMessages)[number] }) { return <div className="flex gap-3 py-3"><div className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"><span className="font-medium">{message.member}</span><Badge variant="outline" className="h-5 px-1.5 text-[10px]">{typeLabel[message.type]}</Badge><span className="text-muted-foreground">{message.time}</span></div><p className="mt-1 truncate text-sm text-muted-foreground">{message.text}</p></div></div>; }
function MemberCard({ member, locale }: { member: (typeof demoMembers)[number]; locale: string }) { return <Link href={`/${locale}/members/${member.id}`} className="group flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:border-foreground/30 hover:bg-muted/30"><span className="flex size-10 items-center justify-center rounded-full text-sm font-semibold text-white" style={{ backgroundColor: member.accent }}>{member.initials}</span><span className="min-w-0 flex-1"><span className="block font-medium">{member.name}</span><span className="block truncate text-xs text-muted-foreground">{member.group} · {member.team}</span></span><span className="text-right"><span className="block text-sm font-semibold">{member.messages}</span><span className="block text-[10px] text-muted-foreground">消息</span></span><ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" /></Link>; }
