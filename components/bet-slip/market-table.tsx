"use client";

import { useEffect, useState } from "react";
import { Sparkles, TriangleAlert } from "lucide-react";

import { useBetSlip, type BetSlipContextValue } from "@/components/bet-slip/bet-slip-provider";
import { HelpHint } from "@/components/help-hint";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { MAX_RAW_INPUT } from "@/lib/ai/bet-parse/schema";
import { MAX_EXACT_SCORE_GOALS } from "@/lib/bets/slip-markets";
import { formatOdd, formatPct } from "@/lib/format-number";
import { cn } from "@/lib/utils";
import type { BetGridView, GridGroupView, GridSelectionView } from "@/lib/view/bet-slip";

// Tabela de mercados (#556, #576): o único lugar da página com a probabilidade de cada
// seleção. Por célula, a odd de mercado, a chance (a da sua análise do mercado, senão o
// modelo do jogo) e a odd justa; por mercado, a chance sem a margem, a margem e a idade
// da captura. Antes do apito as células são botões que mandam a seleção pra "Suas
// apostas" (BetSlipProvider); depois, só leitura. Ao vivo (#580, `grid.live`): a odd é a
// última de antes do apito, a chance é do modelo em jogo e a seleção que o placar já
// decidiu diz "decidido", sem botão. O app REGISTRA a aposta feita em outro lugar: nunca
// "Apostar", nunca nome ou link de casa (ADR 0034 §12, ADR 0048).

export function MarketTable({ grid }: { grid: BetGridView }) {
  const slip = useBetSlip();
  const register = grid.mode === "register" && slip !== null;
  const registerGrid = slip?.registerGrid;
  // A tabela traz odd e chance de cada seleção pro "Seu palpite" e pro texto livre.
  useEffect(
    () => (grid.mode === "register" ? registerGrid?.(grid) : undefined),
    [grid, registerGrid],
  );

  const hasOdds = grid.noOdds === null;
  const hasChance = grid.groups.some((g) => g.probSource !== null);
  const analyzed = grid.groups.some((g) => g.probSource === "analysis");
  // A legenda nomeia a fonte da chance que está na tela: sem modelo (só leitura, ou a base
  // ainda não rodou), toda chance mostrada é a da sua análise.
  const modelChance = grid.model !== null;
  const live = grid.live !== null;
  const firstWithOdds = grid.groups.find((g) => g.odds !== null)?.key ?? null;

  return (
    <div className="flex flex-col gap-3">
      {register && (
        <p className="text-body-sm text-muted-foreground tracking-tight">
          {live
            ? "Toque nas seleções que você apostou, digite a odd que pegou e registre. A avaliação sai na hora, pela chance do modelo ao vivo."
            : "Toque nas seleções que você apostou, confira a odd que pegou e registre. A avaliação sai na hora, sem gastar análise do dia."}
        </p>
      )}
      {!hasOdds && grid.noOdds && <NoOddsNotice body={grid.noOdds} />}
      {(register || hasOdds) && (
        <Card className="gap-0 overflow-hidden p-0">
          <div className="flex flex-col gap-1 px-4 pt-3.5 pb-3">
            <span className="text-body font-medium tracking-tight">{grid.oddsHeading}</span>
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-meta text-muted-foreground">
              {live
                ? hasChance
                  ? "odd pré-jogo · chance ao vivo · odd justa"
                  : "odd pré-jogo"
                : !hasChance
                  ? "odd de mercado"
                  : modelChance
                    ? "odd de mercado · chance do modelo · odd justa"
                    : "odd de mercado · chance pela sua análise · odd justa"}
              {hasChance && modelChance && !live && (
                <HelpHint
                  anchor="leitura-modelo"
                  label="chance do modelo e odd justa"
                  blurb="Chance de cada resultado pelo modelo de placar do jogo, calculada sem olhar as odds. A odd justa é 100 ÷ chance."
                />
              )}
            </span>
            {analyzed && modelChance && (
              <span className="text-meta text-muted-foreground">
                Nos mercados que você analisou, a chance é a da análise da IA.
              </span>
            )}
          </div>
          {grid.groups.map((g) => (
            <div key={g.key}>
              <Separator />
              <MarketRow
                group={g}
                slip={register ? slip : null}
                marginHint={g.key === firstWithOdds}
                live={live}
              />
            </div>
          ))}
          {register && slip && (
            <>
              <Separator />
              <ExactScoreRow grid={grid} slip={slip} />
              <Separator />
              <FreeText slip={slip} />
            </>
          )}
          <Separator />
          <TableFooter grid={grid} />
        </Card>
      )}
    </div>
  );
}

function NoOddsNotice({ body }: { body: string }) {
  return (
    <Callout variant="info" icon={<TriangleAlert className="size-4" />} title="Odds indisponíveis">
      <span className="text-body-sm text-muted-foreground tracking-tight">{body}</span>
      <span className="pt-1 text-meta text-muted-foreground">fonte: the-odds-api</span>
    </Callout>
  );
}

function TableFooter({ grid }: { grid: BetGridView }) {
  const text = grid.live
    ? grid.live.footer
    : grid.model
    ? `chances pelo ${grid.model.label}${grid.model.computedAgo ? ` · calculado ${grid.model.computedAgo}` : ""}`
    : grid.mode === "register"
      ? "A chance do modelo aparece quando o cálculo do jogo rodar (a cada 6h, até 7 dias antes)."
      : "A última odd de cada mercado capturada antes do jogo.";
  return (
    <p className="px-4 py-2.5 text-meta leading-relaxed text-muted-foreground tracking-tight">
      {text}
    </p>
  );
}

function MarketRow({
  group,
  slip,
  marginHint,
  live,
}: {
  group: GridGroupView;
  slip: BetSlipContextValue | null;
  marginHint: boolean;
  live: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-meta uppercase tracking-label text-muted-foreground">
          {group.title}
        </span>
        {group.probSource === "analysis" && (
          <span className="text-meta text-muted-foreground">pela sua análise</span>
        )}
      </div>
      <div className={cn("grid gap-2", group.selections.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
        {group.selections.map((s) => (
          <SelectionCell
            key={s.id}
            s={s}
            byAnalysis={group.probSource === "analysis"}
            slip={slip}
            live={live}
          />
        ))}
      </div>
      {group.odds && (
        <p className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-meta text-muted-foreground">
          <span>sem a margem:</span>
          <span className="font-mono tabular-nums">{group.odds.impliedPct.join(" · ")}</span>
          <span aria-hidden>·</span>
          <span>
            margem <span className="font-mono tabular-nums">{group.odds.margin}</span>
          </span>
          <span aria-hidden>·</span>
          <span>{group.odds.updatedAgo}</span>
          {marginHint && (
            <HelpHint
              anchor="overround"
              label="margem e chance sem a margem"
              blurb="A margem embutida na odd. Sem ela, a chance de cada lado soma 100% (200% na dupla chance); nunca é 1/odd cru."
            />
          )}
        </p>
      )}
    </div>
  );
}

// Uma célula: rótulo, odd de mercado e "chance · justa". Cada número leva um rótulo pro
// leitor de tela (três números soltos não dizem nada). Botão quando registra, div no
// resto. Ao vivo, a seleção que o placar já decidiu vira "decidido", sem botão nem
// número (a chance seria 0% ou 100% e a odd de antes do jogo não diz mais nada).
function SelectionCell({
  s,
  byAnalysis,
  slip,
  live = false,
}: {
  s: GridSelectionView;
  byAnalysis: boolean;
  slip: BetSlipContextValue | null;
  live?: boolean;
}) {
  const selected = slip?.selectedIds.has(s.id) ?? false;
  const muted = selected ? "text-background/70" : "text-muted-foreground";
  const chanceLabel = byAnalysis
    ? "chance pela sua análise "
    : live
      ? "chance do modelo ao vivo "
      : "chance do modelo ";
  const base =
    "relative flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-md border px-2 py-1.5 text-center";
  if (s.decided) {
    return (
      <div className={cn(base, "border-dashed border-border")}>
        <span className="line-clamp-1 text-body-sm tracking-tight text-muted-foreground" title={s.label}>
          {s.label}
        </span>
        <span className="text-meta text-muted-foreground">decidido</span>
      </div>
    );
  }
  const content = (
    <>
      <span className="line-clamp-1 text-body-sm tracking-tight" title={s.label}>
        {s.label}
      </span>
      {s.referenceOdd !== null ? (
        <span className="font-mono text-body-sm font-medium tabular-nums">
          <span className="sr-only">{live ? "odd antes do jogo " : "odd de mercado "}</span>
          {formatOdd(s.referenceOdd)}
        </span>
      ) : s.fairOdd !== null ? (
        <span className={cn("text-meta", muted)} title="odd justa pelo modelo (sem margem)">
          justa <span className="font-mono tabular-nums">{formatOdd(s.fairOdd)}</span>
        </span>
      ) : (
        <span className={cn("text-meta", muted)}>
          <span className="sr-only">sem odd</span>
          <span aria-hidden>—</span>
        </span>
      )}
      {s.modelProbPct !== null && (
        <span className={cn("font-mono text-meta tabular-nums", muted)}>
          <span className="sr-only">{chanceLabel}</span>
          {formatPct(s.modelProbPct, { decimals: 1 })}
          {s.referenceOdd !== null && s.fairOdd !== null && (
            <>
              <span aria-hidden> · </span>
              <span className="sr-only">, odd justa </span>
              {formatOdd(s.fairOdd)}
            </>
          )}
        </span>
      )}
      {s.aiPick && (
        <>
          <Badge
            size="xs"
            variant="outline"
            aria-hidden
            className="absolute -top-2 right-1 gap-0.5 border-edge-border bg-edge-soft text-edge-fg"
          >
            <Sparkles className="size-3" />
            IA
          </Badge>
          <span className="sr-only">, recomendada pela análise da IA</span>
        </>
      )}
    </>
  );
  if (!slip) {
    return (
      <div className={cn(base, s.aiPick ? "border-edge-border" : "border-border")}>{content}</div>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => slip.toggle(s)}
      className={cn(
        base,
        "transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        selected
          ? "border-foreground bg-foreground text-background"
          : s.aiPick
            ? "border-edge-border hover:border-foreground/40"
            : "border-border hover:border-foreground/40",
      )}
    >
      {content}
    </button>
  );
}

function ExactScoreRow({ grid, slip }: { grid: BetGridView; slip: BetSlipContextValue }) {
  const [home, setHome] = useState(1);
  const [away, setAway] = useState(0);
  const goals = Array.from({ length: MAX_EXACT_SCORE_GOALS + 1 }, (_, i) => i);
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <span className="text-meta uppercase tracking-label text-muted-foreground">Placar exato</span>
      {grid.topScores.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {grid.topScores.map((s) => (
            <SelectionCell
              key={s.id}
              s={s}
              byAnalysis={false}
              slip={slip}
              live={grid.live !== null}
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
        <Button type="button" size="xs" variant="outline" onClick={() => slip.addScore(home, away)}>
          Adicionar placar
        </Button>
      </div>
    </div>
  );
}

function FreeText({ slip }: { slip: BetSlipContextValue }) {
  const { parseState } = slip;
  const parseError = parseState && !parseState.ok ? parseState.error : null;
  const parseWarnings = parseState?.ok ? parseState.warnings : [];
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <form action={slip.parseAction} className="flex flex-col gap-2">
        <input type="hidden" name="matchId" value={slip.matchId} />
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
        <Button type="submit" size="sm" variant="outline" disabled={slip.parsing} className="w-fit">
          {slip.parsing ? "Lendo…" : "Preencher com o texto"}
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
        O texto é lido pela IA (conta no limite de leituras de aposta) e só preenche a lista:
        nada é registrado até você confirmar.
      </p>
    </div>
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
