"use client";

import Link from "next/link";

import { GLOSSARY } from "@/components/help/glossary";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * Dica inline de ajuda: um `?` neutro e focável que abre um Popover com uma
 * explicação curta + link "saiba mais" pro `/como-funciona#<anchor>`.
 *
 * O `anchor` é o contrato (componentes/help/glossary.ts): cada hint linka pro
 * `id` real renderizado pela página da #148. Popover (não Tooltip) porque o
 * conteúdo segura um link tocável e abre no tap no mobile.
 *
 * Restrições pinadas por teste (analysis-scenarios.test): o trigger NÃO usa
 * Button ghost/outline (que embutem `hover:text-accent-foreground`) — é um
 * `<button>` próprio com classes neutras, SEM nenhuma substring `accent-`/`edge-`.
 */
export type HelpHintProps = {
  /** Slug kebab-case existente em GLOSSARY; alvo do deep-link `#<anchor>`. */
  anchor: string;
  /** Texto curto que nomeia o conceito; usado no `aria-label` do `?`. */
  label: string;
  /** Explicação curta exibida no Popover (versão enxuta do `meaning`). */
  blurb: string;
};

export function HelpHint({ anchor, label, blurb }: HelpHintProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Ajuda: ${label}`}
          className="inline-flex size-[15px] shrink-0 items-center justify-center rounded-full border border-border-subtle font-mono text-[9px] leading-none text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          ?
        </button>
      </PopoverTrigger>
      <PopoverContent className="flex flex-col gap-2">
        <p className="text-[12px] leading-snug tracking-tight text-foreground">
          {blurb}
        </p>
        <Link
          href={`/como-funciona#${anchor}`}
          className="font-mono text-[11px] tracking-tight text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          saiba mais
        </Link>
      </PopoverContent>
    </Popover>
  );
}

/** True se `anchor` é um membro real de GLOSSARY (contrato dos deep-links). */
export function isGlossaryAnchor(anchor: string): boolean {
  return GLOSSARY.some((entry) => entry.anchor === anchor);
}
