"use client";

import { useActionState, useId, useMemo, useState } from "react";

import {
  slipFullNotice,
  useBetSlipBridge,
  type BridgeAddOutcome,
} from "@/components/bet-slip/bet-slip-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  analyzeUserPalpite,
  type AnalyzeUserPalpiteResult,
} from "@/app/actions/user-palpite";
import {
  isPastScore,
  palpiteToLeg,
  readingMatrix,
  readPalpite,
  type TeamNames,
} from "@/lib/user-palpite/reading";
import {
  MAX_PALPITE_GOALS,
  MAX_REASON_CHARS,
  MIN_REASON_CHARS,
  type ClaimStatus,
  type PalpiteResult,
  type UserPalpite,
} from "@/lib/user-palpite/types";
import { markRouterCacheStale } from "@/lib/nav/router-cache";
import { cn } from "@/lib/utils";
import {
  toReadingRowsView,
  type ReadingRowsView,
  type SeuPalpiteModelView,
  type UserPalpiteAnalysisView,
} from "@/lib/view/user-palpite";

// Bloco "Seu palpite" da página do jogo (#564, ADR 0055). Duas camadas:
// 1. leitura GRÁTIS pelos botões: o cliente refaz a matriz com o λ/ρ que o servidor
//    serializou e lê na hora, sem round-trip e sem IA;
// 2. "Analisar meu palpite" (opcional, conta 1 do limite diário de palpites): a IA lê
//    o motivo, o código confere cada afirmação e o modelo recalcula.
// É leitura de probabilidade, não dica: nada de preço de casa, vantagem ou valor por
// aqui (envelope legal, ADR 0048/0053). Sem aviso de risco próprio (ADR 0057, emenda a
// 0055 D10): o §3 completo fica no registro de apostas, na mesma tela.

// Rótulos literais aqui de propósito: o guia /como-usar confere que eles existem na UI.
const STATUS_CHIP: Record<ClaimStatus, string> = {
  confirmed: "confirmada",
  contradicted: "contradita",
  unverifiable: "não verificável",
};

const STATUS_BADGE: Record<ClaimStatus, "secondary" | "destructive" | "outline"> = {
  confirmed: "secondary",
  contradicted: "destructive",
  unverifiable: "outline",
};

const ADD_MESSAGE: Record<BridgeAddOutcome | "unavailable", string> = {
  added: "Adicionado em Suas apostas.",
  duplicate: "Já está em Suas apostas.",
  full: slipFullNotice,
  unavailable: "A lista de apostas ainda está carregando. Tente de novo em instantes.",
};

const CHIP_GOALS = [0, 1, 2, 3, 4, 5];
const ALL_GOALS = Array.from({ length: MAX_PALPITE_GOALS + 1 }, (_, i) => i);

type Mode = "score" | "result";

export function SeuPalpite({
  matchId,
  teams,
  model,
  latest,
  aiEnabled,
}: {
  matchId: string;
  teams: TeamNames;
  model: SeuPalpiteModelView | null;
  latest: UserPalpiteAnalysisView | null;
  aiEnabled: boolean;
}) {
  const [mode, setMode] = useState<Mode>("score");
  const [homeGoals, setHomeGoals] = useState<number | null>(null);
  const [awayGoals, setAwayGoals] = useState<number | null>(null);
  const [result, setResult] = useState<PalpiteResult | null>(null);
  const [otherHome, setOtherHome] = useState(1);
  const [otherAway, setOtherAway] = useState(0);
  const [addMessage, setAddMessage] = useState<string | null>(null);

  const palpite = useMemo<UserPalpite | null>(() => {
    if (mode === "result") return result === null ? null : { kind: "result", selection: result };
    return homeGoals === null || awayGoals === null
      ? null
      : { kind: "score", home: homeGoals, away: awayGoals };
  }, [mode, homeGoals, awayGoals, result]);

  // Ao vivo (#594): a matriz é a do placar FINAL a partir do atual (model.inPlay).
  const matrix = useMemo(() => (model ? readingMatrix(model) : null), [model]);
  const inPlay = model?.inPlay ?? null;
  const past = palpite !== null && isPastScore(palpite, inPlay);
  const rows = useMemo(() => {
    if (!model || !matrix || !palpite || isPastScore(palpite, model.inPlay)) return null;
    const reading = readPalpite(
      { matrix, lambdaHome: model.lambdaHome, lambdaAway: model.lambdaAway },
      palpite,
    );
    return toReadingRowsView(reading, palpite, teams);
  }, [model, matrix, palpite, teams]);

  const bridge = useBetSlipBridge();
  function addToSlip() {
    if (!palpite) return;
    const outcome = bridge?.add(palpiteToLeg(palpite)) ?? "unavailable";
    setAddMessage(ADD_MESSAGE[outcome]);
  }

  function pickScore(side: "home" | "away", n: number) {
    setAddMessage(null);
    if (side === "home") setHomeGoals(n);
    else setAwayGoals(n);
  }

  function pickResult(r: PalpiteResult) {
    setAddMessage(null);
    setResult(r);
  }

  const [state, analyzeAction, analyzing] = useActionState<
    AnalyzeUserPalpiteResult | null,
    FormData
  >(async (prev, formData) => {
    const result = await analyzeUserPalpite(prev, formData);
    // A action não revalida (a tela mostra o retorno): a página do jogo guardada no
    // cache do roteador é relida quando reaberta (#639).
    if (result.ok) markRouterCacheStale();
    return result;
  }, null);
  const analysis = state?.ok ? state.analysis : latest;

  const picker = model && (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="tipo de palpite">
        <ToggleButton pressed={mode === "score"} onClick={() => setMode("score")}>
          Placar
        </ToggleButton>
        <ToggleButton pressed={mode === "result"} onClick={() => setMode("result")}>
          Resultado
        </ToggleButton>
      </div>
      {mode === "score" ? (
        <div className="flex flex-col gap-2">
          {(["home", "away"] as const).map((side) => {
            const value = side === "home" ? homeGoals : awayGoals;
            return (
              <div key={side} className="flex flex-col gap-1.5">
                <span className="text-body-sm tracking-tight">{teams[side]}</span>
                <div className="grid grid-cols-6 gap-1.5">
                  {CHIP_GOALS.map((n) => {
                    // Gols não se desfazem: abaixo do placar atual "já passou".
                    const gone = inPlay !== null && n < inPlay.score[side];
                    return (
                      <ToggleButton
                        key={n}
                        pressed={value === n}
                        onClick={() => pickScore(side, n)}
                        disabled={gone}
                        ariaLabel={
                          gone
                            ? `${n} gols do ${teams[side]}: já passou`
                            : `${n} gols do ${teams[side]}`
                        }
                      >
                        {n}
                      </ToggleButton>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-meta uppercase tracking-label text-muted-foreground">
              outro placar
            </span>
            <GoalsSelect
              label={teams.home}
              value={otherHome}
              onChange={setOtherHome}
              min={inPlay?.score.home ?? 0}
            />
            <span className="text-muted-foreground">×</span>
            <GoalsSelect
              label={teams.away}
              value={otherAway}
              onChange={setOtherAway}
              min={inPlay?.score.away ?? 0}
            />
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => {
                pickScore("home", otherHome);
                pickScore("away", otherAway);
              }}
            >
              Usar placar
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {(["home", "draw", "away"] as const).map((r) => (
            <ToggleButton key={r} pressed={result === r} onClick={() => pickResult(r)}>
              {r === "draw" ? "Empate" : `Vitória do ${teams[r]}`}
            </ToggleButton>
          ))}
        </div>
      )}
    </div>
  );

  const pastCard = past && inPlay && (
    <p className="text-body-sm tracking-tight text-muted-foreground" role="status">
      Esse placar já passou: o jogo está {inPlay.score.home} × {inPlay.score.away}.
    </p>
  );

  const readingCard = model && rows && (
    <div className="flex flex-col gap-3" data-testid="seu-palpite-reading">
      <ReadingRows rows={rows} teams={teams} />
      <p className="text-body-sm tracking-tight">{rows.sentence}</p>
      <span className="text-meta text-muted-foreground">modelo {model.modelLabel}</span>
      <div className="flex flex-col gap-1.5">
        <Button type="button" size="sm" variant="outline" className="w-fit" onClick={addToSlip}>
          Adicionar às suas apostas
        </Button>
        {addMessage && (
          <p className="text-meta tracking-tight text-muted-foreground" role="status">
            {addMessage}
          </p>
        )}
      </div>
    </div>
  );

  return (
    // O título é a aba "Seu palpite" (#576); o alvo do tour também é o painel da aba.
    <section className="flex flex-col gap-3" aria-label="Seu palpite">
      <p className="max-w-reading text-body-sm tracking-tight text-muted-foreground">
        Qual é o seu palpite? Escolha um placar ou um resultado e veja na hora o que o
        modelo acha. Grátis, sem gastar análise.
      </p>
      {inPlay && (
        <p className="text-meta tracking-tight text-muted-foreground">
          Leitura ao vivo: as chances são do placar final, a partir de{" "}
          <span className="font-mono tabular-nums">
            {inPlay.score.home} × {inPlay.score.away}
          </span>{" "}
          e do tempo que falta.
        </p>
      )}
      <Card className="gap-0 overflow-hidden p-0">
        {model ? (
          <div className="grid gap-4 px-4 py-3.5 lg:grid-cols-2 lg:items-start">
            {picker}
            {readingCard ?? pastCard ?? (
              <p className="text-body-sm tracking-tight text-muted-foreground">
                Escolha um placar ou um resultado para ver a chance pelo modelo.
              </p>
            )}
          </div>
        ) : (
          <p className="px-4 py-3.5 text-body-sm tracking-tight text-muted-foreground">
            Ainda não temos o modelo deste jogo.
          </p>
        )}
        {model && (
          <>
            <Separator />
            <div className="px-4 py-3.5">
              {aiEnabled ? (
                <AnalyzeForm
                  matchId={matchId}
                  palpite={past ? null : palpite}
                  live={inPlay !== null}
                  action={analyzeAction}
                  pending={analyzing}
                  error={state && !state.ok ? state.error : null}
                />
              ) : (
                <p className="text-body-sm tracking-tight text-muted-foreground">
                  A análise do motivo está desligada no momento. A leitura pelos botões
                  continua valendo.
                </p>
              )}
            </div>
          </>
        )}
      </Card>
      {analysis && <AnalysisCard analysis={analysis} teams={teams} />}
    </section>
  );
}

// ── Peças ───────────────────────────────────────────────────────────────────

function ToggleButton({
  pressed,
  onClick,
  ariaLabel,
  disabled = false,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  ariaLabel?: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex min-h-10 items-center justify-center rounded-md border px-2 py-1.5 text-center text-body-sm tracking-tight transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40",
        pressed
          ? "border-foreground bg-foreground text-background"
          : "border-border hover:border-foreground/40",
      )}
    >
      <span className="line-clamp-1">{children}</span>
    </button>
  );
}

function GoalsSelect({
  label,
  value,
  onChange,
  min = 0,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  // Ao vivo: gols abaixo do placar atual já passaram.
  min?: number;
}) {
  return (
    <select
      aria-label={`gols do ${label}`}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-8 rounded-md border border-border bg-transparent px-2 font-mono text-body-sm tabular-nums focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {ALL_GOALS.map((n) => (
        <option key={n} value={n} disabled={n < min}>
          {n}
        </option>
      ))}
    </select>
  );
}

function ReadingRows({ rows, teams }: { rows: ReadingRowsView; teams: TeamNames }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="text-body-sm tracking-tight text-muted-foreground">
          {rows.palpiteTitle}:
        </span>
        <span className="font-mono text-label font-medium tabular-nums">{rows.palpitePct}</span>
        {rows.rank && (
          <span className="text-meta text-muted-foreground">{rows.rank}</span>
        )}
      </div>
      {rows.result && (
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className="text-body-sm tracking-tight text-muted-foreground">
            {rows.result.title}:
          </span>
          <span className="font-mono text-body-sm tabular-nums">{rows.result.pct}</span>
        </div>
      )}
      <p className="font-mono text-body-sm tabular-nums text-muted-foreground">
        {teams.home} {rows.oneXTwo.home} · empate {rows.oneXTwo.draw} · {teams.away}{" "}
        {rows.oneXTwo.away}
      </p>
      {rows.top.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-meta uppercase tracking-label text-muted-foreground">
            {rows.topTitle}
          </span>
          <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-body-sm tabular-nums">
            {rows.top.map((c) => (
              <span key={c.label} className={cn(c.isPalpite && "font-medium underline")}>
                {c.label} <span className="text-muted-foreground">· {c.pct}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AnalyzeForm({
  matchId,
  palpite,
  live,
  action,
  pending,
  error,
}: {
  matchId: string;
  palpite: UserPalpite | null;
  // A página foi montada com o jogo rolando: o servidor recusa o pedido ao vivo vindo de
  // uma página de pré-jogo (pede para atualizar).
  live: boolean;
  action: (fd: FormData) => void;
  pending: boolean;
  error: string | null;
}) {
  const [reason, setReason] = useState("");
  const reasonId = useId();
  const hintId = useId();
  const ready = palpite !== null && reason.trim().length >= MIN_REASON_CHARS;
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="matchId" value={matchId} />
      <input type="hidden" name="palpite" value={palpite ? JSON.stringify(palpite) : ""} />
      <input type="hidden" name="pageLive" value={live ? "1" : "0"} />
      <label
        htmlFor={reasonId}
        className="text-meta uppercase tracking-label text-muted-foreground"
      >
        por que você acha isso?
      </label>
      <textarea
        id={reasonId}
        name="reason"
        maxLength={MAX_REASON_CHARS}
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        aria-describedby={hintId}
        placeholder="Ex.: o Flamengo vem de três vitórias e o Palmeiras está sem o artilheiro"
        className="rounded-md border border-border bg-transparent px-3 py-2 text-body-sm tracking-tight focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
      <span className="self-end font-mono text-meta tabular-nums text-muted-foreground">
        {reason.length}/{MAX_REASON_CHARS}
      </span>
      <p id={hintId} className="max-w-reading text-meta leading-relaxed text-muted-foreground tracking-tight">
        A IA lê o seu motivo, a gente confere cada afirmação com os nossos dados e o
        modelo recalcula. Conta 1 do seu limite diário de palpites. Não escreva dados
        pessoais.
      </p>
      <Button type="submit" size="sm" disabled={!ready || pending} className="w-fit">
        {pending ? "Analisando…" : "Analisar meu palpite"}
      </Button>
      {palpite === null && (
        <p className="text-meta tracking-tight text-muted-foreground">
          Escolha um placar ou um resultado acima para liberar a análise.
        </p>
      )}
      {error && (
        <p className="text-body-sm text-destructive tracking-tight" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function AnalysisCard({
  analysis,
  teams,
}: {
  analysis: UserPalpiteAnalysisView;
  teams: TeamNames;
}) {
  const a = analysis;
  return (
    <Card className="gap-0 overflow-hidden p-0" data-testid="seu-palpite-analysis">
      <div className="flex flex-col gap-1 px-4 pt-3.5 pb-3">
        <span className="text-meta uppercase tracking-eyebrow text-muted-foreground">
          sua última análise{a.liveLabel ? ` · ${a.liveLabel}` : ""} · {a.createdAgo}
        </span>
        <span className="text-body font-medium tracking-tight">{a.palpiteLabel}</span>
      </div>
      <Separator />
      <div className="flex flex-col gap-3 px-4 py-3.5">
        <div className="flex flex-col gap-1">
          <span className="text-body font-medium tracking-tight">{a.verdictLabel}</span>
          <span className="text-body-sm tracking-tight text-muted-foreground">
            {a.verdictHeadline}
          </span>
        </div>
        <p className="max-w-reading text-body-sm tracking-tight">{a.resumo}</p>

        {a.claims.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-meta uppercase tracking-label text-muted-foreground">
              o que você disse
            </span>
            <ul className="flex flex-col gap-2.5">
              {a.claims.map((c) => (
                <li key={c.index} className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={STATUS_BADGE[c.status]} size="xs">
                      {STATUS_CHIP[c.status]}
                    </Badge>
                    <span className="text-body-sm tracking-tight">{c.text}</span>
                  </div>
                  <span className="text-meta tracking-tight text-muted-foreground">
                    {c.evidence}
                  </span>
                  {c.players.length > 0 && (
                    <span className="text-meta tracking-tight text-muted-foreground">
                      {c.players.map((p) => `${p.name}: ${p.statusLabel}`).join(" · ")}
                    </span>
                  )}
                  <span className="text-meta text-muted-foreground">{c.effect}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 rounded-md border border-border-subtle px-3 py-2.5">
            <span className="text-meta uppercase tracking-label text-muted-foreground">
              sem o seu contexto
            </span>
            <ReadingRows rows={a.without} teams={teams} />
          </div>
          <div className="flex flex-col gap-1.5 rounded-md border border-border-subtle px-3 py-2.5">
            <span className="text-meta uppercase tracking-label text-muted-foreground">
              com o seu contexto
            </span>
            {a.changed ? (
              <ReadingRows rows={a.with} teams={teams} />
            ) : (
              <p className="text-body-sm tracking-tight text-muted-foreground">
                Igual: o seu contexto não mudou a leitura do modelo.
              </p>
            )}
          </div>
        </div>

        {a.pontos.length > 0 && (
          <ul className="flex max-w-reading list-disc flex-col gap-1 pl-5 text-body-sm tracking-tight">
            {a.pontos.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        )}
        {a.discordancias.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-meta uppercase tracking-label text-muted-foreground">
              onde o modelo discorda de você
            </span>
            {a.discordancias.map((d, i) => (
              <p key={i} className="max-w-reading text-body-sm tracking-tight">
                <span className="text-muted-foreground">“{d.claimText}”: </span>
                {d.texto}
              </p>
            ))}
          </div>
        )}
        {a.showFullSquadNote && (
          <p className="max-w-reading text-meta leading-relaxed tracking-tight text-muted-foreground">
            &quot;Time completo&quot; não aumenta a chance no modelo: os ajustes só
            descontam desfalques e rodízio e somam o peso do jogo.
          </p>
        )}
        {a.showUnverifiedNote && (
          <p className="max-w-reading text-meta leading-relaxed tracking-tight text-muted-foreground">
            Não verificável: não temos esse dado; entrou com peso menor.
          </p>
        )}
        {a.warnings.map((w, i) => (
          <p key={i} className="max-w-reading text-meta leading-relaxed tracking-tight text-muted-foreground">
            {w}
          </p>
        ))}
      </div>
      <Separator />
      <div className="px-4 py-2.5 text-meta text-muted-foreground">
        modelo {a.modelLabel} ·{" "}
        {a.narrationSource === "llm" ? "texto por IA" : "texto automático"}
      </div>
    </Card>
  );
}
