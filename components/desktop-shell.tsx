import type { ReactNode } from "react";

import { Separator } from "@/components/ui/separator";
import { TeamAvatar } from "@/components/team-avatar";
import { ThemeToggle } from "@/components/theme-toggle";

export function DesktopShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-foreground">
      <header className="flex h-14 items-center justify-between border-b border-border-subtle px-8">
        <div className="flex items-baseline gap-3">
          <span
            className="font-semibold tracking-tight"
            style={{ fontSize: 17, letterSpacing: "-0.04em" }}
          >
            palpiteiro
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-fg-2">
            v0 · over/under 2.5
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            ROI 30d <span className="text-edge-fg">+4.2%</span>
          </span>
          <Separator orientation="vertical" className="!h-4" />
          <div className="flex items-center gap-2">
            <TeamAvatar initials="GU" hue={258} size={26} />
            <span className="text-[12.5px] tracking-tight">gustavo</span>
          </div>
          <ThemeToggle />
        </div>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}
