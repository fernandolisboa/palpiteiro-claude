"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

type Props = {
  title: string;
  meta?: string;
  defaultOpen?: boolean;
  children?: ReactNode;
};

export function MatchCollapsible({ title, meta, defaultOpen = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-3.5 text-left transition-colors hover:bg-surface-2">
          <span className="flex items-center gap-2 text-[13px] font-medium tracking-tight">
            <span className="text-muted-fg-2">
              <ChevronRight
                className={cn("size-3.5 transition-transform", open && "rotate-90")}
              />
            </span>
            {title}
          </span>
          {meta && (
            <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
              {meta}
            </span>
          )}
        </CollapsibleTrigger>
        {children && (
          <CollapsibleContent>
            <Separator />
            <div className="px-4 py-4">{children}</div>
          </CollapsibleContent>
        )}
      </Collapsible>
    </Card>
  );
}
