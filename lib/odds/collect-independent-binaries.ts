import type { MarketDescriptor } from "@/lib/odds/market-descriptor";
import type { NormalizedOddsEvent } from "@/lib/providers/odds/types";

// Um jogador cotado num mercado independent_binary (#290): a chave de seleção
// (scorer_<slug>/assist_<slug>), o NOME exibível (persistido em
// market_selections.label, NOT NULL — sem ele a view renderiza a key crua ou
// crasha) e a odd `yes`.
export type IndependentBinaryPlayer = {
  key: string;
  label: string;
  odd: number;
};

// Conjunto de jogadores cotados por UM bookmaker num mercado independent_binary.
// NÃO há overround (Σ 1/odd_yes é contagem esperada de artilheiros, não margem de
// partição — ver ADR 0025 emenda). `lastUpdate` é só input do LLM (não o
// captured_at persistido), espelhando MarketOddsBundle.lastUpdate.
export type IndependentBinaryBundle = {
  bookmakerKey: string;
  bookmakerTitle: string;
  lastUpdate: string;
  players: IndependentBinaryPlayer[];
};

/**
 * Sibling N-ilimitado de `pickBestBookmaker` pra mercados independent_binary
 * (#290, ADR 0025 emenda): cada jogador é um binário independente cotado SÓ no
 * lado `yes`. Diferente de `pickBestBookmaker`:
 *
 *   - SEM complete-market gate: o conjunto de jogadores é ilimitado e desconhecido,
 *     não há "todas as selectionKeys presentes" a exigir;
 *   - SEM overround / `computeMarketImpliedProbabilities`: Σ 1/odd_yes não é uma
 *     margem de partição (é contagem esperada de artilheiros) — normalizar é
 *     matematicamente INAPLICÁVEL aqui, não "pulado". NUNCA toca implied-probability.
 *   - escolhe o ÚNICO book com MAIS jogadores cotados (proxy de cobertura), em vez
 *     de menor overround;
 *   - dropa odd ≤ 1 ou não-finita POR JOGADOR (não o book inteiro): uma odd inútil
 *     num jogador não invalida os demais (yes-only, sem interdependência).
 *
 * Mapeia cada outcome → selectionKey via `descriptor.resolveSelectionKey` (keying
 * por nome canônico — sem id confiável no fio). O NOME cru do outcome vira o
 * `label` (persistido em market_selections.label). Primeira ocorrência de uma key
 * vence (nomes que colidem no slug). Retorna undefined se nenhum book cotou ≥1
 * jogador válido (prefer-skip).
 */
export function collectIndependentBinaries(args: {
  event: NormalizedOddsEvent;
  descriptor: MarketDescriptor;
}): IndependentBinaryBundle | undefined {
  const { event, descriptor } = args;
  let best: IndependentBinaryBundle | undefined;

  for (const bookmaker of event.bookmakers) {
    const market = bookmaker.markets.find(
      (m) => m.key === descriptor.providerMarketKey,
    );
    if (!market) continue;

    const seen = new Set<string>();
    const players: IndependentBinaryPlayer[] = [];
    for (const outcome of market.outcomes) {
      const key = descriptor.resolveSelectionKey(outcome, {
        homeTeam: event.homeTeam,
        awayTeam: event.awayTeam,
      });
      if (key === null) continue;
      if (seen.has(key)) continue; // primeira ocorrência vence
      // odd ≤1 / não-finita é inútil como aposta — dropa SÓ esse jogador.
      if (!Number.isFinite(outcome.price) || outcome.price <= 1) continue;
      seen.add(key);
      players.push({ key, label: outcome.name.trim(), odd: outcome.price });
    }

    if (players.length === 0) continue;
    // Escolhe o book com MAIS jogadores cotados (proxy de cobertura). Empate →
    // mantém o primeiro visto (determinístico pela ordem do payload).
    if (!best || players.length > best.players.length) {
      best = {
        bookmakerKey: bookmaker.key,
        bookmakerTitle: bookmaker.title,
        lastUpdate: market.lastUpdate,
        players,
      };
    }
  }

  return best;
}

// Implícita por jogador num mercado independent_binary (#290): o TETO
// margin-inclusivo `(1/odd_yes)*100`, NUNCA uma prob de-vigada. Como a margem faz
// `1/odd_yes` EXCEDER o P(yes) verdadeiro, este é um teto e o edge
// `modelProb − impliedCeiling` é um PISO (conservador na direção da margem — só dá
// pra subestimar edge, nunca superestimar). NÃO usa
// computeMarketImpliedProbabilities (normalização inaplicável); NÃO sintetiza a odd
// `no` (proibido). Precedente: scenario.ts já usa 100/odd cru como break-even
// (ADR 0012 D6). impliedSumTarget é N/A aqui.
export function deriveIndependentImplied(
  players: { key: string; odd: number }[],
): Record<string, number> {
  const impliedByKey: Record<string, number> = {};
  for (const p of players) {
    impliedByKey[p.key] = (1 / p.odd) * 100;
  }
  return impliedByKey;
}
