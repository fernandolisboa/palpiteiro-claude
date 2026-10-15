import { HelpHint } from "@/components/help-hint";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import type { MatchModelReadingView } from "@/lib/view/types";

// Bloco "Leitura do modelo" da página do jogo (#555, ADR 0052): a base do modelo do
// jogo (probabilidade e odd justa por mercado, placares mais prováveis, de onde veio o
// λ). Fora do MatchHero/PalpiteHero (firewall ADR 0030) e SEM odd da casa, edge, EV ou
// stake: a base não expõe valor (backtest de calibração, PR #558); o edge fica na
// análise do usuário, com o gate.

// Classe de grid estática por nº de seleções (Tailwind não interpola).
const GRID_COLS: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
};

type Props = {
  // Promise criada pela página (leitura do banco, sem chamada externa) e resolvida em
  // streaming. null = sem base calculada ainda (ou erro de leitura) → estado vazio.
  reading: Promise<MatchModelReadingView | null>;
};

export async function MatchModelReading({ reading }: Props) {
  return <MatchModelReadingCard view={await reading} />;
}

export function MatchModelReadingCard({
  view,
}: {
  view: MatchModelReadingView | null;
}) {
  return (
    <Card className="gap-0 overflow-hidden p-0" data-testid="match-model-reading">
      <div className="flex items-center justify-between px-4 pt-3.5 pb-3">
        <span className="flex items-center gap-1.5 text-body font-medium tracking-tight">
          Leitura do modelo
          <HelpHint
            anchor="leitura-modelo"
            label="leitura do modelo"
            blurb="Chance de cada resultado pelo modelo de placar do jogo, calculada sem olhar as odds. A odd justa é 100 ÷ probabilidade."
          />
        </span>
        {view && (
          <span className="font-mono text-meta text-muted-foreground">
            calculado {view.computedAgo}
          </span>
        )}
      </div>
      <Separator />
      {view ? (
        <>
          <p className="px-4 pt-3 text-body-sm tracking-tight text-muted-foreground">
            Probabilidade do modelo, sem odds: compare com a odd de mercado.
          </p>
          <div className="flex flex-col gap-4 px-4 py-3.5">
            {view.markets.map((m) => (
              <div key={m.key} className="flex flex-col gap-1.5">
                <span className="font-mono text-meta uppercase tracking-label text-muted-foreground">
                  {m.label}
                </span>
                <div
                  className={`grid ${GRID_COLS[m.selections.length] ?? "grid-cols-3"} gap-2`}
                >
                  {m.selections.map((s) => (
                    <div
                      key={s.label}
                      className="flex flex-col gap-0.5 rounded-md border border-border-subtle px-3 py-2"
                    >
                      <span className="text-meta tracking-tight text-muted-foreground">
                        {s.label}
                      </span>
                      <span className="font-mono text-label font-medium tabular-nums">
                        {s.pct}
                      </span>
                      <span className="font-mono text-meta tabular-nums text-muted-fg-2">
                        odd justa {s.fairOdd}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {view.topScorelines.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="font-mono text-meta uppercase tracking-label text-muted-foreground">
                  placares mais prováveis
                </span>
                <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-body-sm tabular-nums">
                  {view.topScorelines.map((s) => (
                    <span key={s.score}>
                      {s.score}{" "}
                      <span className="text-muted-foreground">· {s.pct}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 font-mono text-meta text-muted-fg-2">
            <span>
              modelo · {view.source}
              {view.jev ? ` ${view.jev}` : ""}
            </span>
          </div>
        </>
      ) : (
        <p className="px-4 py-3.5 text-body-sm tracking-tight text-muted-foreground">
          A leitura do modelo aparece aqui quando o cálculo do jogo rodar (a cada 6h,
          até 7 dias antes do jogo).
        </p>
      )}
    </Card>
  );
}

export function MatchModelReadingSkeleton() {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-center justify-between px-4 pt-3.5 pb-3">
        <Skeleton className="h-[16px] w-36" />
        <Skeleton className="h-[12px] w-24" />
      </div>
      <Separator />
      <div className="flex flex-col gap-3 px-4 py-3.5">
        <Skeleton className="h-[52px] w-full" />
        <Skeleton className="h-[52px] w-full" />
        <Skeleton className="h-[52px] w-full" />
      </div>
    </Card>
  );
}
