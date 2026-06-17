import { z } from "zod";

// Tipos canônicos do settlement. Vivem AQUI (não em compute.ts) pra manter o
// grafo de imports acíclico: schemas → money → registry → compute. compute.ts
// re-exporta `OutcomeResult`/`SettlementOutcome` pra manter o path
// `@/lib/settlement/compute` byte-estável pros consumidores legados.

// O enum PERSISTIDO em prediction_outcomes.result (espelha outcomeResultEnum em
// db/schema.ts). `push` entrou no domínio em #161 (devolve o stake, profit 0);
// nenhum mercado do MVP emite push hoje, mas o tipo precisa carregá-lo.
export type OutcomeResult = "won" | "lost" | "void" | "push";

// O resultado de uma REGRA do registry (ADR 0016). Mais largo que o enum
// persistido: `half_win`/`half_loss` existem pra forward-proof de handicap
// asiático (ADR 0016 D4) e colapsam em won/lost na persistência. `void` NÃO é
// resultado de regra — é o curto-circuito de `pass`, resolvido antes do registry.
export type SettlementOutcome =
  | "won"
  | "lost"
  | "push"
  | "half_win"
  | "half_loss";

// O fato do jogo coletado 1x por jogo (ADR 0016 D2). homeScore/awayScore
// degradam a null em rows do histórico onde o split de 90' não for confiável;
// totalGoals carrega o escalar settled (verbatim). Nenhuma regra do MVP exige o
// split — só totalGoals (I2). Espelha predictionOutcomes.resultData em db/schema.ts.
// Um artilheiro/assistente autoritativo de 90' (#290). `playerId` é o id numérico
// do provider quando o fio o entrega; `canonicalName` é o nome normalizado pro
// match por nome (fallback quando o id falta — fio NÃO verificado ao vivo).
export const ResultScorerSchema = z.object({
  playerId: z.number().int().nullable(),
  canonicalName: z.string(),
});
export type ResultScorer = z.infer<typeof ResultScorerSchema>;

// ADITIVO (#290, sem DDL de coluna): `scorers`/`eventsAvailable` OPCIONAIS. Linhas
// de histórico (partition) parseiam byte-idênticas — z.object por default IGNORA
// chaves desconhecidas e campos ausentes opcionais ficam undefined. SEM `.strict()`
// (quebraria o round-trip). scorers/eventsAvailable só são populados pra mercados
// independent_binary (anytime_scorer/assist); regras partition nunca os leem.
export const ResultDataSchema = z.object({
  homeScore: z.number().int().nullable(),
  awayScore: z.number().int().nullable(),
  totalGoals: z.number().int(),
  // Artilheiros/assistentes de 90' (independent_binary, #290). Quando undefined +
  // eventsAvailable !== true, a regra de scorer deixa PENDING (nunca fabrica loss).
  scorers: z.array(ResultScorerSchema).optional(),
  assisters: z.array(ResultScorerSchema).optional(),
  // true SÓ quando /fixtures/events foi coletado num fixture finalizado.
  eventsAvailable: z.boolean().optional(),
});
export type ResultData = z.infer<typeof ResultDataSchema>;

// Erro de fronteira do settlement (modelado em BuildInputError de
// build-input.ts): carrega `context` opcional pra logar issues do Zod sem perder
// estrutura. settle.ts captura isto e nunca deixa uma row ruim abortar o batch.
export class SettlementError extends Error {
  readonly context?: Record<string, unknown>;
  constructor(message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = "SettlementError";
    this.context = context;
  }
}

/**
 * Constrói o `ResultData` canônico a partir do regulationScore ao vivo (90', sem
 * ET/pênaltis) que o provider entrega no settlement. Distinto do twin
 * `buildResultData` em backfill-mappings.ts: aqui o split de 90' é o FATO
 * canônico (sempre confiável, nunca degradado pra null), enquanto o backfill
 * degrada um split estale contra um escalar já settled. Renomeado pra evitar a
 * colisão de nome (legibilidade/I2).
 */
export function resultDataFromRegulationScore(rs: {
  home: number;
  away: number;
}): ResultData {
  return ResultDataSchema.parse({
    homeScore: rs.home,
    awayScore: rs.away,
    totalGoals: rs.home + rs.away,
  });
}
