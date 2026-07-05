"use client";

import { useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

import {
  confirmBet,
  parseBet,
  type ConfirmBetResult,
  type ConfirmLegView,
  type ParseBetResult,
} from "@/app/actions/bets";
import { MAX_RAW_INPUT } from "@/lib/ai/bet-parse/schema";
import type { BetLegParams } from "@/db/schema";
import type {
  FreeBetComboView,
  FreeBetLegView,
  GradeMyBetView,
} from "@/lib/view/types";

// "Aposta livre" (ADR 0036, Fase 2 #472): input NL → chips confirmáveis → grade
// roteado (cartucho com edge DENTRO do gate; modelo de placar sem edge fora dele;
// cards/corners aceitas-não-gradeadas). Registro Análise DESGUARDADO (números de
// valor legítimos, ADR 0034 §9) — o componente só RENDERIZA. SEM CTA "faça esta
// aposta", SEM link/banner pra casa (§12).

// Disclaimer §3 (aviso de risco) — docs/ops/05-legal-compliance.md:102-105, VERBATIM.
// Constante LOCAL de propósito (espelha grade-my-bet.tsx:18).
const RISK_DISCLAIMER_PT_BR =
  "Aposta não é investimento. As recomendações do Palpiteiro são análises e não garantem resultado. Aposte com responsabilidade, só o que você pode perder, e nunca para recuperar perdas. Se a aposta deixou de ser diversão, procure ajuda.";

type EditableLeg = {
  kind: string;
  selectionLabel: string;
  params: BetLegParams;
  oddInput: string;
  settleBadge: string;
};

type SlipMeta = {
  rawInput: string;
  parseAiCallId: string | null;
  comboUserOdd: number | null;
};

export function FreeBet({ matchId }: { matchId: string }) {
  const [parseState, parseAction, parsing] = useActionState<
    ParseBetResult | null,
    FormData
  >(parseBet, null);
  const [confirmState, confirmActionFn, confirming] = useActionState<
    ConfirmBetResult | null,
    FormData
  >(confirmBet, null);

  const [legs, setLegs] = useState<EditableLeg[]>([]);
  const [meta, setMeta] = useState<SlipMeta | null>(null);
  // Odd combinada editável (string PT-BR) — semeada do parse, aplicada só com ≥2 pernas.
  const [comboOddInput, setComboOddInput] = useState("");

  // Semeia o editor a partir do echo do parse (chips editáveis).
  useEffect(() => {
    if (parseState?.ok) {
      setLegs(
        parseState.legs.map((l) => ({
          kind: l.kind,
          selectionLabel: l.selectionLabel,
          params: l.params,
          oddInput: l.userOdd === null ? "" : String(l.userOdd),
          settleBadge: l.settleBadge,
        })),
      );
      setMeta({
        rawInput: parseState.rawInput,
        parseAiCallId: parseState.parseAiCallId,
        comboUserOdd: parseState.comboUserOdd,
      });
      setComboOddInput(
        parseState.comboUserOdd === null
          ? ""
          : String(parseState.comboUserOdd),
      );
    }
  }, [parseState]);

  // O slip confirmado (o contrato re-validado server-side). Odds como string PT-BR.
  const slipPayload =
    meta === null
      ? null
      : {
          matchId,
          rawInput: meta.rawInput,
          parseAiCallId: meta.parseAiCallId,
          legs: legs.map((l) => ({
            kind: l.kind,
            params: l.params,
            ...(l.oddInput.trim() ? { userOdd: l.oddInput.trim() } : {}),
          })),
          // Odd combinada só faz sentido com ≥2 pernas (o boundary ignora numa perna só).
          ...(legs.length >= 2 && comboOddInput.trim()
            ? { comboUserOdd: comboOddInput.trim() }
            : {}),
        };

  return (
    <div className="flex flex-col gap-4">
      <form action={parseAction} className="flex flex-col gap-3">
        <input type="hidden" name="matchId" value={matchId} />
        <label className="flex flex-col gap-1">
          <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
            sua aposta, do seu jeito
          </span>
          <textarea
            name="text"
            required
            maxLength={MAX_RAW_INPUT}
            rows={2}
            placeholder="Ex.: Palmeiras vence, mais de 2.5 gols, odd 3.20"
            className="rounded-md border border-border bg-transparent px-3 py-2 text-body-sm tracking-tight focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </label>
        <Button type="submit" disabled={parsing} className="w-fit">
          {parsing ? "Lendo…" : "Ler minha aposta"}
        </Button>
      </form>

      {parseState && !parseState.ok && (
        <p
          className="text-body-sm text-destructive tracking-tight"
          role="alert"
          aria-live="assertive"
        >
          {parseState.error}
        </p>
      )}

      {parseState?.ok && parseState.warnings.length > 0 && (
        <ul className="flex flex-col gap-1">
          {parseState.warnings.map((w, i) => (
            <li
              key={i}
              className="text-meta leading-relaxed text-muted-fg-2 tracking-tight"
            >
              {w}
            </li>
          ))}
        </ul>
      )}

      {legs.length > 0 && (
        <form action={confirmActionFn} className="flex flex-col gap-3">
          {slipPayload && (
            <input
              type="hidden"
              name="slip"
              value={JSON.stringify(slipPayload)}
            />
          )}
          {legs.map((leg, i) => (
            <div
              key={i}
              className="flex flex-col gap-2 rounded-md border border-border px-4 py-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-body font-medium tracking-tight text-foreground">
                  {leg.selectionLabel}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setLegs((prev) => prev.filter((_, j) => j !== i))
                  }
                  className="font-mono text-eyebrow-xs uppercase tracking-label text-muted-fg-2 hover:text-destructive"
                >
                  remover
                </button>
              </div>
              <span className="font-mono text-eyebrow-xs uppercase tracking-label text-muted-fg-2">
                {leg.settleBadge}
              </span>
              <label className="flex flex-col gap-1">
                <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
                  odd que você pegou
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={leg.oddInput}
                  placeholder="3,20"
                  onChange={(e) => {
                    const next = e.target.value;
                    setLegs((prev) =>
                      prev.map((l, j) =>
                        j === i ? { ...l, oddInput: next } : l,
                      ),
                    );
                  }}
                  className="w-28 rounded-md border border-border bg-transparent px-3 py-2 text-body-sm tabular-nums focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </label>
            </div>
          ))}
          {legs.length >= 2 && (
            <label className="flex flex-col gap-1 rounded-md border border-dashed border-border px-4 py-3">
              <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
                odd da combinada (opcional)
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={comboOddInput}
                placeholder="2,10"
                onChange={(e) => setComboOddInput(e.target.value)}
                className="w-28 rounded-md border border-border bg-transparent px-3 py-2 text-body-sm tabular-nums focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
              <span className="font-mono text-eyebrow-xs text-muted-fg-2">
                a odd única que a casa paga pelas {legs.length} pernas juntas
              </span>
            </label>
          )}
          <Button type="submit" disabled={confirming} className="w-fit">
            {confirming ? "Confirmando…" : "Confirmar aposta"}
          </Button>
        </form>
      )}

      {confirmState && !confirmState.ok && (
        <p
          className="text-body-sm text-destructive tracking-tight"
          role="alert"
          aria-live="assertive"
        >
          {confirmState.error}
        </p>
      )}

      {confirmState?.ok &&
        confirmState.legs.map((leg, i) => <LegResult key={i} leg={leg} />)}

      {confirmState?.ok && confirmState.combo && (
        <ComboResult combo={confirmState.combo} />
      )}

      {/* Disclaimer §3 COMPLETO — sempre visível (máxima intenção, §12). */}
      <p className="text-meta leading-relaxed text-muted-fg-2 tracking-tight">
        {RISK_DISCLAIMER_PT_BR}
      </p>
    </div>
  );
}

// Roteia o render por fonte do grade. cartridge (CAMINHO A) mostra edge; model
// (CAMINHO B) nunca; none/rate_limited são avisos.
function LegResult({ leg }: { leg: ConfirmLegView }) {
  if (leg.route === "none") {
    return <Notice label="não avaliamos como número" body={leg.message} />;
  }
  if (leg.route === "rate_limited") {
    return (
      <Notice
        label={leg.selectionLabel}
        body="Você atingiu o limite de análises hoje — registramos a aposta, mas não avaliei esta perna. Tente amanhã."
      />
    );
  }
  if (leg.route === "cartridge") return <CartridgeResult view={leg.view} />;
  return <ModelResult view={leg.view} />;
}

function Notice({ label, body }: { label: string; body: string }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-border px-4 py-3.5">
      <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
        {label}
      </span>
      <p className="text-body-sm text-muted-foreground tracking-tight">{body}</p>
    </div>
  );
}

const pct = (n: number) => `${n.toFixed(1)}%`;

// CAMINHO A — cartucho (com edge). Renderiza o GradeMyBetView (mesmos números da
// aba Análise, sem duplicar fonte). Números de valor LEGÍTIMOS (registro Análise).
function CartridgeResult({ view }: { view: GradeMyBetView }) {
  if (view.kind === "nao-avalio") {
    return <Notice label="não avalio" body={view.reason} />;
  }
  const evLabel = `${view.evPerUnit >= 0 ? "+" : ""}${(view.evPerUnit * 100).toFixed(1)}%`;
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span className="font-mono text-eyebrow uppercase tracking-eyebrow text-muted-foreground">
          nossa avaliação de valor
        </span>
        <span className="font-mono text-eyebrow-xs text-muted-fg-2">análise</span>
      </div>
      <Separator />
      <div className="flex flex-col gap-1 px-4 py-4">
        <span className="font-mono text-display-sm font-medium leading-none tracking-tight text-foreground">
          {view.pinnedLabel}
        </span>
        <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
          {view.marketLabel} · odd {view.userOdd}
        </span>
      </div>
      <p className="px-4 pb-3 text-body-sm leading-relaxed text-foreground tracking-tight">
        {view.valueReading}
      </p>
      <Separator />
      <div className="flex flex-col gap-2 px-4 py-4">
        <Row label="retorno esperado nessa odd" value={evLabel} />
        <Row label="break-even (prob. mínima)" value={pct(view.breakEvenProbPct)} />
        <Row label="prob. do modelo" value={pct(view.modelProbPct)} />
        <Row label="nosso edge" value={view.edgeLabel} />
      </div>
    </Card>
  );
}

// CAMINHO B — modelo de placar (sem edge). edge é SEMPRE "—".
function ModelResult({ view }: { view: FreeBetLegView }) {
  if (view.kind === "nao-avalio") {
    return <Notice label="não avalio" body={view.reason} />;
  }
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span className="font-mono text-eyebrow uppercase tracking-eyebrow text-muted-foreground">
          nossa avaliação de valor
        </span>
        <span className="font-mono text-eyebrow-xs text-muted-fg-2">
          {view.sourceLabel}
        </span>
      </div>
      <Separator />
      <div className="flex flex-col gap-1 px-4 py-4">
        <span className="font-mono text-display-sm font-medium leading-none tracking-tight text-foreground">
          {view.selectionLabel}
        </span>
        <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
          {view.settleBadge}
        </span>
      </div>
      {view.value && (
        <p className="px-4 pb-3 text-body-sm leading-relaxed text-foreground tracking-tight">
          {view.value.valueReading}
        </p>
      )}
      <Separator />
      <div className="flex flex-col gap-2 px-4 py-4">
        <Row label="prob. do modelo" value={pct(view.modelProbPct)} />
        {view.value && (
          <>
            <Row
              label="retorno esperado nessa odd"
              value={`${view.value.evPerUnit >= 0 ? "+" : ""}${(view.value.evPerUnit * 100).toFixed(1)}%`}
            />
            <Row
              label="break-even (prob. mínima)"
              value={pct(view.value.breakEvenProbPct)}
            />
            <Row
              label="lucro se ganhar (1u × odd)"
              value={`R$ ${view.value.profitIfWon.toFixed(2)}`}
            />
          </>
        )}
        <Row label="nosso edge" value={view.edgeLabel} />
      </div>
    </Card>
  );
}

// Combinada same-game (Decisão 4). INVARIANTE DE COERÊNCIA DE TELA: o joint SEMPRE
// aparece com as marginais Poisson das pernas participantes na MESMA tela (joint ≤ min
// garantido pela matriz única). Rótulo "modelo simplificado" onipresente; sem edge.
function ComboResult({ combo }: { combo: FreeBetComboView }) {
  if (combo.kind === "combinada-nao-avaliada") {
    return <Notice label="combinada não avaliada" body={combo.reason} />;
  }
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span className="font-mono text-eyebrow uppercase tracking-eyebrow text-muted-foreground">
          combinada (todas as pernas juntas)
        </span>
        <span className="font-mono text-eyebrow-xs text-muted-fg-2">
          {combo.sourceLabel}
        </span>
      </div>
      <Separator />
      <div className="flex flex-col gap-1 px-4 py-4">
        <span className="font-mono text-display-sm font-medium leading-none tracking-tight text-foreground">
          {pct(combo.jointProbPct)}
        </span>
        <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
          chance da combinada acontecer
        </span>
      </div>
      {combo.value && (
        <p className="px-4 pb-3 text-body-sm leading-relaxed text-foreground tracking-tight">
          {combo.value.valueReading}
        </p>
      )}
      <Separator />
      {/* Marginais Poisson por perna — a mesma matriz do joint (invariante de coerência). */}
      <div className="flex flex-col gap-2 px-4 py-4">
        {combo.legs.map((l, i) => (
          <Row
            key={i}
            label={`prob. de "${l.selectionLabel}"`}
            value={pct(l.marginalPct)}
          />
        ))}
      </div>
      {combo.value && (
        <>
          <Separator />
          <div className="flex flex-col gap-2 px-4 py-4">
            <Row
              label="retorno esperado nessa odd"
              value={`${combo.value.evPerUnit >= 0 ? "+" : ""}${(combo.value.evPerUnit * 100).toFixed(1)}%`}
            />
            <Row
              label="break-even (prob. mínima)"
              value={pct(combo.value.breakEvenProbPct)}
            />
            <Row
              label="lucro se ganhar (1u × odd)"
              value={`R$ ${combo.value.profitIfWon.toFixed(2)}`}
            />
            <Row label="nosso edge" value="—" />
          </div>
        </>
      )}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-body font-medium tabular-nums tracking-tight text-foreground">
        {value}
      </span>
    </div>
  );
}
