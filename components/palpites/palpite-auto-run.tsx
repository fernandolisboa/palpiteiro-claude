"use client";

import { useEffect, useRef } from "react";

import { generatePalpitesAction } from "@/app/actions/palpites";

/**
 * Dispara a auto-geração de palpites (#315) na montagem da página do jogo. ZERO UI
 * (retorna null — o painel/lista é #316). O guard de idempotência REAL é no servidor
 * (generatePalpitesAction → getPalpiteSetsForMatch); o `useRef` só evita o
 * double-fire do React StrictMode/Fast Refresh em dev. A action é fire-and-forget
 * (sempre { ok: true }), então não tratamos retorno nem erro aqui.
 *
 * Por que um child cliente e NÃO `void generatePalpites()` no Server Component: um
 * promise não-aguardado no render é morto pelo serverless quando a resposta retorna
 * (ADR 0028 §5). Chamar a server action no mount é o único caminho seguro.
 */
export function PalpiteAutoRun({ matchId }: { matchId: string }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    void generatePalpitesAction(matchId);
  }, [matchId]);
  return null;
}
