import { Badge } from "@/components/ui/badge";
import type { ClaimStatus } from "@/lib/user-palpite/types";
import type { AnalysisUserContextView } from "@/lib/view/analysis-user-context";

// "O que você acrescentou" (#565): o contexto extra conferido da análise com IA, no topo
// de "ver análise por mercado". Só leitura; o texto do usuário não vai pra análise.

const STATUS_BADGE: Record<ClaimStatus, "secondary" | "destructive" | "outline"> = {
  confirmed: "secondary",
  contradicted: "destructive",
  unverifiable: "outline",
};

export function AnalysisUserContext({ view }: { view: AnalysisUserContextView }) {
  return (
    <section
      aria-label="o que você acrescentou"
      data-testid="analysis-user-context"
      className="flex flex-col gap-2.5 rounded-md border border-border px-4 py-3.5"
    >
      <span className="font-mono text-meta uppercase tracking-label text-muted-foreground">
        o que você acrescentou · {view.createdAgo}
      </span>
      <ul className="flex flex-col gap-2.5">
        {view.claims.map((c) => (
          <li key={c.index} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={STATUS_BADGE[c.status]} size="xs">
                {c.statusLabel}
              </Badge>
              <span className="text-body-sm tracking-tight">{c.text}</span>
            </div>
            <span className="text-meta tracking-tight text-muted-foreground">
              {c.evidence}
            </span>
            <span className="font-mono text-meta text-muted-fg-2">{c.effect}</span>
          </li>
        ))}
      </ul>
      {view.showUnverifiedNote && (
        <p className="text-meta leading-relaxed tracking-tight text-muted-foreground">
          Não verificável: não temos esse dado; entrou com peso menor.
        </p>
      )}
      <p className="text-meta leading-relaxed tracking-tight text-muted-fg-2">
        O texto que você escreveu não vai pra análise; ela guarda só as afirmações conferidas.
      </p>
    </section>
  );
}
