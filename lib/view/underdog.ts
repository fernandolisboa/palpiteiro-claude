import { formatPct } from "@/lib/format-number";
import type { UnderdogViewRecord } from "@/lib/db/queries/underdog-views";
import { underdogNames } from "@/lib/underdog/facts";
import type { UnderdogBaseRead } from "@/lib/underdog/compute";
import {
  isMaterialSame,
  underdogTeaserBlock,
  type UnderdogPick,
} from "@/lib/underdog/gate";
import { isUnsafeNewsTitle, safeGeArticleUrl } from "@/lib/match-news/labels";
import {
  oneInN,
  scenarioLabel,
  signalLabel,
  signalOrigin,
  type SignalOrigin,
} from "@/lib/underdog/labels";
import type {
  UnderdogFacts,
  UnderdogNarrative,
  UnderdogNarrativeSource,
} from "@/lib/underdog/types";

// O painel "Chances do azarão" pronto pra tela (#671, ADR 0073): nomes de exibição,
// percentuais formatados e o estado da base. Serializável (cruza Server → Client). Sem
// odd, odd justa, stake nem cor de edge; o `%` mora aqui, FORA do HERO (ADR 0030).

// current: o texto vale pra base atual, ou a base atual não pode ser lida agora (mais de
// 24h, refit atrasado: nada mudou que se saiba, sem aviso). refresh: a base mudou de
// forma material e o azarão ainda vale ("Atualizar"). recalculated: mudou de forma
// material, mas o botão está suspenso por um motivo passageiro (run em andamento, sem
// palpite na tela): o aviso sem o botão. changed: mudança material e a base atual não
// passa mais na porta (sem azarão claro, ou o palpite agora dá a vitória ao azarão): o
// texto pago fica, sem botão.
export type UnderdogFreshness =
  | "current"
  | "refresh"
  | "recalculated"
  | "changed";

export type UnderdogPanelView = {
  underdogName: string;
  favoriteName: string;
  chances: { underdog: string; draw: string; favorite: string };
  oneInN: number | null;
  scorelines: { label: string; pct: string }[];
  scenarios: { label: string; before: string; after: string }[];
  signals: {
    label: string;
    origin: SignalOrigin;
    note: string | null;
    // A matéria do ge do sinal de notícia (#672): título como texto do link. Ausente sem
    // título seguro (nome de casa de aposta, linguagem de valor) ou sem URL https.
    link?: { url: string; title: string };
  }[];
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
  // Por que `current` é null (ou "ok").
  baseStatus: UnderdogBaseRead["status"];
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
    signals: facts.signals.map((s) => {
      // Link só pra matéria do ge (https, *.globo.com) com título seguro; sem isso, a
      // frase do código fica sem link.
      const url = s.kind === "news" && s.url ? safeGeArticleUrl(s.url) : null;
      return {
        label: signalLabel(s, n),
        origin: signalOrigin(s),
        note: s.kind === "jev" || s.kind === "news" ? UNDERDOG_JEV_NOTE : null,
        ...(s.kind === "news" && url && s.title && !isUnsafeNewsTitle(s.title)
          ? { link: { url, title: s.title } }
          : {}),
      };
    }),
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
 * (ADR 0073 §9), mesmo quando a base atual não passa mais na porta.
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
  const { stored, current, baseStatus } = data;
  const block = underdogTeaserBlock({
    flag: true,
    preMatch,
    heroPalpite: args.heroPalpite,
    runInFlight: args.runInFlight,
    pick: current,
  });
  if (stored) {
    const freshness = storedFreshness({
      materialSame: isMaterialSame(stored.facts, current),
      baseStatus,
      block,
    });
    const showCurrent =
      (freshness === "refresh" || freshness === "recalculated") && current;
    return {
      teaser: showCurrent
        ? teaserFor(current, teams)
        : teaserFor(stored.facts, teams),
      view: toUnderdogPanelView(stored, teams, freshness),
    };
  }
  if (block !== null || current === null) return null;
  return { teaser: teaserFor(current, teams), view: null };
}

/** O estado do texto guardado diante da base atual (ver UnderdogFreshness). */
function storedFreshness(args: {
  materialSame: boolean;
  baseStatus: UnderdogBaseRead["status"];
  block: ReturnType<typeof underdogTeaserBlock>;
}): UnderdogFreshness {
  const { materialSame, baseStatus, block } = args;
  if (materialSame) return "current";
  // Base que não dá pra ler agora não é mudança: nada se sabe.
  if (baseStatus === "unavailable") return "current";
  // A base vale e não tem mais azarão claro: mudança material de verdade.
  if (baseStatus === "no_underdog") return "changed";
  if (block === null) return "refresh";
  if (block === "run" || block === "no_palpite") return "recalculated";
  return "changed";
}
