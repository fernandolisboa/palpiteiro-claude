"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TOUR_TAB_EVENT } from "@/lib/tour/steps";
import {
  DEFAULT_MATCH_TAB,
  isMatchTab,
  MATCH_TAB_IDS,
  MATCH_TAB_PARAM,
  parseMatchTab,
  type MatchTab,
} from "@/lib/view/match-tabs";

// Abas da página do jogo (#576): Mercados / Seu palpite / Dados. Os três painéis ficam
// SEMPRE montados (forceMount): o estado da tabela e do "Seu palpite" não se perde ao
// trocar, o conteúdo streama uma vez só e o tour acha os alvos no DOM. O painel inativo
// leva o atributo `hidden` (vem depois do `hidden={false}` que o Radix passa com
// forceMount, então vence): sai da árvore de acessibilidade e o preflight do Tailwind
// esconde. A aba vai pra URL com replaceState (sem navegação de servidor: a página é
// dinâmica e refaria auth, banco e o refresh de odds; o Voltar sai do jogo).
// O tour troca de aba pelo evento TOUR_TAB_EVENT, disparado num clique ou timer (fora de
// efeito): o flushSync deixa o painel visível antes de o tour procurar o alvo.

function writeTabToUrl(tab: MatchTab) {
  const url = new URL(window.location.href);
  if (tab === DEFAULT_MATCH_TAB) url.searchParams.delete(MATCH_TAB_PARAM);
  else url.searchParams.set(MATCH_TAB_PARAM, tab);
  window.history.replaceState(null, "", url);
}

// Rótulos literais aqui de propósito: o guia /como-usar confere que eles existem na UI.
const TAB_LABEL: Record<MatchTab, string> = {
  mercados: "Mercados",
  "seu-palpite": "Seu palpite",
  dados: "Dados",
};

type Props = {
  initialTab: MatchTab;
  mercados: ReactNode;
  seuPalpite: ReactNode;
  dados: ReactNode;
};

export function MatchTabs({ initialTab, mercados, seuPalpite, dados }: Props) {
  const [tab, setTab] = useState<MatchTab>(initialTab);

  const select = useCallback((value: string) => {
    const next = parseMatchTab(value);
    setTab(next);
    writeTabToUrl(next);
  }, []);

  useEffect(() => {
    const onTourTab = (event: Event) => {
      const next = (event as CustomEvent<unknown>).detail;
      if (!isMatchTab(next)) return;
      flushSync(() => setTab(next));
      writeTabToUrl(next);
    };
    window.addEventListener(TOUR_TAB_EVENT, onTourTab);
    return () => window.removeEventListener(TOUR_TAB_EVENT, onTourTab);
  }, []);

  // Painel com scroll-mt-28: o scrollIntoView (tour, "Ler análise completa") não para
  // com o topo debaixo do cabeçalho (h-14) + a barra de abas fixa.
  const panel = "scroll-mt-28";

  return (
    <Tabs value={tab} onValueChange={select} activationMode="automatic" className="gap-4">
      <div className="sticky top-14 z-30 -mx-5 bg-background/95 px-5 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:mx-0 lg:px-0">
        <TabsList aria-label="Seções do jogo" className="grid w-full grid-cols-3">
          {MATCH_TAB_IDS.map((id) => (
            <TabsTrigger key={id} value={id}>
              {TAB_LABEL[id]}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <TabsContent
        value="mercados"
        forceMount
        hidden={tab !== "mercados"}
        data-tour="mercados"
        className={panel}
      >
        {mercados}
      </TabsContent>
      <TabsContent
        value="seu-palpite"
        forceMount
        hidden={tab !== "seu-palpite"}
        data-tour="seu-palpite"
        className={panel}
      >
        {seuPalpite}
      </TabsContent>
      <TabsContent
        value="dados"
        forceMount
        hidden={tab !== "dados"}
        data-tour="match-stats"
        className={panel}
      >
        {dados}
      </TabsContent>
    </Tabs>
  );
}
