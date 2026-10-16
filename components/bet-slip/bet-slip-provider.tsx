"use client";

import {
  createContext,
  useActionState,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { registerBetSlip, type RegisterBetSlipResult } from "@/app/actions/bet-slip";
import { parseBet, type ParseBetResult } from "@/app/actions/bets";
import type { BetLegParams } from "@/db/schema";
import { MAX_LEGS } from "@/lib/ai/bet-parse/schema";
import { legGroupKey, legSelectionId, MAX_SLIP_SELECTIONS } from "@/lib/bets/slip-markets";
import { formatOdd } from "@/lib/format-number";
import { isDecided } from "@/lib/quant/in-play";
import type { BridgeLeg } from "@/lib/user-palpite/types";
import type { BetGridView, GridSelectionView } from "@/lib/view/bet-slip";

// Estado de "Suas apostas" (Fase 2, #556) num provider só (#576): a tabela de mercados,
// o painel (coluna no desktop, folha no celular) e o "Seu palpite" (#564) leem e mexem
// na MESMA lista, de qualquer aba. O app REGISTRA a aposta que o usuário fez em outro
// lugar; a avaliação vem do servidor, em código, depois de registrar.

// Aviso de lista cheia: o mesmo texto no painel e no "Seu palpite".
export const slipFullNotice = `No máximo ${MAX_SLIP_SELECTIONS} seleções por vez.`;

// O que aconteceu com a perna vinda do "Seu palpite": entrou, já estava, ou a lista
// está cheia. "unavailable" = a tabela ainda não chegou (streaming).
export type BridgeAddOutcome = "added" | "duplicate" | "full";

export type SlipLeg = {
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

export type SlipMode = "simples" | "combinada";

type ParseMeta = { rawInput: string; parseAiCallId: string | null };

export type BetSlipContextValue = {
  matchId: string;
  grid: BetGridView | null;
  legs: SlipLeg[];
  selectedIds: ReadonlySet<string>;
  // O modo valendo (combinada só com 2 a MAX_LEGS seleções).
  mode: SlipMode;
  canCombine: boolean;
  setMode: (m: SlipMode) => void;
  comboOddInput: string;
  comboStakeInput: string;
  setComboOddInput: (v: string) => void;
  setComboStakeInput: (v: string) => void;
  notice: string | null;
  sheetOpen: boolean;
  setSheetOpen: (open: boolean) => void;
  toggle: (s: GridSelectionView) => void;
  addScore: (home: number, away: number) => void;
  add: (leg: BridgeLeg) => BridgeAddOutcome | "unavailable";
  remove: (id: string) => void;
  update: (id: string, patch: Partial<SlipLeg>) => void;
  clear: () => void;
  // A tabela se registra ao montar (é ela que traz odd e chance de cada seleção).
  registerGrid: (grid: BetGridView) => () => void;
  payload: string;
  registerAction: (fd: FormData) => void;
  registering: boolean;
  registerState: RegisterBetSlipResult | null;
  parseAction: (fd: FormData) => void;
  parsing: boolean;
  parseState: ParseBetResult | null;
};

const BetSlipContext = createContext<BetSlipContextValue | null>(null);

// Odd que o usuário digitou: mantém as casas que ele deu (1.925 não vira 1,93).
const ptUserOdd = (n: number) =>
  (Number.isInteger(n * 100) ? n.toFixed(2) : String(n)).replace(".", ",");

// Ao vivo (#580) a odd NÃO é pré-preenchida (`prefillOdd: false`): a de referência é de
// antes do jogo e não é a odd que a pessoa pegou. O campo fica vazio e a avaliação diz
// "sem a odd que você pegou…" até ela digitar.
function legFromSelection(s: GridSelectionView, prefillOdd = true): SlipLeg {
  const prefill = prefillOdd && s.referenceOdd !== null;
  return {
    id: s.id,
    groupKey: s.groupKey,
    kind: s.kind,
    params: s.params,
    label: s.legLabel,
    oddInput: prefill && s.referenceOdd !== null ? formatOdd(s.referenceOdd) : "",
    oddFromReference: prefill,
    stakeInput: "",
    fairOdd: s.fairOdd,
    modelProbPct: s.modelProbPct,
  };
}

// Perna a partir de (kind, params): a da tabela quando existe (traz a odd de referência
// e a chance); senão (placar fora da tabela) montada com a chance da matriz.
function legFromKindParams(
  grid: BetGridView,
  byId: ReadonlyMap<string, GridSelectionView>,
  kind: BridgeLeg["kind"],
  params: BridgeLeg["params"],
): SlipLeg {
  const id = legSelectionId(kind, params);
  const fromGrid = byId.get(id);
  if (fromGrid) return legFromSelection(fromGrid, grid.prefillOdd);
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

// Desktop (lg, 1024px): o painel está à vista na coluna. Os `?.` são de propósito: sem
// matchMedia (jsdom) conta como celular.
export function isDesktopViewport(): boolean {
  return window.matchMedia?.("(min-width: 1024px)")?.matches === true;
}

export function BetSlipProvider({
  matchId,
  children,
}: {
  matchId: string;
  children: ReactNode;
}) {
  const [grid, setGrid] = useState<BetGridView | null>(null);
  const [legs, setLegs] = useState<SlipLeg[]>([]);
  const [mode, setMode] = useState<SlipMode>("simples");
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

  // Todas as seleções da tabela por id (pra o atalho em texto e o "Seu palpite" acharem
  // odd e chance).
  const byId = useMemo(() => {
    const map = new Map<string, GridSelectionView>();
    if (!grid) return map;
    for (const g of grid.groups) for (const s of g.selections) map.set(s.id, s);
    for (const s of grid.topScores) map.set(s.id, s);
    return map;
  }, [grid]);

  const canCombine = legs.length >= 2 && legs.length <= MAX_LEGS;
  const effectiveMode: SlipMode = mode === "combinada" && canCombine ? "combinada" : "simples";

  // Devolve quantas entraram, quantas já estavam e se a lista encheu (o "Seu palpite"
  // usa isso pra não dizer "adicionado" à toa).
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

  function clear() {
    setLegs([]);
    setComboOddInput("");
    setComboStakeInput("");
    setParseMeta(null);
    setMode("simples");
  }

  const registerGrid = useCallback((g: BetGridView) => {
    setGrid(g);
    return () => setGrid((cur) => (cur === g ? null : cur));
  }, []);

  // Atalho "digite sua aposta": o parse (1 chamada, validada por Zod) PREENCHE a lista.
  const lastParse = useRef<ParseBetResult | null>(null);
  useEffect(() => {
    if (!parseState || parseState === lastParse.current) return;
    lastParse.current = parseState;
    if (!parseState.ok || !grid) return;
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
    // addLegs/byId/grid são estáveis o bastante pra este efeito de borda (1x por parse).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parseState]);

  // Registro ok → limpa a lista (a avaliação fica na tela).
  const lastRegister = useRef<RegisterBetSlipResult | null>(null);
  useEffect(() => {
    if (!registerState || registerState === lastRegister.current) return;
    lastRegister.current = registerState;
    if (registerState.ok) clear();
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
    // A tabela desta página está no modo ao vivo? A action recusa registro ao vivo de
    // uma página aberta antes do apito (odd de pré-jogo pré-preenchida).
    gridLive: grid?.live != null,
  });

  const value: BetSlipContextValue = {
    matchId,
    grid,
    legs,
    selectedIds: new Set(legs.map((l) => l.id)),
    mode: effectiveMode,
    canCombine,
    setMode,
    comboOddInput,
    comboStakeInput,
    setComboOddInput,
    setComboStakeInput,
    notice,
    sheetOpen,
    setSheetOpen,
    toggle(s) {
      if (legs.some((l) => l.id === s.id)) {
        setLegs((prev) => prev.filter((l) => l.id !== s.id));
        return;
      }
      // Célula decidida não é botão; a guarda repete a regra do servidor.
      if (s.decided) return;
      addLegs([legFromSelection(s, grid?.prefillOdd ?? true)]);
    },
    addScore(home, away) {
      if (!grid) return;
      // Ao vivo, placar abaixo do atual já perdeu (o servidor também recusa).
      if (grid.live && isDecided("exact_score", { home, away }, grid.live.score)) {
        setNotice("Esse placar já ficou para trás.");
        return;
      }
      addLegs([legFromKindParams(grid, byId, "exact_score", { home, away })]);
    },
    add(leg) {
      if (!grid) return "unavailable";
      const r = addLegs([legFromKindParams(grid, byId, leg.kind, leg.params)]);
      // Celular: o painel está numa folha, então ela abre. No desktop o painel já está à
      // vista na coluna e a mensagem do "Seu palpite" fica onde o usuário clicou.
      if (!isDesktopViewport()) setSheetOpen(true);
      return r.added > 0 ? "added" : r.full ? "full" : "duplicate";
    },
    remove(id) {
      setLegs((prev) => prev.filter((l) => l.id !== id));
    },
    update(id, patch) {
      setLegs((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    },
    clear,
    registerGrid,
    payload,
    registerAction,
    registering,
    registerState,
    parseAction,
    parsing,
    parseState,
  };

  return <BetSlipContext.Provider value={value}>{children}</BetSlipContext.Provider>;
}

/** Estado de "Suas apostas"; null fora do provider (página sem registro). */
export function useBetSlip(): BetSlipContextValue | null {
  return useContext(BetSlipContext);
}

/** O que o "Seu palpite" usa: só mandar uma perna pra lista. */
export function useBetSlipBridge(): Pick<BetSlipContextValue, "add"> | null {
  return useBetSlip();
}
