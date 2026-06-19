import { EmptyState } from "@/components/empty-state";
import { FormDot } from "@/components/form-dot";
import type { FormView } from "@/lib/view/types";

type Props = {
  view: FormView;
};

export function FormSection({ view }: Props) {
  const hasData =
    view.home.results.length > 0 || view.away.results.length > 0;
  if (!hasData) {
    return (
      <EmptyState className="py-6" title="Sem jogos recentes disponíveis." />
    );
  }
  return (
    <div className="flex flex-col gap-3.5">
      {[view.home, view.away].map((r) => (
        <div key={r.name} className="flex items-center justify-between">
          <span className="text-body-sm text-foreground tracking-tight">
            {r.name}
          </span>
          <div className="flex items-center gap-1.5">
            {r.results.length === 0 ? (
              <span className="font-mono text-eyebrow text-muted-fg-2">
                sem histórico
              </span>
            ) : (
              // Cronológico: mais ANTIGO à esquerda, mais RECENTE à direita (convenção de
              // form guide). `results` vem most-recent-first do builder → invertemos só na
              // EXIBIÇÃO (cópia; não afeta o dado nem o input da síntese).
              [...r.results]
                .reverse()
                .map((res, i) => <FormDot key={i} r={res} />)
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
