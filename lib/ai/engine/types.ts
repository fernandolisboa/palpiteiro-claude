import type { JudgmentMultipliers } from "@/lib/ai/judgments/apply";
import type { LineupChangeBucket } from "@/lib/ai/judgments/lineup-vocabulary";
import type { JudgmentAnswers } from "@/lib/ai/judgments/types";
import type { DixonColesFallbackReason } from "@/lib/quant/match-model";
import type { PredictionUserContext } from "@/lib/user-palpite/types";

export type PredictionLineupSide = {
  changes: LineupChangeBucket | null;
  leftOut: number;
};

export const LINEUP_RECHECK_VERSION = "lineup_v1";

// Marcador da reconferência com a escalação (#619). Sem nomes de jogador.
export type PredictionRecheck = {
  kind: "lineup";
  version: typeof LINEUP_RECHECK_VERSION;
  // predictions.id do pai.
  of: string;
  parentStateHash: string | null;
  // De onde vieram as odds: a captura mais recente do banco (≤ 6 h) ou, sem ela, as
  // odds congeladas do próprio pai. Nunca uma busca nova na The Odds API.
  oddsFrom: "snapshot" | "parent";
  // ISO da captura usada; null quando `oddsFrom` é "parent".
  oddsCapturedAt: string | null;
  // O que o pai dizia, pro "Antes da escalação: … → agora: …" da tela.
  before: {
    recommendation: string;
    line: number | null;
    confidencePct: number;
    edgePct: number | null;
  };
};

// Conteúdo de `predictions.judgments` (jsonb, ADR 0041 §6): tudo que a decisão do
// motor code_jev precisa pra ser recomputada a partir da row.
export type PredictionJudgments = {
  engine: "code_jev";
  // O JEV entrou no λ? false = JEV falhou/sem chave. Só o JEV: a evidência do contexto
  // extra (#565) fica em `userContext` e nunca liga este campo.
  applied: boolean;
  // SEMPRE só as respostas do JEV (chave do reuso, findReusableJudgments): nunca a
  // evidência do usuário, pra outra análise nunca herdar o contexto de alguém.
  answers: JudgmentAnswers | null;
  // `multipliers` e `lambda.adjusted`: o que gerou a decisão (JEV ∨ userContext.evidence).
  multipliers: JudgmentMultipliers | null;
  lambda: {
    source: "dixon_coles" | "heuristic";
    degraded: boolean;
    // Por que o Dixon-Coles não foi usado (ADR 0051). Ausente quando foi, e nas rows
    // anteriores ao DC em produção.
    fallbackReason?: DixonColesFallbackReason;
    // ρ da matriz; null = DIXON_COLES_RHO pinado de scorelineMatrix.
    rho: number | null;
    base: { home: number; away: number };
    adjusted: { home: number; away: number };
  };
  versions: {
    judgments: string;
    weights: string;
    narrator: string;
    // Modelo JEV PEDIDO (o pin, JUDGMENT_MODEL_ID) quando o JEV respondeu; null
    // quando não respondeu. É a chave do reuso (findReusableJudgments): um id
    // canônico/datado ecoado pela API não desliga o reuso.
    jevModel: string | null;
    // Modelo que a API ecoou na resposta (auditoria). Ausente nas rows anteriores.
    jevModelServed?: string | null;
  };
  // Por que o JEV não foi aplicado (null quando aplicado).
  failure: { kind: string; message: string } | null;
  // sha256 do JSON canônico do `state` enviado ao JEV: chave de reuso das
  // respostas entre mercados do mesmo jogo (ADR 0041 §1).
  stateHash: string;
  // Row de ai_calls da chamada JEV que produziu `answers` (null quando o insert de
  // auditoria falhou). Num reuso, é a chamada da predição de origem.
  aiCallId: string | null;
  // Predição de origem cujas respostas foram reusadas (sem chamada JEV nova);
  // null quando o JEV foi chamado nesta análise (no best bet, pelo run: todas as
  // predições do run apontam pra mesma `aiCallId`).
  reusedFromPredictionId: string | null;
  // Base do modelo por jogo de origem (#555, ADR 0052) quando as respostas vieram do
  // JEV do cron (match_model_snapshots), não de uma predição. null/ausente quando o
  // JEV foi chamado nesta análise, quando a origem é uma predição, e nas rows anteriores.
  reusedFromModelSnapshotId?: string | null;
  // Quem escreveu o racional (#512). "llm_call": esta predição fez a chamada
  // narradora (a row de ai_calls é a dela; falha do narrador → texto templado, com
  // o status da falha na row). "best_bet_template": mercado não escolhido no best
  // bet — racional templado em código, sem chamada; `aiCallId` da predição aponta
  // pra narração do mercado escolhido no mesmo run. "lineup_recheck_template":
  // reconferência com a escalação (#619), racional templado em código, sem chamada
  // narradora; `aiCallId` aponta pra chamada JEV (ou pra do pai). Ausente nas rows
  // anteriores.
  narration?: "llm_call" | "best_bet_template" | "lineup_recheck_template";
  // Escalação deste jogo vista pelo JEV (#619), sem nomes: `status` "announced" quando
  // a escalação saiu; por lado, o bucket de mudanças voluntárias (null = não deu pra
  // comparar) e quantos titulares habituais ficaram fora por escolha. Ausente nas rows
  // anteriores ao jev_judgments_v3.
  lineup?: {
    status: "not_announced" | "announced";
    home: PredictionLineupSide | null;
    away: PredictionLineupSide | null;
  };
  // Reconferência com a escalação (#619, PR B): esta row foi recalculada em código pelo
  // cron recheck-lineups a partir da predição `of` (o pai, imutável), com o mesmo λ de
  // base do pai e o JEV refeito com a escalação confirmada. Ponteiro só aqui (ADR 0020,
  // adendo): sem coluna nova. Rows com `recheck` ficam fora do Yield/CLV/Kelly (dedup do
  // "mais recente") e entram na calibração (tag `recheck=lineup_v1`). Ausente nas demais.
  recheck?: PredictionRecheck;
  // Contexto extra da análise (#565): afirmações conferidas, sem texto livre nem nome de
  // jogador, e a evidência que entrou no combine. Ausente nas rows sem contexto e nas
  // anteriores.
  userContext?: PredictionUserContext;
};
