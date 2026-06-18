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
 * (desktop-shell, page-header, signin). O TEXTO de cada sufixo segue verbatim
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
            "font-mono text-eyebrow tracking-eyebrow text-muted-fg-2 uppercase",
            suffixClassName
          )}
        >
          {suffix}
        </span>
      )}
    </span>
  );
}
