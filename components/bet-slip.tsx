"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { Ticket, X } from "lucide-react";

import {
  slipFullNotice,
  useBetSlipBridge,
  type BridgeAddOutcome,
} from "@/components/bet-slip-bridge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatOdd, formatPct } from "@/lib/format-number";
import { registerBetSlip, type RegisterBetSlipResult } from "@/app/actions/bet-slip";
import { parseBet, type ParseBetResult } from "@/app/actions/bets";
import type { BetLegParams } from "@/db/schema";
import { MAX_LEGS, MAX_RAW_INPUT } from "@/lib/ai/bet-parse/schema";
import {
  legGroupKey,
  legSelectionId,
  MAX_EXACT_SCORE_GOALS,
  MAX_SLIP_SELECTIONS,
} from "@/lib/bets/slip-markets";
import type { BridgeLeg } from "@/lib/user-palpite/types";
import { cn } from "@/lib/utils";
import type {
  BetGridView,
  EvaluatedComboView,
  EvaluatedLegView,
  GridSelectionView,
  SlipEvaluationView,
} from "@/lib/view/bet-slip";

// Registrar apostas (Fase 2, #556), no estilo das casas: a grade de mercados com a odd
// de referência (ou a odd justa do modelo, em cinza) e a lista "Suas apostas" ao lado
// (desktop) ou numa folha que sobe do rodapé (celular). O app REGISTRA a aposta que o
// usuário fez em outro lugar — nunca "Apostar", nunca link ou nome de casa como destino
// (ADR 0034 §12, ADR 0048). A avaliação vem do servidor, em código, depois de registrar.

// Aviso de risco completo (ADR 0034 §12, docs/ops/05-legal-compliance.md §3), VERBATIM.
const RISK_DISCLAIMER_PT_BR =
  "Aposta não é investimento. As recomendações do Palpiteiro são análises e não garantem resultado. Aposte com responsabilidade, só o que você pode perder, e nunca para recuperar perdas. Se a aposta deixou de ser diversão, procure ajuda.";

type SlipLeg = {
  id: string;
  groupKey: string;
  kind: string;
  params: BetLegParams;
  label: string;
  oddInput: string;
  // A odd veio pré-preenchida com a de referência (até o usuário editar).
  oddFromReference: boolean;
  stakeInput: string;
  fairOdd: number | null;
  modelProbPct: number | null;
};

type Mode = "simples" | "combinada";

type ParseMeta = { rawInput: string; parseAiCallId: string | null };

// Odd que o usuário digitou: mantém as casas que ele deu (1.925 não vira 1,93).
const ptUserOdd = (n: number) =>
  (Number.isInteger(n * 100) ? n.toFixed(2) : String(n)).replace(".", ",");

function legFromSelection(s: GridSelectionView): SlipLeg {
  return {
    id: s.id,
    groupKey: s.groupKey,
    kind: s.kind,
    params: s.params,
    label: s.legLabel,
    oddInput: s.referenceOdd === null ? "" : formatOdd(s.referenceOdd),
    oddFromReference: s.referenceOdd !== null,
    stakeInput: "",
    fairOdd: s.fairOdd,
    modelProbPct: s.modelProbPct,
  };
}

// Uma instância só por página (#576): a grade e o painel numa grade responsiva. O painel
// fica ao lado no desktop e numa folha no celular; o estado da lista é um só.
export function BetSlip({ matchId, grid }: { matchId: string; grid: BetGridView }) {
  const [legs, setLegs] = useState<SlipLeg[]>([]);
  const [mode, setMode] = useState<Mode>("simples");
  const [comboOddInput, setComboOddInput] = useState("");
  const [comboStakeInput, setComboStakeInput] = useState("");
  const [parseMeta, setParseMeta] = useState<ParseMeta | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const [registerState, registerAction, registering] = useActionState<
    RegisterBetSlipResult | null,
    FormData
  >(registerBetSlip, null);
  const [parseState, parseAction, parsing] = useActionState<
    ParseBetResult | null,
    FormData
  >(parseBet, null);

  // Todas as seleções da grade por id (pra o atalho em texto achar odd e chance).
  const byId = useMemo(() => {
    const map = new Map<string, GridSelectionView>();
    for (const g of grid.groups) for (const s of g.selections) map.set(s.id, s);
    for (const s of grid.topScores) map.set(s.id, s);
    return map;
  }, [grid]);

  const canCombine = legs.length >= 2 && legs.length <= MAX_LEGS;
  const effectiveMode: Mode = mode === "combinada" && canCombine ? "combinada" : "simples";

  // Devolve quantas entraram, quantas já estavam e se a lista encheu (a ponte com o
  // "Seu palpite" usa isso pra não dizer "adicionado" à toa).
  function addLegs(next: SlipLeg[]): { added: number; duplicates: number; full: boolean } {
    let out = [...legs];
    let full = false;
    let added = 0;
    let duplicates = 0;
    for (const leg of next) {
      if (out.some((l) => l.id === leg.id)) {
        duplicates++;
        continue;
      }
      // Uma seleção por mercado (como nas casas); placar exato aceita vários.
      if (leg.kind !== "exact_score") {
        out = out.filter((l) => l.groupKey !== leg.groupKey);
      }
      if (out.length >= MAX_SLIP_SELECTIONS) {
        full = true;
        break;
      }
      out.push(leg);
      added++;
    }
    setLegs(out);
    setNotice(full ? slipFullNotice : null);
    return { added, duplicates, full };
  }

  // Perna a partir de (kind, params): a da grade quando existe (traz a odd de referência
  // e a chance); senão (placar fora da grade) montada com a chance da matriz.
  function legFromKindParams(kind: BridgeLeg["kind"], params: BridgeLeg["params"]): SlipLeg {
    const id = legSelectionId(kind, params);
    const fromGrid = byId.get(id);
    if (fromGrid) return legFromSelection(fromGrid);
    if ("selection" in params) {
      const { selection } = params;
      return {
        id,
        groupKey: legGroupKey(kind, params),
        kind,
        params,
        label:
          selection === "draw"
            ? "Empate"
            : `Vitória do ${selection === "home" ? grid.teams.home : grid.teams.away}`,
        oddInput: "",
        oddFromReference: false,
        stakeInput: "",
        fairOdd: null,
        modelProbPct: null,
      };
    }
    const { home, away } = params;
    const prob = grid.exactScoreProbPct?.[home]?.[away] ?? null;
    return {
      id,
      groupKey: "exact_score",
      kind: "exact_score",
      params: { home, away },
      label: `Placar exato: ${grid.teams.home} ${home} × ${away} ${grid.teams.away}`,
      oddInput: "",
      oddFromReference: false,
      stakeInput: "",
      fairOdd: prob !== null && prob > 0 ? Math.round((100 / prob) * 100) / 100 : null,
      modelProbPct: prob,
    };
  }

  // Ponte com o "Seu palpite" (#564). O ref é reatribuído depois de cada render (no
  // efeito), então o handler sempre vê a lista atual.
  const bridge = useBetSlipBridge();
  const sectionRef = useRef<HTMLElement>(null);
  const fromBridge = useRef<(leg: BridgeLeg) => BridgeAddOutcome>(() => "duplicate");
  useEffect(() => {
    fromBridge.current = (leg) => {
      const r = addLegs([legFromKindParams(leg.kind, leg.params)]);
      // Desktop (lg, 1024px): o painel está ao lado da grade → rola até a seção. Celular:
      // abre a folha. Os `?.` são de propósito: sem matchMedia (jsdom), cai na folha.
      const desktop = window.matchMedia?.("(min-width: 1024px)")?.matches === true;
      if (desktop) sectionRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      else setSheetOpen(true);
      return r.added > 0 ? "added" : r.full ? "full" : "duplicate";
    };
  });
  useEffect(() => bridge?.register((leg) => fromBridge.current(leg)), [bridge]);

  function toggle(s: GridSelectionView) {
    if (legs.some((l) => l.id === s.id)) {
      setLegs((prev) => prev.filter((l) => l.id !== s.id));
      return;
    }
    addLegs([legFromSelection(s)]);
  }

  function updateLeg(id: string, patch: Partial<SlipLeg>) {
    setLegs((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function clearSlip() {
    setLegs([]);
    setComboOddInput("");
    setComboStakeInput("");
    setParseMeta(null);
    setMode("simples");
  }

  // Atalho "digite sua aposta": o parse (1 chamada, validada por Zod) PREENCHE a lista.
  const lastParse = useRef<ParseBetResult | null>(null);
  useEffect(() => {
    if (!parseState || parseState === lastParse.current) return;
    lastParse.current = parseState;
    if (!parseState.ok) return;
    const parsedLegs: SlipLeg[] = parseState.legs.map((l) => {
      const id = legSelectionId(l.kind, l.params);
      const fromGrid = byId.get(id);
      return {
        id,
        groupKey: legGroupKey(l.kind, l.params),
        kind: l.kind,
        params: l.params,
        label:
          fromGrid?.legLabel ??
          l.selectionLabel
            .replace("Mandante", grid.teams.home)
            .replace("Visitante", grid.teams.away),
        oddInput: l.userOdd === null ? "" : ptUserOdd(l.userOdd),
        oddFromReference: false,
        stakeInput: "",
        fairOdd: fromGrid?.fairOdd ?? null,
        modelProbPct: fromGrid?.modelProbPct ?? null,
      };
    });
    addLegs(parsedLegs);
    setParseMeta({ rawInput: parseState.rawInput, parseAiCallId: parseState.parseAiCallId });
    if (parseState.comboUserOdd !== null && parsedLegs.length >= 2) {
      setMode("combinada");
      setComboOddInput(ptUserOdd(parseState.comboUserOdd));
    }
    // addLegs/byId são estáveis o bastante pra este efeito de borda (dispara 1x por parse).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parseState]);

  // Registro ok → limpa a lista (a avaliação fica na tela).
  const lastRegister = useRef<RegisterBetSlipResult | null>(null);
  useEffect(() => {
    if (!registerState || registerState === lastRegister.current) return;
    lastRegister.current = registerState;
    if (registerState.ok) clearSlip();
  }, [registerState]);

  const payload = JSON.stringify({
    matchId,
    mode: effectiveMode,
    legs: legs.map((l) => ({
      kind: l.kind,
      params: l.params,
      // Na combinada vale só a odd da combinada: a odd por perna não vai.
      ...(effectiveMode === "simples" && l.oddInput.trim()
        ? { userOdd: l.oddInput.trim() }
        : {}),
      ...(effectiveMode === "simples" && l.stakeInput.trim()
        ? { stakeUnits: l.stakeInput.trim() }
        : {}),
    })),
    ...(effectiveMode === "combinada" && comboOddInput.trim()
      ? { comboUserOdd: comboOddInput.trim() }
      : {}),
    ...(effectiveMode === "combinada" && comboStakeInput.trim()
      ? { comboStakeUnits: comboStakeInput.trim() }
      : {}),
    ...(parseMeta
      ? { rawInput: parseMeta.rawInput, parseAiCallId: parseMeta.parseAiCallId }
      : {}),
  });

  const selectedIds = new Set(legs.map((l) => l.id));

  const panel = (
    <SlipPanel
      legs={legs}
      mode={effectiveMode}
      canCombine={canCombine}
      onMode={setMode}
      onRemove={(id) => setLegs((prev) => prev.filter((l) => l.id !== id))}
      onUpdate={updateLeg}
      onClear={clearSlip}
      comboOddInput={comboOddInput}
      comboStakeInput={comboStakeInput}
      onComboOdd={setComboOddInput}
      onComboStake={setComboStakeInput}
      payload={payload}
      registerAction={registerAction}
      registering={registering}
      registerState={registerState}
      notice={notice}
    />
  );

  const grid_ = (
    <MarketGrid
      matchId={matchId}
      grid={grid}
      selectedIds={selectedIds}
      onToggle={toggle}
      onAddScore={(home, away) => {
        addLegs([legFromKindParams("exact_score", { home, away })]);
      }}
      parseAction={parseAction}
      parsing={parsing}
      parseError={parseState && !parseState.ok ? parseState.error : null}
      parseWarnings={parseState?.ok ? parseState.warnings : []}
    />
  );

  const count = legs.length;

  // O par lg:hidden / hidden lg:block mora AQUI, não na página (#576): é o painel ao lado
  // × barra + folha, com um estado só. O SheetContent só monta aberto, então o painel
  // aparece duas vezes no DOM só com a folha aberta no celular.
  return (
    <section ref={sectionRef} className="flex flex-col gap-3" data-tour="bet-slip">
      <SectionHeading modelLabel={grid.model?.label ?? null} />
      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-4">
        {grid_}
        <div className="hidden lg:sticky lg:top-20 lg:block">{panel}</div>
      </div>
      {/* Celular: o painel (com o §3) fica na folha modal, que cobre a página; o §3 fica
          também à vista junto da grade (ADR 0057 item 1). No desktop o painel está ao lado. */}
      <p className="text-meta leading-relaxed text-muted-foreground tracking-tight lg:hidden">
        {RISK_DISCLAIMER_PT_BR}
      </p>
      {(count > 0 || registerState) && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:hidden">
          <Button className="w-full" onClick={() => setSheetOpen(true)}>
            <Ticket className="size-4" aria-hidden />
            {count > 0 ? `Suas apostas (${count})` : "Ver avaliação"}
          </Button>
        </div>
      )}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto p-0">
          <SheetHeader className="pb-0">
            <SheetTitle>Suas apostas</SheetTitle>
            <SheetDescription>
              Ajuste a odd que você pegou e registre. A avaliação sai na hora.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">{panel}</div>
        </SheetContent>
      </Sheet>
      {/* Espaço pra barra fixa não cobrir o fim da página. */}
      {(count > 0 || registerState) && <div className="h-16 lg:hidden" aria-hidden />}
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
  selectedIds: Set<string>;
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

// ── Suas apostas (lista + registro + avaliação) ─────────────────────────────

const INPUT =
  "w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-body-sm tabular-nums focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

function SlipPanel(props: {
  legs: SlipLeg[];
  mode: Mode;
  canCombine: boolean;
  onMode: (m: Mode) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, patch: Partial<SlipLeg>) => void;
  onClear: () => void;
  comboOddInput: string;
  comboStakeInput: string;
  onComboOdd: (v: string) => void;
  onComboStake: (v: string) => void;
  payload: string;
  registerAction: (fd: FormData) => void;
  registering: boolean;
  registerState: RegisterBetSlipResult | null;
  notice: string | null;
}) {
  const { legs, mode } = props;
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span className="text-meta uppercase tracking-eyebrow text-muted-foreground">
          suas apostas{legs.length > 0 ? ` (${legs.length})` : ""}
        </span>
        {legs.length > 0 && (
          <button
            type="button"
            onClick={props.onClear}
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
        <form action={props.registerAction} className="flex flex-col gap-3 px-4 py-3">
          <input type="hidden" name="slip" value={props.payload} />
          <div
            role="group"
            aria-label="tipo de aposta"
            className="inline-flex w-fit gap-1 rounded-md border border-border p-1"
          >
            <ModeButton active={mode === "simples"} onClick={() => props.onMode("simples")}>
              Simples
            </ModeButton>
            <ModeButton
              active={mode === "combinada"}
              disabled={!props.canCombine}
              onClick={() => props.onMode("combinada")}
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
                  onClick={() => props.onRemove(leg.id)}
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
                        props.onUpdate(leg.id, {
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
                        onChange={(e) => props.onUpdate(leg.id, { stakeInput: e.target.value })}
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
                  value={props.comboOddInput}
                  placeholder="ex.: 3,40"
                  onChange={(e) => props.onComboOdd(e.target.value)}
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
                  value={props.comboStakeInput}
                  placeholder="1"
                  onChange={(e) => props.onComboStake(e.target.value)}
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

          {props.notice && (
            <p className="text-body-sm text-muted-foreground tracking-tight">{props.notice}</p>
          )}

          <Button type="submit" disabled={props.registering}>
            {props.registering ? "Registrando…" : "Registrar apostas"}
          </Button>
        </form>
      )}

      {props.registerState && !props.registerState.ok && (
        <p
          className="px-4 pb-3 text-body-sm text-destructive tracking-tight"
          role="alert"
          aria-live="assertive"
        >
          {props.registerState.error}
        </p>
      )}

      {props.registerState?.ok && (
        <>
          <Separator />
          <Evaluation
            view={props.registerState.evaluation}
            registered={props.registerState.registered}
          />
        </>
      )}

      <Separator />
      <p className="px-4 py-3 text-meta leading-relaxed text-muted-foreground tracking-tight">
        {RISK_DISCLAIMER_PT_BR}
      </p>
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
