import { PalpiteRow } from "@/components/palpites/palpite-row";
import { formatGeneratedAtSeconds } from "@/lib/format";
import type { PalpiteSetView } from "@/lib/view/palpites";

/**
 * "palpites anteriores" — lista PLANA SEMPRE-VISÍVEL (PLAN §0.2 / §4). DIVERGE
 * deliberadamente de PreviousAnalyses/MatchCollapsible: SEM chevron, SEM
 * defaultOpen, SEM estado open/close, SEM Collapsible. Register mais quieto
 * (surface-2), cada set separado por border-t border-border-subtle, com um eyebrow
 * muted (tempo absoluto). Vazio → não renderiza (o painel só monta com previous.length>0).
 */
export function PreviousPalpites({ sets }: { sets: PalpiteSetView[] }) {
  if (sets.length === 0) return null;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-2 px-4 py-3.5">
      <span className="font-mono text-eyebrow uppercase tracking-label text-muted-fg-2">
        palpites anteriores
      </span>
      <div className="flex flex-col">
        {sets.map((set, i) => (
          <div
            key={set.id}
            className={
              i === 0
                ? "flex flex-col gap-2.5"
                : "mt-3 flex flex-col gap-2.5 border-t border-border-subtle pt-3"
            }
          >
            <span className="font-mono text-eyebrow-xs tabular-nums text-muted-fg-2">
              {formatGeneratedAtSeconds(set.generatedAt)}
            </span>
            {set.lines.map((line) => (
              <PalpiteRow key={line.id} line={line} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
