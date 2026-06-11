"use client";

import { ChevronRight } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { GLOSSARY } from "@/components/help/glossary";

/**
 * Glossário expansível: cada entrada é um `Collapsible` (primitivo existente —
 * sem Accordion/Tabs). O `id={anchor}` vive no elemento externo de cada item,
 * com `scroll-mt-20` pra folga nos deep-links (header não-sticky). Term = trigger,
 * meaning = content. Único trecho client da página `/como-funciona`.
 */
export function GlossarySection() {
  return (
    <ul className="flex flex-col">
      {GLOSSARY.map((entry) => (
        <li
          key={entry.anchor}
          id={entry.anchor}
          className="border-border scroll-mt-20 border-t"
        >
          <Collapsible>
            <CollapsibleTrigger className="group flex w-full items-center gap-2 py-3 text-left">
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
              <span className="text-[14px] font-medium tracking-tight">
                {entry.term}
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <p className="pb-3 pl-[22px] pr-2 text-[13px] leading-relaxed text-muted-foreground tracking-tight">
                {entry.meaning}
              </p>
            </CollapsibleContent>
          </Collapsible>
        </li>
      ))}
    </ul>
  );
}
