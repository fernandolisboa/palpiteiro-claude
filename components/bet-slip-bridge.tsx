"use client";

import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";

import { MAX_SLIP_SELECTIONS } from "@/lib/bets/slip-markets";
import type { BridgeLeg } from "@/lib/user-palpite/types";

// Ponte entre o "Seu palpite" e a lista "Suas apostas" (#564): o BetSlip registra um
// handler e o "Seu palpite" manda uma perna por ele, sem mexer no estado do BetSlip.
// Um provider por árvore (a página monta celular e desktop), então cada bloco fala com
// o próprio BetSlip. Fora do provider o hook devolve null e o BetSlip segue como antes.

// Aviso de lista cheia: o mesmo texto no BetSlip e no "Seu palpite".
export const slipFullNotice = `No máximo ${MAX_SLIP_SELECTIONS} seleções por vez.`;

// O que o BetSlip fez com a perna: entrou, já estava na lista, ou a lista está cheia.
export type BridgeAddOutcome = "added" | "duplicate" | "full";

export type BetSlipBridge = {
  register(handler: (leg: BridgeLeg) => BridgeAddOutcome): () => void;
  // "unavailable" = nenhum BetSlip registrado ainda (a grade ainda está em streaming).
  add(leg: BridgeLeg): BridgeAddOutcome | "unavailable";
};

const BridgeContext = createContext<BetSlipBridge | null>(null);

export function BetSlipBridgeProvider({ children }: { children: ReactNode }) {
  const handler = useRef<((leg: BridgeLeg) => BridgeAddOutcome) | null>(null);
  const value = useMemo<BetSlipBridge>(
    () => ({
      register(h) {
        handler.current = h;
        return () => {
          if (handler.current === h) handler.current = null;
        };
      },
      add(leg) {
        if (!handler.current) return "unavailable";
        return handler.current(leg);
      },
    }),
    [],
  );
  return <BridgeContext.Provider value={value}>{children}</BridgeContext.Provider>;
}

export function useBetSlipBridge(): BetSlipBridge | null {
  return useContext(BridgeContext);
}
