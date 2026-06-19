import type { PalpiteResultData } from "@/db/schema";
import type { NormalizedFixtureEvents } from "@/lib/providers/sports-data/types";

// Módulo LEAF dedicado (#354) — NÃO em schemas.ts. `schemas.ts` é o caminho de VALOR
// (ResultData rico) e fica zod-only pra preservar o grafo acíclico schemas → money →
// registry. O caminho de PALPITE usa a forma ESTREITA `PalpiteResultData`; este módulo
// a constrói com o split do 1º tempo (first_half_score) + quem marcou primeiro
// (first_to_score, derivado dos eventos de regulação). Importa o tipo
// `NormalizedFixtureEvents` do provider — fronteira de tipos-de-provider permitida
// FORA de schemas.ts (o caminho de valor já faz isso no orquestrador settle.ts).

// Deriva o "primeiro a marcar" dos eventos. RETORNA undefined em qualquer ambiguidade
// (prefer-skip → a regra lança → PENDING, NUNCA fabrica o lado errado):
//  - eventsAvailable !== true                                → undefined
//  - feed incompleto (totalGoals>0 mas 0 gols de regulação)  → undefined (mirror settle.ts)
//  - 0 gols de regulação (0-0 legítimo)                      → "none"
//  - PRIMEIRO gol relevante é own goal                       → undefined (wire de OG
//      não verificado ao vivo, ADR 0025 — não dá pra confiar em ev.team de OG; flipar
//      arriscaria silent-wrong-settle. Own goals MAIS TARDE não afetam.)
//  - minute null no PRIMEIRO gol relevante                   → undefined (não ordenável)
//  - empate de minuto entre lados OPOSTOS no topo            → undefined (ambíguo)
function deriveFirstToScore(
  events: NormalizedFixtureEvents,
  totalGoals: number,
): "home" | "away" | "none" | undefined {
  if (events.eventsAvailable !== true) return undefined;

  const regulationGoals = events.goals.filter((g) => g.isRegulation);

  // Guarda de feed incompleto (mirror settle.ts:62-65): o placar tem gols mas a lista
  // de regulação veio vazia → feed incompleto → não derivar (PENDING), nunca "none".
  if (totalGoals > 0 && regulationGoals.length === 0) return undefined;

  // 0 gols de regulação (e placar 0-0 consistente) → ninguém marcou.
  if (regulationGoals.length === 0) return "none";

  // Ordena por minuto ascendente. Um minuto null é não-ordenável → empurrado pro fim;
  // se ele acabar no topo (todos null) o guard abaixo pega.
  const sorted = [...regulationGoals].sort((a, b) => {
    if (a.minute === null) return 1;
    if (b.minute === null) return -1;
    return a.minute - b.minute;
  });

  const first = sorted[0];

  // Minuto null no primeiro gol relevante → ambíguo, não ordenável → PENDING.
  if (first.minute === null) return undefined;

  // Empate de minuto entre lados OPOSTOS no topo → ambíguo (não dá pra saber a ordem).
  // Mesmo minuto + mesmo lado → sem ambiguidade (o lado é determinado).
  const tiedOpposite = sorted.some(
    (g) =>
      g !== first &&
      g.minute === first.minute &&
      g.teamSide !== first.teamSide,
  );
  if (tiedOpposite) return undefined;

  // PRIMEIRO gol relevante é own goal → AMBÍGUO (semântica de ev.team em OG não
  // verificada ao vivo, ADR 0025) → PENDING. Relaxar só após inspecionar um payload
  // real de OG.
  if (first.isOwnGoal) return undefined;

  return first.teamSide;
}

/**
 * Constrói o `PalpiteResultData` ESTREITO a partir do regulationScore ao vivo (90'),
 * mais (opcionalmente) o split do 1º tempo e os eventos de gol. Independente do
 * `ResultDataSchema` de valor. Campos novos undefined quando o dado falta → a regra
 * correspondente deixa PENDING (prefer-skip).
 */
export function palpiteResultDataFrom(
  regulationScore: { home: number; away: number },
  opts: {
    halftimeScore?: { home: number; away: number } | null;
    events?: NormalizedFixtureEvents;
  } = {},
): PalpiteResultData {
  const totalGoals = regulationScore.home + regulationScore.away;
  const base: PalpiteResultData = {
    homeScore: regulationScore.home,
    awayScore: regulationScore.away,
    totalGoals,
  };

  // Halftime: presente só quando o provider entregou o split (ambos os lados). Ausente/
  // null → campos ficam undefined → first_half_score PENDING.
  if (opts.halftimeScore) {
    base.halftimeHomeScore = opts.halftimeScore.home;
    base.halftimeAwayScore = opts.halftimeScore.away;
  }

  // Eventos: presentes só quando o fetch teve sucesso. Sem eventos → eventsAvailable
  // fica undefined → first_to_score PENDING.
  if (opts.events) {
    base.eventsAvailable = opts.events.eventsAvailable === true;
    const firstToScore = deriveFirstToScore(opts.events, totalGoals);
    if (firstToScore !== undefined) base.firstToScore = firstToScore;
  }

  return base;
}
