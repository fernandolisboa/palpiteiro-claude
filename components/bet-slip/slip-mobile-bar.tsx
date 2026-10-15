"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Ticket } from "lucide-react";

import { useBetSlip } from "@/components/bet-slip/bet-slip-provider";
import { SlipPanel } from "@/components/bet-slip/slip-panel";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

// Celular (< lg): "Suas apostas" numa barra fixa no rodapé que abre o painel numa folha.
// O par lg:hidden / hidden lg:block da página mora aqui e no SlipAside, não em page.tsx
// (single-tree.test.ts): é o mesmo painel, com um estado só, em dois lugares.

// Altura da barra = borda (1px) + pt-3 + botão h-9 + pb (12px ou a área segura do
// aparelho, o que for maior). O espaçador abaixo usa a MESMA conta.
const BAR =
  "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:hidden";
const BAR_CLEARANCE =
  "h-[calc(3.0625rem+max(0.75rem,env(safe-area-inset-bottom)))] lg:hidden";

const DESKTOP_QUERY = "(min-width: 1024px)";

export function SlipMobileBar() {
  const slip = useBetSlip();
  const sheetOpen = slip?.sheetOpen ?? false;
  const setSheetOpen = slip?.setSheetOpen;

  // A folha é só do celular: se a tela cruza pro desktop com ela aberta (girou o
  // tablet, esticou a janela), fecha; o painel já está na coluna.
  useEffect(() => {
    if (!sheetOpen || !setSheetOpen) return;
    const mq = window.matchMedia?.(DESKTOP_QUERY);
    if (!mq) return;
    if (mq.matches) {
      setSheetOpen(false);
      return;
    }
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setSheetOpen(false);
    };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [sheetOpen, setSheetOpen]);

  if (!slip) return null;
  const count = slip.legs.length;
  const visible = count > 0 || slip.registerState !== null;

  return (
    <>
      {visible && (
        <div className={BAR}>
          <Button className="w-full" onClick={() => slip.setSheetOpen(true)}>
            <Ticket className="size-4" aria-hidden />
            {count > 0 ? `Suas apostas (${count})` : "Ver avaliação"}
          </Button>
        </div>
      )}
      {/* Espaço pra barra não cobrir o fim da página: no fim do <body> (depois do
          rodapé), com a altura exata da barra. Só existe no cliente, depois de a lista
          ganhar uma seleção (no SSR a barra nunca aparece). */}
      {visible &&
        createPortal(<div aria-hidden className={BAR_CLEARANCE} />, document.body)}
      <Sheet open={slip.sheetOpen} onOpenChange={slip.setSheetOpen}>
        <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto p-0">
          <SheetHeader className="pb-0">
            <SheetTitle>Suas apostas</SheetTitle>
            <SheetDescription>
              Ajuste a odd que você pegou e registre. A avaliação sai na hora.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">
            <SlipPanel />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
