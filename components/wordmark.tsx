import { cn } from "@/lib/utils";

/**
 * Marca única "palpiteiro" (ADR 0029), sem sufixo (ADR 0059, revisão de design linha
 * 25): o tipo não aceita sufixo, pra nenhum tagline voltar no header do app, no login
 * ou na landing.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-baseline", className)}>
      <span className="text-display-sm font-semibold tracking-tight">
        palpiteiro
      </span>
    </span>
  );
}
