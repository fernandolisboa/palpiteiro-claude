import { Dices } from "lucide-react";

import { auth } from "@/auth";
import { PalpiteRow } from "@/components/palpites/palpite-row";
import { PreviousPalpites } from "@/components/palpites/previous-palpites";
import { RegenButton } from "@/components/palpites/regen-button";
import { getPalpiteSetsForMatch } from "@/lib/db/queries/palpites";
import { toPalpitesView } from "@/lib/view/palpites";

/**
 * <PalpitesPanel/> (#316) — a "warm lane" do registro PLAYFUL, distinta do motor de
 * valor (cobalt). Server Component: auth()→userId, getPalpiteSetsForMatch→
 * toPalpitesView (que DESCARTA aiCall — nunca edge/stake/Yield/odds/custo, ADR 0028
 * §1). NÃO dispara async no render (o auto-run vive no PalpiteAutoRun client da page);
 * regen vai pelo RegenButton (único client). Ramifica os estados do PLAN §5:
 *  • empty (current === null) → linha muted + botão de geração (sem spinner — o
 *    auto-run é fire-and-forget; o botão é a recuperação do silent-fail).
 *  • populated → header + PalpiteRows + RegenButton; "anteriores" se previous>0.
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
        <EmptyState matchId={matchId} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            {view.current.lines.map((line) => (
              <PalpiteRow key={line.id} line={line} />
            ))}
          </div>
          <RegenButton matchId={matchId} />
          <PreviousPalpites sets={view.previous} />
        </div>
      )}
    </section>
  );
}

// Estado vazio (PLAN §5): ainda sem palpites (auto-run em voo ou silent-fail). Linha
// muted + o botão como recuperação (rótulo "gerar palpites"). Sem spinner dedicado.
function EmptyState({ matchId }: { matchId: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body-sm tracking-tight text-muted-foreground">
        ainda sem palpites pra esse jogo.
      </p>
      <RegenButton matchId={matchId} label="gerar palpites" />
    </div>
  );
}
