"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, ImageIcon, MessagesSquare, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { archiveLabels } from "./ArchiveData";

export function ArchiveNavigation({ locale }: { locale: string }) {
  const pathname = usePathname();
  const t = archiveLabels(locale);
  const links = [
    { href: `/${locale}`, label: t.rankNavigation, icon: BarChart3 },
    { href: `/${locale}/members`, label: t.members, icon: Users },
    { href: `/${locale}/messages`, label: t.messages, icon: MessagesSquare },
    { href: `/${locale}/images`, label: t.images, icon: ImageIcon },
  ];

  return <div className="flex w-full items-center gap-1 sm:w-auto">{links.map(({ href, label, icon: Icon }) => (
    <Button key={href} asChild variant="ghost" size="sm" className="archive-nav-link flex-1 sm:flex-none">
      <Link href={href} aria-current={pathname === href || (href !== `/${locale}` && pathname.startsWith(`${href}/`)) ? "page" : undefined}><Icon data-icon="inline-start" className="hidden sm:block" aria-hidden="true" />{label}</Link>
    </Button>
  ))}</div>;
}
