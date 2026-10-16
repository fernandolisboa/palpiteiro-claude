"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { PalpiteHero } from "@/components/palpites/palpite-hero";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const FULL_ANALYSIS_ID = "analise-completa";
export const FULL_ANALYSIS_TITLE_ID = "analise-completa-titulo";

type Props = Omit<ComponentProps<typeof PalpiteHero>, "expanded"> & {
  // A análise por mercado, montada no servidor (FullAnalysis). Fica num bloco IRMÃO do
  // HERO, nunca dentro do `section[aria-label=palpite]` (firewall da ADR 0030: a casca
  // quente não ganha número de valor).
  analysis: ReactNode;
  // Há análise salva (pré-jogo ou ao vivo) para abrir, em qualquer fase. Diferente de
  // `hasAnalyses`, que é o portão do "Gerar só o palpite" (só as análises da fase de
  // agora): depois do apito sem leitura ao vivo, a análise de pré-jogo segue legível.
  canOpenAnalysis: boolean;
};

/**
 * Palpite da IA compacto + "Ler análise completa" (#576). Fechado, o HERO mostra o
 * veredito, o placar, a confiança, as ações e a narrativa em 2 linhas. Aberto, o HERO
 * volta inteiro e a análise por mercado aparece logo abaixo, num nível só (sem acordeão
 * de acordeões). `hidden` em vez de desmontar: o texto fica no DOM e o estado não se perde.
 */
export function PalpiteArea({ analysis, canOpenAnalysis, ...hero }: Props) {
  const [open, setOpen] = useState(false);
  // Há algo para abrir: um palpite (narrativa inteira, ficha, fontes) ou uma análise.
  const canOpen = hero.heroPalpite !== null || canOpenAnalysis;
  return (
    <div className="flex flex-col gap-3">
      <PalpiteHero {...hero} expanded={open} />
      {canOpen && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground self-start"
            aria-expanded={open}
            aria-controls={FULL_ANALYSIS_ID}
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronDown
              className={cn(
                "size-3.5 transition-transform",
                open && "rotate-180"
              )}
              aria-hidden
            />
            {open ? "Fechar análise completa" : "Ler análise completa"}
          </Button>
          <div
            id={FULL_ANALYSIS_ID}
            role="region"
            aria-labelledby={FULL_ANALYSIS_TITLE_ID}
            hidden={!open}
          >
            <h2 id={FULL_ANALYSIS_TITLE_ID} className="sr-only">
              Análise completa
            </h2>
            {analysis}
          </div>
        </>
      )}
    </div>
  );
}
