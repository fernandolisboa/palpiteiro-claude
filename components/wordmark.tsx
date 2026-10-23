import { BrandSymbol } from "@/components/brand/brand-mark";
import { cn } from "@/lib/utils";

/**
 * Marca única "palpiteiro" (ADR 0029), sem sufixo (ADR 0059, revisão de design linha
 * 25): o tipo não aceita sufixo, pra nenhum tagline voltar no header do app, no login
 * ou na landing. O símbolo (ADR 0067) vem sempre junto, à esquerda.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <BrandSymbol className="size-6" />
      <span className="text-display-sm font-semibold tracking-tight">
        palpiteiro
      </span>
    </span>
  );
}
