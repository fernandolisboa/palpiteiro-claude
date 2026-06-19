import type { PalpiteHeadline } from "@/db/schema";
import { ExactScoreParamsSchema } from "@/lib/ai/palpites/cartridges/cartridge";
import type { PalpiteSetWithLines } from "@/lib/db/queries/palpites";

// View da MANCHETE palpite-first (ADR 0030 / #353). Consumida pelo HERO (#351). ZERO
// número de valor — firewall leg (c): mesmo que a manchete derive de análises que
// carregam edge/EV/odd, NENHUM número de valor cruza pra cá. Espelha o descarte de
// `lib/view/palpites.ts:79` (que joga fora o aiCall integralmente).

// #354: uma DIMENSÃO settleable secundária (margin/clean_sheet/first_half_score/
// first_to_score) — um rótulo (placar/proposição, NUNCA número de valor) + o badge
// acertou/errou/pendente. exact_score NÃO entra aqui (é a manchete/placar central).
export type PalpiteDimensionView = {
  label: string;
  badge: "won" | "lost" | null; // null = pendente / sem dado
};

export type PalpiteHeadlineView = {
  verdict: string;
  probableScore: { home: number; away: number };
  confidence: "baixa" | "media" | "alta";
  narrative: string;
  citedMarkets: string[];
  // Settlement do placar provável (a linha exact_score). null = pendente OU sem placar.
  // SEM número de valor — só o badge acertou/errou.
  badge: "won" | "lost" | null;
  // #354: as dimensões settleable secundárias (a "ficha"). OBRIGATÓRIO (não opcional) —
  // força AMBOS os call-sites (fresh + reload) a popular, sem glitch sumir/aparecer.
  // Pode ser `[]` (o scorecard se esconde inteiro).
  dimensions: PalpiteDimensionView[];
};

// Insumos do mapper — tipos puros (sem importar @/lib/db pra não arrastar Drizzle pra
// camada de view). `headline` é o jsonb persistido; `probableScore` vem da linha
// exact_score (params); `outcome` é o resultado da liquidação (null = pendente).
// `dimensions` são as outras rows settleable já mapeadas (default []).
export type PalpiteHeadlineSource = {
  headline: PalpiteHeadline;
  probableScore: { home: number; away: number };
  outcome: { result: "won" | "lost" } | null;
  dimensions?: PalpiteDimensionView[];
};

/**
 * Mapeia a manchete persistida (headline jsonb + placar provável + outcome) pra
 * `PalpiteHeadlineView`. SÓ os campos da manchete cruzam — `sourcePredictionIds`
 * (proveniência interna) e qualquer número de valor ficam de fora. O badge vem do
 * settlement do exact_score (won/lost) ou null (pendente).
 */
export function toPalpiteHeadlineView(
  source: PalpiteHeadlineSource,
): PalpiteHeadlineView {
  return {
    verdict: source.headline.verdict,
    probableScore: {
      home: source.probableScore.home,
      away: source.probableScore.away,
    },
    confidence: source.headline.confidence,
    narrative: source.headline.narrative,
    citedMarkets: source.headline.citedMarkets,
    badge: source.outcome?.result ?? null,
    dimensions: source.dimensions ?? [],
  };
}

// #354: mapeia as rows settleable de um set (EXCETO exact_score, que é a manchete) pras
// dimensões da ficha. label = o `text` da row (template FIXO, firewall-safe — NUNCA
// número de valor); badge = o outcome (won/lost) ou null (pendente). MESMO helper usado
// pelos dois call-sites (fresh + reload) → fresh == reload, sem glitch.
export function toDimensionViews(
  lines: PalpiteSetWithLines["palpites"],
): PalpiteDimensionView[] {
  return lines
    .filter((p) => p.type !== "exact_score" && p.settleable)
    .map((p) => ({ label: p.text, badge: p.outcome?.result ?? null }));
}

/**
 * Mapeia um `PalpiteSetWithLines` PERSISTIDO (do `getPalpiteSetsForMatch`) pra
 * `PalpiteHeadlineView`. Espelha VERBATIM a lógica inline do generate fresco em
 * `app/actions/predictions.ts` (a síntese), mas lê do set persistido em vez do
 * resultado em memória: pega a manchete (jsonb) + a linha `exact_score` (placar
 * provável em `params` + o `outcome` settled → badge) + as outras dimensões settleable.
 *
 * Retorna `null` quando a manchete é null (sets antigos pré-#353 do gerador MIX) OU
 * a linha `exact_score` não existe / não tem `params` válidos — o HERO trata o null
 * como "sem palpite ainda" (estado empty/CTA), nunca renderiza um palpite parcial.
 *
 * NARROW-not-cast (#354 / blocker §3.2): `params` é a union LARGA do jsonb e NÃO é
 * atribuível direto a `{home,away}`. Estreitamos via `ExactScoreParamsSchema.safeParse`
 * — params que não casam → manchete null (prefer-skip).
 */
export function toPalpiteHeadlineViewFromSet(
  set: PalpiteSetWithLines,
): PalpiteHeadlineView | null {
  const headline = set.palpiteSet.headline;
  const scoreLine = set.palpites.find((p) => p.type === "exact_score");
  if (!headline || !scoreLine?.params) return null;
  const ps = ExactScoreParamsSchema.safeParse(scoreLine.params);
  if (!ps.success) return null; // prefer-skip: params ruins → manchete null (HERO empty)
  return toPalpiteHeadlineView({
    headline,
    probableScore: ps.data,
    outcome: scoreLine.outcome,
    dimensions: toDimensionViews(set.palpites),
  });
}
