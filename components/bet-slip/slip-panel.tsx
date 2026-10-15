"use client";

import { X } from "lucide-react";

import { useBetSlip } from "@/components/bet-slip/bet-slip-provider";
import { SlipRiskNotice } from "@/components/bet-slip/risk-notice";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatOdd, formatPct } from "@/lib/format-number";
import { cn } from "@/lib/utils";
import type {
  EvaluatedComboView,
  EvaluatedLegView,
  SlipEvaluationView,
} from "@/lib/view/bet-slip";

// Painel "Suas apostas" (Fase 2, #556): a lista, o registro e a avaliação. Sem estado
// próprio (#576): lê o BetSlipProvider, então a coluna do desktop e a folha do celular
// mostram a mesma lista. O app REGISTRA a aposta feita em outro lugar: nunca "Apostar",
// nunca link ou nome de casa como destino (ADR 0034 §12, ADR 0048).

/** Desktop: o painel numa coluna fixa ao lado das abas (fora delas, à vista em todas). */
export function SlipAside() {
  return (
    <aside aria-label="Suas apostas" className="hidden lg:sticky lg:top-20 lg:block">
      <SlipPanel />
    </aside>
  );
}

// ── Suas apostas (lista + registro + avaliação) ─────────────────────────────

const INPUT =
  "w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-body-sm tabular-nums focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function SlipPanel() {
  const slip = useBetSlip();
  if (!slip) return null;
  const { legs, mode } = slip;
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span className="text-meta uppercase tracking-eyebrow text-muted-foreground">
          suas apostas{legs.length > 0 ? ` (${legs.length})` : ""}
        </span>
        {legs.length > 0 && (
          <button
            type="button"
            onClick={slip.clear}
            className="text-meta uppercase tracking-label text-muted-foreground hover:text-foreground"
          >
            limpar
          </button>
        )}
      </div>
      <Separator />

      {legs.length === 0 ? (
        <p className="px-4 py-4 text-body-sm text-muted-foreground tracking-tight">
          Toque numa seleção da grade pra começar.
        </p>
      ) : (
        <form action={slip.registerAction} className="flex flex-col gap-3 px-4 py-3">
          <input type="hidden" name="slip" value={slip.payload} />
          <div
            role="group"
            aria-label="tipo de aposta"
            className="inline-flex w-fit gap-1 rounded-md border border-border p-1"
          >
            <ModeButton active={mode === "simples"} onClick={() => slip.setMode("simples")}>
              Simples
            </ModeButton>
            <ModeButton
              active={mode === "combinada"}
              disabled={!slip.canCombine}
              onClick={() => slip.setMode("combinada")}
            >
              Combinada
            </ModeButton>
          </div>

          {legs.map((leg) => (
            <div
              key={leg.id}
              className="flex flex-col gap-2 rounded-md border border-border px-3 py-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-body-sm font-medium tracking-tight text-foreground">
                  {leg.label}
                </span>
                <button
                  type="button"
                  aria-label={`remover ${leg.label}`}
                  onClick={() => slip.remove(leg.id)}
                  className="rounded-sm text-muted-fg-2 hover:text-destructive"
                >
                  <X className="size-4" />
                </button>
              </div>
              {leg.modelProbPct !== null && (
                <span className="font-mono tabular-nums text-meta text-muted-foreground">
                  chance {formatPct(leg.modelProbPct, { decimals: 1 })}
                  {leg.fairOdd !== null ? ` · odd justa ${formatOdd(leg.fairOdd)}` : ""}
                </span>
              )}
              {mode === "simples" && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-meta uppercase tracking-label text-muted-foreground">
                      {leg.oddFromReference ? "odd (referência)" : "odd que você pegou"}
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={leg.oddInput}
                      placeholder="ex.: 2,10"
                      onChange={(e) =>
                        slip.update(leg.id, {
                          oddInput: e.target.value,
                          oddFromReference: false,
                        })
                      }
                      className={INPUT}
                    />
                  </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-meta uppercase tracking-label text-muted-foreground">
                        stake (u, opcional)
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={leg.stakeInput}
                        placeholder="1"
                        onChange={(e) => slip.update(leg.id, { stakeInput: e.target.value })}
                        className={INPUT}
                      />
                    </label>
                </div>
              )}
              {mode === "simples" && leg.oddFromReference && (
                <span className="text-meta leading-relaxed text-muted-foreground tracking-tight">
                  Preenchida com a odd de referência. Troque pela que você pegou.
                </span>
              )}
            </div>
          ))}

          {mode === "combinada" && (
            <div className="grid grid-cols-2 gap-2 rounded-md border border-dashed border-border px-3 py-2.5">
              <label className="flex flex-col gap-1">
                <span className="text-meta uppercase tracking-label text-muted-foreground">
                  odd da combinada
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={slip.comboOddInput}
                  placeholder="ex.: 3,40"
                  onChange={(e) => slip.setComboOddInput(e.target.value)}
                  className={INPUT}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-meta uppercase tracking-label text-muted-foreground">
                  stake (u, opcional)
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={slip.comboStakeInput}
                  placeholder="1"
                  onChange={(e) => slip.setComboStakeInput(e.target.value)}
                  className={INPUT}
                />
              </label>
              <span className="col-span-2 text-meta leading-relaxed text-muted-foreground tracking-tight">
                A odd única da combinada, pras {legs.length} seleções juntas. As
                seleções do mesmo jogo andam juntas, então a chance vem do placar, não
                da multiplicação.
              </span>
            </div>
          )}

          {slip.notice && (
            <p className="text-body-sm text-muted-foreground tracking-tight">{slip.notice}</p>
          )}

          <Button type="submit" disabled={slip.registering}>
            {slip.registering ? "Registrando…" : "Registrar apostas"}
          </Button>
        </form>
      )}

      {slip.registerState && !slip.registerState.ok && (
        <p
          className="px-4 pb-3 text-body-sm text-destructive tracking-tight"
          role="alert"
          aria-live="assertive"
        >
          {slip.registerState.error}
        </p>
      )}

      {slip.registerState?.ok && (
        <>
          <Separator />
          <Evaluation
            view={slip.registerState.evaluation}
            registered={slip.registerState.registered}
          />
        </>
      )}

      <Separator />
      <SlipRiskNotice className="px-4 py-3" />
    </Card>
  );
}

function ModeButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-sm px-3 py-1 text-meta uppercase tracking-label transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-40",
        active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

// ── Avaliação (o que o servidor calculou ao registrar) ──────────────────────

function Evaluation({ view, registered }: { view: SlipEvaluationView; registered: number }) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3" aria-live="polite">
      <span className="text-meta uppercase tracking-eyebrow text-muted-foreground">
        {registered === 1 ? "aposta registrada" : `${registered} apostas registradas`} ·
        nossa avaliação
      </span>
      {view.legs.map((leg, i) => (
        <LegEvaluation key={i} leg={leg} />
      ))}
      {view.combo && <ComboEvaluation combo={view.combo} />}
      <p className="text-meta leading-relaxed text-muted-foreground tracking-tight">
        {view.stakeRuleNote} {view.modelCaveat} Ficam salvas em Suas apostas e são conferidas
        sozinhas depois do jogo.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (value === null) return null;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-meta uppercase tracking-label text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-body-sm font-medium tabular-nums tracking-tight text-foreground">
        {value}
      </span>
    </div>
  );
}

function LegEvaluation({ leg }: { leg: EvaluatedLegView }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-body-sm font-medium tracking-tight text-foreground">
          {leg.label}
        </span>
        {leg.sourceLabel && (
          <span className="shrink-0 text-meta text-muted-foreground">
            {leg.sourceLabel}
          </span>
        )}
      </div>
      <p className="text-body-sm leading-relaxed text-foreground tracking-tight">
        {leg.reading}
      </p>
      <Row label="chance pelo modelo" value={leg.modelProb} />
      <Row label="odd justa" value={leg.fairOdd} />
      <Row label="sua odd" value={leg.userOdd} />
      <Row label="retorno esperado" value={leg.ev} />
      <Row label="break-even" value={leg.breakEven} />
      <Row label="vantagem do modelo" value={leg.edge} />
      {leg.edgeNote && leg.status === "graded" && (
        <span className="text-meta leading-relaxed text-muted-foreground tracking-tight">
          vantagem: {leg.edgeNote}
        </span>
      )}
      <Row label="stake sugerido" value={leg.suggestedStake} />
      <Row label="quarter-Kelly (informativo)" value={leg.kellyInfo} />
      <Row label="seu stake" value={leg.userStake} />
    </div>
  );
}

function ComboEvaluation({ combo }: { combo: EvaluatedComboView }) {
  if (combo.status === "not_evaluated") {
    return (
      <div className="rounded-md border border-dashed border-border px-3 py-2.5 text-body-sm text-muted-foreground tracking-tight">
        {combo.reason}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-body-sm font-medium tracking-tight text-foreground">
          Combinada (todas juntas)
        </span>
        <span className="shrink-0 text-meta text-muted-foreground">
          {combo.sourceLabel}
        </span>
      </div>
      <p className="text-body-sm leading-relaxed text-foreground tracking-tight">
        {combo.reading}
      </p>
      <Row label="chance da combinada" value={combo.jointProb} />
      {combo.marginals.map((m, i) => (
        <Row key={i} label={`· ${m.label}`} value={m.prob} />
      ))}
      <Row label="odd justa" value={combo.fairOdd} />
      <Row label="sua odd" value={combo.userOdd} />
      <Row label="retorno esperado" value={combo.ev} />
      <Row label="break-even" value={combo.breakEven} />
      <Row label="stake sugerido" value={combo.suggestedStake} />
      <Row label="quarter-Kelly (informativo)" value={combo.kellyInfo} />
      <Row label="seu stake" value={combo.userStake} />
    </div>
  );
}
