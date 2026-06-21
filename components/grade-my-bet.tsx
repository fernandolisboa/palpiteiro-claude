"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

import { gradeMyBet, type GradeMyBetResult } from "@/app/actions/predictions";
import type { GradeMyBetView } from "@/lib/view/types";

// Disclaimer §3 (aviso de risco) — docs/ops/05-legal-compliance.md:102-105, VERBATIM.
// NET-NEW aqui (não herdado de analysis-result.tsx): "Analise minha aposta" é a tela
// de MÁXIMA intenção de aposta (§3), exige a linha §3 COMPLETA. Constante LOCAL de
// propósito — single-source-lo via lib/view/share/disclaimer.ts arrastaria o firewall
// (value-language-guard) pro import-graph desta superfície, o que é proibido (ADR 0034).
const RISK_DISCLAIMER_PT_BR =
  "Aposta não é investimento. As recomendações do Palpiteiro são análises e não garantem resultado. Aposte com responsabilidade, só o que você pode perder, e nunca para recuperar perdas. Se a aposta deixou de ser diversão, procure ajuda.";

// Descriptor de mercado preparado server-side (selectionKeys + labels do registry).
// Tipos PUROS client-safe — o componente só renderiza, nunca re-decide a cobertura.
export type GradeMarketOption = {
  key: string;
  label: string; // marketLabel ("Over/Under gols")
  hasLine: boolean; // over_under → mostra o input de linha
  selections: { key: string; label: string }[]; // selectionKey + outcomeLabel
};

export type GradeMyBetPrefill = {
  marketKey: string;
  selectionKey: string;
  line: number | null;
};

type Props = {
  matchId: string;
  markets: GradeMarketOption[];
  prefill: GradeMyBetPrefill;
};

export function GradeMyBet({ matchId, markets, prefill }: Props) {
  const [state, action, pending] = useActionState<
    GradeMyBetResult | null,
    FormData
  >(gradeMyBet, null);

  // Mercado/seleção controlados pra: (a) mostrar o input de linha só em over_under,
  // (b) trocar a lista de seleções ao trocar de mercado. O usuário SÓ digita a odd.
  const [marketKey, setMarketKey] = useState(prefill.marketKey);
  const market =
    markets.find((m) => m.key === marketKey) ?? markets[0] ?? null;
  const [selectionKey, setSelectionKey] = useState(prefill.selectionKey);

  function onMarketChange(next: string) {
    setMarketKey(next);
    const m = markets.find((mm) => mm.key === next);
    // Reseta a seleção pra a 1ª válida do mercado novo (a antiga pode não existir).
    setSelectionKey(m?.selections[0]?.key ?? "");
  }

  if (markets.length === 0) {
    return (
      <p className="text-body-sm text-muted-foreground tracking-tight">
        Nenhum mercado com modelo de valor disponível para este jogo.
      </p>
    );
  }

  const selectionValid =
    market?.selections.some((s) => s.key === selectionKey) ?? false;
  const effectiveSelection = selectionValid
    ? selectionKey
    : market?.selections[0]?.key ?? "";

  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="matchId" value={matchId} />

        <label className="flex flex-col gap-1">
          <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
            mercado
          </span>
          <Select
            name="marketKey"
            value={marketKey}
            onChange={(e) => onMarketChange(e.target.value)}
          >
            {markets.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
            seleção
          </span>
          <Select
            name="selectionKey"
            value={effectiveSelection}
            onChange={(e) => setSelectionKey(e.target.value)}
          >
            {market?.selections.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </Select>
        </label>

        {market?.hasLine && (
          <label className="flex flex-col gap-1">
            <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
              linha
            </span>
            <input
              type="number"
              name="line"
              step="0.5"
              defaultValue={prefill.line ?? 2.5}
              className="w-28 rounded-md border border-border bg-transparent px-3 py-2 text-body-sm tabular-nums focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </label>
        )}

        <label className="flex flex-col gap-1">
          <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
            odd que você pegou
          </span>
          <input
            type="text"
            inputMode="decimal"
            name="odd"
            required
            placeholder="1,85"
            className="w-28 rounded-md border border-border bg-transparent px-3 py-2 text-body-sm tabular-nums focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </label>

        <Button type="submit" disabled={pending} className="w-fit">
          {pending ? "Avaliando…" : "Avaliar valor"}
        </Button>
      </form>

      {state && !state.ok && (
        <p
          className="text-body-sm text-destructive tracking-tight"
          role="alert"
          aria-live="assertive"
        >
          {state.error}
        </p>
      )}

      {state && state.ok && <GradeResult view={state.view} />}

      {/* Disclaimer §3 COMPLETO — sempre visível na tela de máxima intenção (§3). */}
      <p className="text-meta leading-relaxed text-muted-fg-2 tracking-tight">
        {RISK_DISCLAIMER_PT_BR}
      </p>
    </div>
  );
}

// Render do resultado — registro Análise DESGUARDADO (números de valor LEGÍTIMOS,
// espelha analysis-result.tsx). A GOVERNANÇA vive nos DADOS do view; o componente
// só RENDERIZA. PROIBIDO (§10): nota/letra/score/medidor/chip verde-vermelho;
// SEM CTA "faça esta aposta", SEM link/banner pra casa.
function GradeResult({ view }: { view: GradeMyBetView }) {
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
  const evLabel = `${view.evPerUnit >= 0 ? "+" : ""}${(view.evPerUnit * 100).toFixed(1)}%`;
  const profitLabel = `R$ ${view.profitIfWon.toFixed(2)}`;

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span className="font-mono text-eyebrow uppercase tracking-eyebrow text-muted-foreground">
          nossa avaliação de valor
        </span>
        <span className="font-mono text-eyebrow-xs text-muted-fg-2">
          {view.createdAt}
        </span>
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

      {view.kind === "grade-coberto" && view.coherenceWarning && (
        <p className="px-4 pb-3 text-meta leading-relaxed text-muted-fg-2 tracking-tight">
          Atenção: nessa odd o retorno esperado e o nosso edge de mercado apontam
          para lados diferentes — a leitura segue o retorno na odd que você pegou.
        </p>
      )}

      <Separator />
      <div className="flex flex-col gap-2 px-4 py-4">
        <Row label="retorno esperado nessa odd" value={evLabel} />
        <Row label="break-even (prob. mínima)" value={pct(view.breakEvenProbPct)} />
        <Row label="prob. do modelo" value={pct(view.modelProbPct)} />
        <Row label="nosso edge" value={view.edgeLabel} />
        <Row
          label={view.stakeLabel}
          value={`${view.stakeUnits}u`}
        />
        {view.kind === "grade-coberto" && view.secondaryStakeLabel && (
          <Row
            label="dimensionamento secundário"
            value={view.secondaryStakeLabel}
          />
        )}
        <Row label="lucro se ganhar (stake × odd)" value={profitLabel} />
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
