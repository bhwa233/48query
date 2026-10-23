"use client";

import { Moon, Sun } from "lucide-react";
import { useHydrated } from "@/lib/use-hydrated";
import { useTheme } from "./theme-provider";
import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

export function ModeToggle({
  toggleLabel,
  themeLightLabel,
  themeDarkLabel,
  themeSystemLabel,
}: {
  toggleLabel: string;
  themeLightLabel: string;
  themeDarkLabel: string;
  themeSystemLabel: string;
}) {
  const { setTheme } = useTheme();
  const mounted = useHydrated();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon-sm" disabled={!mounted}>
          <Sun className="size-4 rotate-0 scale-100 dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute size-4 rotate-90 scale-0 dark:rotate-0 dark:scale-100" />
          <span className="sr-only">{toggleLabel}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")}>
          {themeLightLabel}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          {themeDarkLabel}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          {themeSystemLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
