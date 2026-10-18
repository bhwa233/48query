import Link from "next/link";
import type { HTMLAttributes, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

type AppPageWidth = "wide" | "content" | "narrow";
type AppPageVariant = "marketing" | "workspace";
type PageSectionSpacing = "none" | "sm" | "md";

const APP_PAGE_WIDTH_CLASSNAMES: Record<AppPageWidth, string> = {
  wide: "max-w-[92rem]",
  content: "max-w-6xl",
  narrow: "max-w-5xl",
};

const APP_PAGE_VARIANT_CLASSNAMES: Record<AppPageVariant, string> = {
  marketing: "gap-8 py-8 sm:py-10 lg:gap-10",
  workspace: "min-h-0 gap-4 py-4 sm:gap-6 sm:py-6",
};

const PAGE_SECTION_SPACING_CLASSNAMES: Record<PageSectionSpacing, string> = {
  none: "",
  sm: "space-y-3",
  md: "space-y-4",
};

interface AppPageContainerProps extends HTMLAttributes<HTMLElement> {
  as?: "div" | "main" | "section";
  children: ReactNode;
  padded?: boolean;
  variant?: AppPageVariant;
  width?: AppPageWidth;
}

interface SectionIntroProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  className?: string;
  titleClassName?: string;
  descriptionClassName?: string;
}

interface PagePanelProps {
  as?: "div" | "section";
  children: ReactNode;
  className?: string;
}

interface PageSectionProps {
  as?: "div" | "section";
  children: ReactNode;
  className?: string;
  id?: string;
  spacing?: PageSectionSpacing;
}

interface WorkspaceSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function AppPageContainer({
  as: Component = "main",
  children,
  className,
  padded = true,
  variant = "marketing",
  width = "wide",
  ...props
}: AppPageContainerProps) {
  return (
    <Component
      {...props}
      className={cn(
        "mx-auto flex min-h-full w-full flex-1 flex-col",
        APP_PAGE_WIDTH_CLASSNAMES[width],
        APP_PAGE_VARIANT_CLASSNAMES[variant],
        // Matches the site header and footer gutters so page content lines up
        // with the wordmark instead of sitting closer to the viewport edge.
        // The `.page-shell` CSS class in globals.css mirrors these values.
        padded ? "px-4 sm:px-6 lg:px-8" : null,
        className,
      )}
    >
      {children}
    </Component>
  );
}

export function SectionIntro({
  eyebrow,
  title,
  description,
  className,
  titleClassName,
  descriptionClassName,
}: SectionIntroProps) {
  return (
    <div className={cn("space-y-3", className)}>
      {typeof eyebrow === "string" ? (
        <Badge
          variant="outline"
          className="w-fit rounded-full px-3 py-1 text-xs uppercase tracking-[0.24em]"
        >
          {eyebrow}
        </Badge>
      ) : (
        eyebrow
      )}
      <div className="space-y-3">
        <div
          className={cn(
            "text-4xl font-semibold tracking-tight text-foreground sm:text-5xl",
            titleClassName,
          )}
        >
          {title}
        </div>
        {description ? (
          <div
            className={cn(
              "max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg",
              descriptionClassName,
            )}
          >
            {description}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function PageSection({
  as: Component = "section",
  children,
  className,
  id,
  spacing = "md",
}: PageSectionProps) {
  return (
    <Component
      id={id}
      className={cn(PAGE_SECTION_SPACING_CLASSNAMES[spacing], className)}
    >
      {children}
    </Component>
  );
}

export function PagePanel({
  as: Component = "section",
  children,
  className,
}: PagePanelProps) {
  return (
    <Component
      className={cn(
        "rounded-3xl border border-border/70 bg-card/70 p-6 shadow-sm sm:p-8",
        className,
      )}
    >
      {children}
    </Component>
  );
}

export function WorkspaceSurface({
  children,
  className,
  ...props
}: WorkspaceSurfaceProps) {
  return (
    <div
      {...props}
      className={cn(
        "isolate flex min-h-0 w-full flex-1 overflow-hidden rounded-xl border border-border/70 bg-card text-card-foreground shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Composite marketing-page building blocks
 * These combine the low-level primitives above into reusable patterns shared
 * across every product use-cases / landing page.
 * --------------------------------------------------------------------------- */

interface FaqSectionProps {
  title: string;
  description?: string;
  items: ReadonlyArray<{ question: string; answer: string }>;
}

export function FaqSection({ title, description, items }: FaqSectionProps) {
  return (
    <PageSection id="faq">
      <SectionIntro
        title={
          <h2 className="text-3xl font-semibold tracking-tight">{title}</h2>
        }
        description={description}
        className="space-y-2"
        titleClassName="text-3xl font-semibold tracking-tight"
        descriptionClassName="max-w-3xl text-base"
      />
      <div className="grid gap-4">
        {items.map((item) => (
          <Card key={item.question} className="border-border/70">
            <CardHeader className="space-y-2">
              <CardTitle className="text-xl">{item.question}</CardTitle>
              <CardDescription className="text-sm leading-6">
                {item.answer}
              </CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </PageSection>
  );
}

interface CtaFooterPanelProps {
  title: string;
  description?: string;
  actions: ReadonlyArray<{
    label: string;
    href: string;
    variant?: "default" | "outline";
  }>;
}

export function CtaFooterPanel({
  title,
  description,
  actions,
}: CtaFooterPanelProps) {
  return (
    <PagePanel>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <SectionIntro
          title={
            <h2 className="max-w-3xl text-3xl font-semibold tracking-tight">
              {title}
            </h2>
          }
          description={description}
          descriptionClassName="max-w-2xl text-base"
        />
        <div className="flex flex-col gap-3 sm:flex-row">
          {actions.map((action) => (
            <Button
              key={action.href}
              asChild
              size="lg"
              variant={action.variant ?? "default"}
            >
              <Link href={action.href}>{action.label}</Link>
            </Button>
          ))}
        </div>
      </div>
    </PagePanel>
  );
}

interface CardGridItem {
  title: string;
  description: string;
}

interface CardGridSectionProps {
  id?: string;
  title?: string;
  description?: string;
  items: ReadonlyArray<CardGridItem>;
  columns?: 2 | 3 | 4;
  spacing?: PageSectionSpacing;
}

const CARD_GRID_COLUMN_CLASSNAMES: Record<number, string> = {
  2: "md:grid-cols-2",
  3: "md:grid-cols-2 xl:grid-cols-3",
  4: "md:grid-cols-2 xl:grid-cols-4",
};

export function CardGridSection({
  id,
  title,
  description,
  items,
  columns = 3,
  spacing = "md",
}: CardGridSectionProps) {
  const gridClassName =
    CARD_GRID_COLUMN_CLASSNAMES[columns] ?? CARD_GRID_COLUMN_CLASSNAMES[3];

  return (
    <PageSection id={id} spacing={title ? spacing : "none"}>
      {title ? (
        <SectionIntro
          title={
            <h2 className="text-3xl font-semibold tracking-tight">{title}</h2>
          }
          description={description}
          className="space-y-2"
          titleClassName="text-3xl font-semibold tracking-tight"
          descriptionClassName="max-w-3xl text-base"
        />
      ) : null}
      <div className={cn("grid gap-4", gridClassName)}>
        {items.map((item) => (
          <Card key={item.title} className="border-border/70">
            <CardHeader className="space-y-2">
              <CardTitle className="text-xl">{item.title}</CardTitle>
              <CardDescription className="text-sm leading-6">
                {item.description}
              </CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </PageSection>
  );
}
