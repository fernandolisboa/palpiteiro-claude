import { MobileNav } from "@/components/mobile-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";

type Props = {
  subtitle?: string;
  /**
   * Mostra o link de admin no drawer. Opcional/`false` por padrão pra que
   * `loading.tsx`/`error.tsx` (sem sessão em escopo) sigam compilando e renderem
   * o menu só com jogos/dashboard.
   */
  isAdmin?: boolean;
};

export function PageHeader({ subtitle, isAdmin = false }: Props) {
  return (
    <header className="px-5 pt-6 pb-4">
      <div className="flex items-center justify-between">
        {/* Hambúrguer à esquerda da marca; toggle de tema fica à direita
            (sempre visível, um toque). Mantém o header limpo em ≤430px. */}
        <div className="flex items-center gap-1.5">
          <MobileNav isAdmin={isAdmin} />
          {/* nbsp entre "·" e "v0" pra não quebrar linha (paridade com o &nbsp; original) */}
          <Wordmark suffix={"· v0"} />
        </div>
        <div className="flex items-center gap-2">
          {subtitle && (
            <span className="font-mono text-eyebrow text-muted-foreground">
              {subtitle}
            </span>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
