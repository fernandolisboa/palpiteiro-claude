"use client";

import { useEffect, useState } from "react";

import { useBetSlip } from "@/components/bet-slip/bet-slip-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { MAX_RAW_INPUT } from "@/lib/ai/bet-parse/schema";
import { MAX_EXACT_SCORE_GOALS } from "@/lib/bets/slip-markets";
import { formatOdd } from "@/lib/format-number";
import { cn } from "@/lib/utils";
import type { BetGridView, GridSelectionView } from "@/lib/view/bet-slip";

// Tabela de mercados (Fase 2, #556): toque nas seleções que você apostou e elas entram
// em "Suas apostas". Consome o BetSlipProvider (#576) e registra a grade nele (é ela
// que traz odd e chance de cada seleção pro "Seu palpite" e pro texto livre).

export function MarketTable({ grid }: { grid: BetGridView }) {
  const slip = useBetSlip();
  const registerGrid = slip?.registerGrid;
  useEffect(() => registerGrid?.(grid), [grid, registerGrid]);
  if (!slip) return null;
  return (
    <section className="flex flex-col gap-3" data-tour="bet-slip">
      <SectionHeading modelLabel={grid.model?.label ?? null} />
      <MarketGrid
        matchId={slip.matchId}
        grid={grid}
        selectedIds={slip.selectedIds}
        onToggle={slip.toggle}
        onAddScore={slip.addScore}
        parseAction={slip.parseAction}
        parsing={slip.parsing}
        parseError={slip.parseState && !slip.parseState.ok ? slip.parseState.error : null}
        parseWarnings={slip.parseState?.ok ? slip.parseState.warnings : []}
      />
    </section>
  );
}

function SectionHeading({ modelLabel }: { modelLabel: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-meta uppercase tracking-eyebrow text-muted-foreground">
        mercados
      </span>
      <p className="text-body-sm text-muted-foreground tracking-tight">
        Toque nas seleções que você apostou, confira a odd que pegou e registre. A
        avaliação sai na hora, sem gastar análise do dia.
        {modelLabel ? ` Chances pelo ${modelLabel} ou pela sua análise do mercado.` : ""}
      </p>
    </div>
  );
}

// ── Grade de mercados ───────────────────────────────────────────────────────

function MarketGrid({
  matchId,
  grid,
  selectedIds,
  onToggle,
  onAddScore,
  parseAction,
  parsing,
  parseError,
  parseWarnings,
}: {
  matchId: string;
  grid: BetGridView;
  selectedIds: ReadonlySet<string>;
  onToggle: (s: GridSelectionView) => void;
  onAddScore: (home: number, away: number) => void;
  parseAction: (fd: FormData) => void;
  parsing: boolean;
  parseError: string | null;
  parseWarnings: string[];
}) {
  const [home, setHome] = useState(1);
  const [away, setAway] = useState(0);
  const goals = Array.from({ length: MAX_EXACT_SCORE_GOALS + 1 }, (_, i) => i);
  return (
    <Card className="gap-0 overflow-hidden p-0">
      {grid.groups.map((g, i) => (
        <div key={g.key}>
          {i > 0 && <Separator />}
          <MarketRow title={g.title}>
            <div
              className={cn(
                "grid gap-2",
                g.selections.length === 3 ? "grid-cols-3" : "grid-cols-2",
              )}
            >
              {g.selections.map((s) => (
                <SelectionButton
                  key={s.id}
                  s={s}
                  selected={selectedIds.has(s.id)}
                  onClick={() => onToggle(s)}
                />
              ))}
            </div>
          </MarketRow>
        </div>
      ))}
      <Separator />
      <MarketRow title="Placar exato">
        {grid.topScores.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {grid.topScores.map((s) => (
              <SelectionButton
                key={s.id}
                s={s}
                selected={selectedIds.has(s.id)}
                onClick={() => onToggle(s)}
              />
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <span className="text-meta uppercase tracking-label text-muted-foreground">
            outro placar
          </span>
          <ScoreSelect label={grid.teams.home} value={home} onChange={setHome} options={goals} />
          <span className="text-muted-foreground">×</span>
          <ScoreSelect label={grid.teams.away} value={away} onChange={setAway} options={goals} />
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => onAddScore(home, away)}
          >
            Adicionar placar
          </Button>
        </div>
      </MarketRow>
      <Separator />
      <div className="flex flex-col gap-2 px-4 py-3">
        <form action={parseAction} className="flex flex-col gap-2">
          <input type="hidden" name="matchId" value={matchId} />
          <label className="flex flex-col gap-1">
            <span className="text-meta uppercase tracking-label text-muted-foreground">
              ou digite sua aposta
            </span>
            <textarea
              name="text"
              required
              maxLength={MAX_RAW_INPUT}
              rows={2}
              placeholder="Ex.: Palmeiras vence e mais de 2.5 gols, odd 3,20"
              className="rounded-md border border-border bg-transparent px-3 py-2 text-body-sm tracking-tight focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </label>
          <Button type="submit" size="sm" variant="outline" disabled={parsing} className="w-fit">
            {parsing ? "Lendo…" : "Preencher com o texto"}
          </Button>
        </form>
        {parseError && (
          <p className="text-body-sm text-destructive tracking-tight" role="alert">
            {parseError}
          </p>
        )}
        {parseWarnings.map((w, i) => (
          <p key={i} className="text-meta leading-relaxed text-muted-foreground tracking-tight">
            {w}
          </p>
        ))}
        <p className="text-meta leading-relaxed text-muted-foreground tracking-tight">
          O texto é lido pela IA (conta no limite de leituras de aposta) e só preenche a
          lista: nada é registrado até você confirmar.
        </p>
      </div>
    </Card>
  );
}

function MarketRow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <span className="text-meta uppercase tracking-label text-muted-foreground">
        {title}
      </span>
      {children}
    </div>
  );
}

function SelectionButton({
  s,
  selected,
  onClick,
}: {
  s: GridSelectionView;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-md border px-2 py-1.5 text-center transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        selected
          ? "border-foreground bg-foreground text-background"
          : "border-border hover:border-foreground/40",
      )}
    >
      <span className="line-clamp-1 text-body-sm tracking-tight">{s.label}</span>
      {s.referenceOdd !== null ? (
        <span className="font-mono text-body-sm font-medium tabular-nums">
          {formatOdd(s.referenceOdd)}
        </span>
      ) : s.fairOdd !== null ? (
        <span
          className={cn(
            "font-mono text-meta tabular-nums",
            selected ? "text-background/70" : "text-muted-foreground",
          )}
          title="odd justa pelo modelo (sem margem)"
        >
          justa {formatOdd(s.fairOdd)}
        </span>
      ) : null}
    </button>
  );
}

function ScoreSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  options: number[];
}) {
  return (
    <select
      aria-label={`gols do ${label}`}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-8 rounded-md border border-border bg-transparent px-2 font-mono text-body-sm tabular-nums focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {options.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );
}

