import { cn } from "@/lib/utils";

// O §3 do registro de apostas (ADR 0034 §12, docs/ops/05-legal-compliance.md §3),
// VERBATIM. Cópia local de propósito: o componente vai pro bundle do cliente e não puxa
// módulos de servidor; bet-slip-guards.test.ts confere que não driftou. Uma vez por tela
// visível (ADR 0057 item 1): no painel Suas apostas e, só no celular, abaixo das abas.
const RISK_DISCLAIMER_PT_BR =
  "Aposta não é investimento. As recomendações do Palpiteiro são análises e não garantem resultado. Aposte com responsabilidade, só o que você pode perder, e nunca para recuperar perdas. Se a aposta deixou de ser diversão, procure ajuda.";

/** O §3 dentro do painel Suas apostas (coluna no desktop, folha no celular). */
export function SlipRiskNotice({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "text-meta leading-relaxed text-muted-foreground tracking-tight",
        className,
      )}
    >
      {RISK_DISCLAIMER_PT_BR}
    </p>
  );
}

/**
 * Celular: o painel fica numa folha modal que cobre a página, então o §3 fica também à
 * vista na página, abaixo das abas. No desktop o painel com o §3 está ao lado.
 */
export function SlipMobileRiskNotice() {
  return <SlipRiskNotice className="lg:hidden" />;
}
