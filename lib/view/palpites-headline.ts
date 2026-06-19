import type { PalpiteHeadline } from "@/db/schema";
import type { PalpiteSetWithLines } from "@/lib/db/queries/palpites";

// View da MANCHETE palpite-first (ADR 0030 / #353). Consumida pelo HERO (#351). ZERO
// número de valor — firewall leg (c): mesmo que a manchete derive de análises que
// carregam edge/EV/odd, NENHUM número de valor cruza pra cá. Espelha o descarte de
// `lib/view/palpites.ts:79` (que joga fora o aiCall integralmente).
export type PalpiteHeadlineView = {
  verdict: string;
  probableScore: { home: number; away: number };
  confidence: "baixa" | "media" | "alta";
  narrative: string;
  citedMarkets: string[];
  // Settlement do placar provável (a linha exact_score). null = pendente OU sem placar.
  // SEM número de valor — só o badge acertou/errou.
  badge: "won" | "lost" | null;
};

// Insumos do mapper — tipos puros (sem importar @/lib/db pra não arrastar Drizzle pra
// camada de view). `headline` é o jsonb persistido; `probableScore` vem da linha
// exact_score (params); `outcome` é o resultado da liquidação (null = pendente).
export type PalpiteHeadlineSource = {
  headline: PalpiteHeadline;
  probableScore: { home: number; away: number };
  outcome: { result: "won" | "lost" } | null;
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
  };
}

/**
 * Mapeia um `PalpiteSetWithLines` PERSISTIDO (do `getPalpiteSetsForMatch`) pra
 * `PalpiteHeadlineView`. Espelha VERBATIM a lógica inline do generate fresco em
 * `app/actions/predictions.ts` (a síntese), mas lê do set persistido em vez do
 * resultado em memória: pega a manchete (jsonb) + a linha `exact_score` (placar
 * provável em `params` + o `outcome` settled → badge).
 *
 * Retorna `null` quando a manchete é null (sets antigos pré-#353 do gerador MIX) OU
 * a linha `exact_score` não existe / não tem `params` — o HERO trata o null como
 * "sem palpite ainda" (estado empty/CTA), nunca renderiza um palpite parcial.
 */
export function toPalpiteHeadlineViewFromSet(
  set: PalpiteSetWithLines,
): PalpiteHeadlineView | null {
  const headline = set.palpiteSet.headline;
  const scoreLine = set.palpites.find((p) => p.type === "exact_score");
  if (!headline || !scoreLine?.params) return null;
  return toPalpiteHeadlineView({
    headline,
    probableScore: scoreLine.params,
    outcome: scoreLine.outcome,
  });
}
