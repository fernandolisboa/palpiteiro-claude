import { Dices } from "lucide-react";

import { auth } from "@/auth";
import { PalpiteRow } from "@/components/palpites/palpite-row";
import { PreviousPalpites } from "@/components/palpites/previous-palpites";
import { getPalpiteSetsForMatch } from "@/lib/db/queries/palpites";
import { toPalpitesView } from "@/lib/view/palpites";

/**
 * <PalpitesPanel/> — a "warm lane" do registro PLAYFUL. Server Component: auth()→userId,
 * getPalpiteSetsForMatch→toPalpitesView (que DESCARTA aiCall — nunca edge/stake/Yield/
 * odds/custo). Lê os sets PERSISTIDOS; nenhuma geração aqui.
 *
 * Palpite-first (ADR 0030 / #353): o auto-run + o RegenButton pré-análise CAÍRAM (a
 * manchete agora é sintetizada DENTRO do analyzeBestBet). Este painel é INTERIM até o
 * #351 reescrever tudo em HERO — fica vazio até o 1º run de "Analisar todos os mercados":
 *  • empty (current === null) → linha muted (sem botão de geração — geração vive no botão
 *    de análise).
 *  • populated → header + PalpiteRows; "anteriores" se previous>0.
 *
 * Sem userId (defensivo — a page já garante sessão via middleware/redirect) → null.
 */
export async function PalpitesPanel({ matchId }: { matchId: string }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const sets = await getPalpiteSetsForMatch(matchId, userId);
  const view = toPalpitesView(sets);

  return (
    <section
      aria-label="palpites"
      className="flex flex-col gap-3 rounded-xl border border-palpite-border bg-palpite-soft/40 p-4 ring-1 ring-palpite-border/40"
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-palpite-soft px-2 py-0.5 font-mono text-eyebrow uppercase tracking-label text-palpite-strong-fg">
          <Dices className="size-3" aria-hidden />
          palpites · só por diversão
        </span>
      </div>

      {view.current === null ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            {view.current.lines.map((line) => (
              <PalpiteRow key={line.id} line={line} />
            ))}
          </div>
          <PreviousPalpites sets={view.previous} />
        </div>
      )}
    </section>
  );
}

// Estado vazio: ainda sem palpites. Linha muted — a geração agora vive no botão de
// análise ("Analisar todos os mercados"), não num botão próprio do painel (ADR 0030).
function EmptyState() {
  return (
    <p className="text-body-sm tracking-tight text-muted-foreground">
      ainda sem palpites pra esse jogo — analise o jogo pra gerar.
    </p>
  );
}
