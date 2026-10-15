"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { PalpiteHero } from "@/components/palpites/palpite-hero";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const FULL_ANALYSIS_ID = "analise-completa";

type Props = Omit<ComponentProps<typeof PalpiteHero>, "expanded"> & {
  // A análise por mercado, montada no servidor (FullAnalysis). Fica num bloco IRMÃO do
  // HERO, nunca dentro do `section[aria-label=palpite]` (firewall da ADR 0030: a casca
  // quente não ganha número de valor).
  analysis: ReactNode;
  // Há algo para abrir: um palpite (narrativa inteira, ficha, fontes) ou uma análise.
  hasAnalysis: boolean;
};

/**
 * Palpite da IA compacto + "Ler análise completa" (#576). Fechado, o HERO mostra o
 * veredito, o placar, a confiança, as ações e a narrativa em 2 linhas. Aberto, o HERO
 * volta inteiro e a análise por mercado aparece logo abaixo, num nível só (sem acordeão
 * de acordeões). `hidden` em vez de desmontar: o texto fica no DOM e o estado não se perde.
 */
export function PalpiteArea({ analysis, hasAnalysis, ...hero }: Props) {
  const [open, setOpen] = useState(false);
  const canOpen = hero.heroPalpite !== null || hasAnalysis;
  return (
    <div className="flex flex-col gap-3">
      <PalpiteHero {...hero} expanded={open} />
      {canOpen && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start text-muted-foreground"
            aria-expanded={open}
            aria-controls={FULL_ANALYSIS_ID}
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronDown
              className={cn("size-3.5 transition-transform", open && "rotate-180")}
              aria-hidden
            />
            {open ? "Fechar análise completa" : "Ler análise completa"}
          </Button>
          <div
            id={FULL_ANALYSIS_ID}
            role="region"
            aria-label="Análise completa"
            hidden={!open}
          >
            {analysis}
          </div>
        </>
      )}
    </div>
  );
}
