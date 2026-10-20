import type { ReactNode } from "react";
import { AppPageContainer } from "@/components/app-page-shell";

export function ArchivePageShell({ title, children }: { title?: string; children: ReactNode }) {
  return <AppPageContainer variant="workspace" width="content" className="gap-3 py-3 sm:gap-4 sm:py-4">
    {title ? <header><h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1></header> : null}
    {children}
  </AppPageContainer>;
}

export function ArticlePageShell({ children }: { children: ReactNode }) {
  return <AppPageContainer variant="workspace" width="narrow" className="gap-3 py-3 sm:py-4">
    <article className="mx-auto w-full max-w-3xl">{children}</article>
  </AppPageContainer>;
}
