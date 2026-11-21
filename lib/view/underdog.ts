import { formatPct } from "@/lib/format-number";
import type { UnderdogViewRecord } from "@/lib/db/queries/underdog-views";
import { underdogNames } from "@/lib/underdog/facts";
import {
  isMaterialSame,
  underdogTeaserVisible,
  type UnderdogPick,
} from "@/lib/underdog/gate";
import {
  oneInN,
  scenarioLabel,
  signalLabel,
  signalOrigin,
} from "@/lib/underdog/labels";
import type {
  UnderdogFacts,
  UnderdogNarrative,
  UnderdogNarrativeSource,
} from "@/lib/underdog/types";

// O painel "Chances do azarão" pronto pra tela (#671, ADR 0072): nomes de exibição,
// percentuais formatados e o estado da base. Serializável (cruza Server → Client). Sem
// odd, odd justa, stake nem cor de edge; o `%` mora aqui, FORA do HERO (ADR 0030).

// current: o texto vale pra base atual. refresh: a base mudou de forma material e o
// azarão ainda vale ("Atualizar"). changed: a base atual não passa mais na porta (o
// texto pago fica, sem botão).
export type UnderdogFreshness = "current" | "refresh" | "changed";

export type UnderdogPanelView = {
  underdogName: string;
  favoriteName: string;
  chances: { underdog: string; draw: string; favorite: string };
  oneInN: number | null;
  scorelines: { label: string; pct: string }[];
  scenarios: { label: string; before: string; after: string }[];
  signals: { label: string; origin: "dados" | "modelo"; note: string | null }[];
  narrative: {
    sentences: string[];
    counterpoint: string;
    family: string | null;
    cut: number;
    source: UnderdogNarrativeSource;
  };
  freshness: UnderdogFreshness;
};

export type UnderdogTeaserView = { underdogName: string; pct: string };

export type UnderdogSlotView = {
  teaser: UnderdogTeaserView;
  // O texto guardado; null = abrir chama a action (e cobra).
  view: UnderdogPanelView | null;
};

// O que a página lê do banco (lib/underdog/load.ts). null = flag desligada.
export type UnderdogTeaserData = {
  current: UnderdogPick | null;
  stored: UnderdogViewRecord | null;
};

const int = (n: number) => formatPct(n, { decimals: 0 });

export const REVIEWER_LABEL = "Haiku";
export const UNDERDOG_TEMPLATE_NOTE =
  "Texto padrão: o rascunho da IA não passou na conferência.";
export const UNDERDOG_STALE_REFRESH =
  "O modelo foi recalculado desde este texto.";
export const UNDERDOG_STALE_CHANGED = "O modelo mudou desde este texto.";
export const UNDERDOG_JEV_NOTE = "já está na chance acima";

export function toUnderdogPanelView(
  stored: {
    facts: UnderdogFacts;
    narrative: UnderdogNarrative;
    narrativeSource: UnderdogNarrativeSource;
  },
  teams: { home: string; away: string },
  freshness: UnderdogFreshness
): UnderdogPanelView {
  const { facts, narrative } = stored;
  const n = underdogNames(facts, teams);
  return {
    underdogName: n.underdog,
    favoriteName: n.favorite,
    chances: {
      underdog: int(facts.chances.underdog),
      draw: int(facts.chances.draw),
      favorite: int(facts.chances.favorite),
    },
    oneInN: oneInN(facts.chances.underdog),
    scorelines: facts.scorelines.map((s) => ({
      label: `${s.home} × ${s.away}`,
      pct: int(s.pct),
    })),
    scenarios: facts.scenarios.map((c) => ({
      label: scenarioLabel(c.id, n),
      before: int(c.beforePct),
      after: int(c.afterPct),
    })),
    signals: facts.signals.map((s) => ({
      label: signalLabel(s, n),
      origin: signalOrigin(s),
      note: s.kind === "jev" ? UNDERDOG_JEV_NOTE : null,
    })),
    narrative: {
      sentences: narrative.sentences.map((s) => s.text),
      counterpoint: narrative.counterpoint,
      family: narrative.advocateFamily,
      cut: narrative.cut,
      source: stored.narrativeSource,
    },
    freshness,
  };
}

function teaserFor(
  pick: Pick<UnderdogPick, "side" | "chances">,
  teams: { home: string; away: string }
): UnderdogTeaserView {
  return {
    underdogName: underdogNames(pick, teams).underdog,
    pct: int(pick.chances.underdog),
  };
}

/**
 * O slot do azarão na página. null = nada aparece: flag desligada, fora do pré-jogo, ou
 * sem texto guardado e com a porta do teaser fechada. Texto pago aparece até o apito
 * (ADR 0072 §9), mesmo quando a base atual não passa mais na porta.
 */
export function toUnderdogSlot(args: {
  data: UnderdogTeaserData | null;
  preMatch: boolean;
  heroPalpite: { probableScore: { home: number; away: number } } | null;
  runInFlight: boolean;
  teams: { home: string; away: string };
}): UnderdogSlotView | null {
  const { data, preMatch, teams } = args;
  if (data === null || !preMatch) return null;
  const visible = underdogTeaserVisible({
    flag: true,
    preMatch,
    heroPalpite: args.heroPalpite,
    runInFlight: args.runInFlight,
    pick: data.current,
  });
  const { stored, current } = data;
  if (stored) {
    const freshness: UnderdogFreshness = isMaterialSame(stored.facts, current)
      ? "current"
      : visible
        ? "refresh"
        : "changed";
    return {
      teaser:
        freshness === "refresh" && current
          ? teaserFor(current, teams)
          : teaserFor(stored.facts, teams),
      view: toUnderdogPanelView(stored, teams, freshness),
    };
  }
  if (!visible || current === null) return null;
  return { teaser: teaserFor(current, teams), view: null };
}
