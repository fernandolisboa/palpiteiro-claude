"use client";

import { useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

import {
  confirmBet,
  parseBet,
  type ConfirmBetResult,
  type ParseBetResult,
} from "@/app/actions/bets";
import type { FreeBetLegView } from "@/lib/view/types";

// "Aposta livre" (ADR 0036, tracer #471): input NL → chips confirmáveis → grade do
// modelo de placar. Registro Análise DESGUARDADO (números de valor legítimos, ADR
// 0034 §9) — o componente só RENDERIZA; a governança vive nos dados do view. SEM CTA
// "faça esta aposta", SEM link/banner pra casa (§12).

// Disclaimer §3 (aviso de risco) — docs/ops/05-legal-compliance.md:102-105, VERBATIM.
// Constante LOCAL de propósito (espelha grade-my-bet.tsx:18): single-source via
// disclaimer.ts arrastaria o firewall (value-language-guard) pro import-graph desta
// superfície, o que é proibido (ADR 0034 §9 / 0036 §7).
const RISK_DISCLAIMER_PT_BR =
  "Aposta não é investimento. As recomendações do Palpiteiro são análises e não garantem resultado. Aposte com responsabilidade, só o que você pode perder, e nunca para recuperar perdas. Se a aposta deixou de ser diversão, procure ajuda.";

type EditableLeg = {
  kind: "exact_score";
  selectionLabel: string;
  params: { home: number; away: number };
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
          ...(meta.comboUserOdd !== null
            ? { comboUserOdd: String(meta.comboUserOdd) }
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
            maxLength={280}
            rows={2}
            placeholder="Ex.: Palmeiras 2 a 0, odd 9.00"
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
                <span className="font-mono text-eyebrow-xs uppercase tracking-label text-muted-fg-2">
                  {leg.settleBadge}
                </span>
              </div>
              <label className="flex flex-col gap-1">
                <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
                  odd que você pegou
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={leg.oddInput}
                  placeholder="9,00"
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
        confirmState.legs.map((view, i) => <FreeBetResult key={i} view={view} />)}

      {/* Disclaimer §3 COMPLETO — sempre visível (máxima intenção, §12). */}
      <p className="text-meta leading-relaxed text-muted-fg-2 tracking-tight">
        {RISK_DISCLAIMER_PT_BR}
      </p>
    </div>
  );
}

// Render do resultado de UMA perna — registro Análise DESGUARDADO. PROIBIDO (§10):
// nota/letra/score/medidor/chip verde-vermelho. Perna B: edge é SEMPRE "—".
function FreeBetResult({ view }: { view: FreeBetLegView }) {
  if (view.kind === "nao-avalio") {
    return (
      <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-border px-4 py-3.5">
        <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
          não avalio
        </span>
        <p className="text-body-sm text-muted-foreground tracking-tight">
          {view.reason}
        </p>
      </div>
    );
  }

  const pct = (n: number) => `${n.toFixed(1)}%`;

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
