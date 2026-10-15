import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type Props = {
  /** Sufixo mono opcional (ex.: "· v0"). O texto é content — passado verbatim. */
  suffix?: ReactNode;
  className?: string;
  suffixClassName?: string;
};

/**
 * Marca única "palpiteiro" + sufixo mono opcional (ADR 0029). Unifica os 3
 * tamanhos (17/18/20px → display-sm) e formas de sufixo divergentes do shell
 * (header do app, signin, landing). O TEXTO de cada sufixo segue verbatim
 * (o tagline obsoleto do signin é copy — fica pro #323).
 */
export function Wordmark({ suffix, className, suffixClassName }: Props) {
  return (
    <span className={cn("flex items-baseline gap-2", className)}>
      <span className="text-display-sm font-semibold tracking-tight">
        palpiteiro
      </span>
      {suffix != null && (
        <span
          className={cn(
            "text-meta tracking-eyebrow text-muted-foreground uppercase",
            suffixClassName
          )}
        >
          {suffix}
        </span>
      )}
    </span>
  );
}
