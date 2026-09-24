import { cache } from "react";
import { z } from "zod";

import { getSharedPalpiteSet } from "@/lib/db/queries/palpites";
import {
  toPalpiteHeadlineViewFromSet,
  type PalpiteHeadlineView,
} from "@/lib/view/palpites-headline";
import { unsafeForPublic } from "@/lib/view/share/public-text-guard";

// Projeção PÚBLICA NARROW do jogo (ADR 0035 §6 / #384, major #4 + final-score BLOCKER). O
// raw DbMatch carrega placar de jogos `live`/`postponed` também — só `finished` deve mostrar
// placar (espelha lib/view/match.ts:73-74). Projetamos no LOADER (type boundary): o raw
// DbMatch NUNCA cruza pro cliente/imagem, então "só PalpiteHeadlineView + MatchPublicView
// cruzam" é garantia de tipo, não disciplina de call-site.
export type MatchPublicView = {
  homeTeam: string;
  awayTeam: string;
  league: string;
  // Placar REAL só em jogo encerrado (fato do mundo, firewall-safe). null caso contrário.
  finalScore: { home: number; away: number } | null;
};

export type SharedPalpite = {
  view: PalpiteHeadlineView;
  match: MatchPublicView;
};

// Mensagem NEUTRA de OG/description — firewall-safe (sem linguagem de valor). Usada em
// generateMetadata em AMBOS os branches (data E no-data) pra a description "Recomendações
// de aposta" da root layout NUNCA cascatear pro og:description (privacy MAJOR 3).
export const NEUTRAL_DESCRIPTION =
  "Um palpite no Palpiteiro — análise, não recomendação." as const;

const idSchema = z.string().uuid();

/**
 * Carrega o palpite compartilhado por id, com os 4 triggers de 404 (ADR 0035 §6 + §2e):
 *   (i)   id não-UUID → null ANTES de qualquer query (evita 22P02);
 *   (ii)  query retorna null (set inexistente OU shared_at NULL) → null;
 *   (iii) mapper retorna null (sem manchete / params exact_score inválidos) → null;
 *   (iv)  VEREDITO inseguro pro público (unsafeForPublic: valor/%/decimal) → null (404,
 *         prefer-skip do ADR 0035 §2e — a manchete sem veredito não tem o que compartilhar).
 * GUARD DE TEXTO PÚBLICO (ADR 0035 §2d / #438): aplicado AQUI, uma vez, então página,
 * metadata e imagem OG herdam o mesmo corte. Narrativa insegura → "" (a página esconde o
 * parágrafo). `dimensions` (template fixo), `citedMarkets` (normalizado em categoria) e
 * `sources` (endurecidas em hardenSources) já são firewall-safe no próprio render.
 * Projeta o match pra MatchPublicView (gate de placar por status) antes de retornar.
 *
 * `cache()`-wrapped: a page e a rota opengraph-image chamam o MESMO loader no mesmo render
 * pass — a query roda uma vez. O mesmo loader (mapper-inclusive) roda nos dois, então a
 * imagem 404-fallback nos MESMOS 4 triggers que a página (não só "sem row").
 */
export const loadSharedPalpite = cache(
  async (id: string): Promise<SharedPalpite | null> => {
    // (i) uuid ANTES da query.
    const parsed = idSchema.safeParse(id);
    if (!parsed.success) return null;

    // (ii) query gateada por shared_at.
    const row = await getSharedPalpiteSet(parsed.data);
    if (!row) return null;

    // (iii) mapper (drop de proveniência + narrow exact_score).
    const mapped = toPalpiteHeadlineViewFromSet(row.palpiteSetWithLines);
    if (!mapped) return null;

    // (iv) guard de texto público: veredito inseguro → 404; narrativa insegura → "".
    if (unsafeForPublic(mapped.verdict)) return null;
    const view: PalpiteHeadlineView = unsafeForPublic(mapped.narrative)
      ? { ...mapped, narrative: "" }
      : mapped;

    // Projeção do match: gate de placar por status (mirror match.ts:73-74).
    const m = row.match;
    const finalScore =
      m.status === "finished" && m.homeScore !== null && m.awayScore !== null
        ? { home: m.homeScore, away: m.awayScore }
        : null;

    return {
      view,
      match: {
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        league: m.league,
        finalScore,
      },
    };
  },
);
