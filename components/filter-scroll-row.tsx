"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Leva o chip selecionado (`[aria-current]`) para dentro da área visível da linha de
 * filtros, rolando só na horizontal. Mexe direto no `scrollLeft` da linha (nunca
 * `scrollIntoView`, que também rolaria a página), como o `inline: "nearest"`: só
 * rola se o chip estiver cortado, e para no gutter (o padding da linha). Exportada
 * para o teste (o jsdom não tem layout; o teste simula as caixas).
 */
export function revealActiveChip(row: HTMLElement): void {
  const chip = row.querySelector<HTMLElement>("[aria-current]");
  if (!chip) return;
  const rowBox = row.getBoundingClientRect();
  const chipBox = chip.getBoundingClientRect();
  const style = getComputedStyle(row);
  const padLeft = parseFloat(style.paddingLeft) || 0;
  const padRight = parseFloat(style.paddingRight) || 0;
  const hiddenRight = chipBox.right - (rowBox.right - padRight);
  const hiddenLeft = rowBox.left + padLeft - chipBox.left;
  if (hiddenRight > 0) {
    row.scrollLeft += hiddenRight;
  } else if (hiddenLeft > 0) {
    row.scrollLeft -= hiddenLeft;
  }
}

/**
 * Linha rolável de filtros da lista de jogos (#577). Em 390px o chip selecionado
 * (o intervalo "18/10 – 25/10") pode ficar fora da tela, e o
 * período não aparece em outro lugar: ao montar e a cada troca de filtro
 * (`activeKey`), a linha rola até ele. Os chips seguem vindo do servidor (`children`).
 */
export function FilterScrollRow({
  activeKey,
  className,
  children,
}: {
  // Muda quando o filtro muda (liga, período, datas): a linha não remonta na navegação.
  activeKey: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Layout effect: corrige a rolagem antes do próximo paint, sem pulo visível.
  useLayoutEffect(() => {
    if (ref.current) revealActiveChip(ref.current);
  }, [activeKey]);
  return (
    <div
      ref={ref}
      className={cn(
        "flex items-center gap-2 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}
