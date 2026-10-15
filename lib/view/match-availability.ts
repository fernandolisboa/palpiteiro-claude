// O que um jogo aceita agora — fonte única do gate (#385) pra página do jogo (HERO,
// aviso, odds), a lista (/jogos) e as actions (capabilityGateMessage). O gate de
// pré-jogo e a fase do jogo ao vivo moram em `lib/live/phase.ts` (puros) e são
// reexportados daqui. `lib/ai/predict.ts` repete o gate de pré-jogo como defesa em
// profundidade e precisa continuar batendo com este. A copy sai POR estado: um jogo ao
// vivo ou adiado não pode dizer "encerrado".

import type { MatchPhase, MatchUnavailableReason } from "@/lib/live/phase";

export {
  matchPhase,
  matchUnavailableReason,
  type MatchPhase,
  type MatchPhaseKind,
  type MatchUnavailableReason,
} from "@/lib/live/phase";

/**
 * O que a página do jogo libera agora, por capacidade (#576; ao vivo, #580/ADR 0060):
 * - `analyze`: "Analisar com IA" e "Gerar só o palpite";
 * - `seuPalpite`: o bloco "Seu palpite";
 * - `registerBets`: a grade e o painel Suas apostas (com o §3, ADR 0057);
 * - `pool`: o atalho "criar bolão";
 * - `analyzeMarkets`: a reanálise de um mercado e os mercados escolhidos (um
 *   `predict()` pago por mercado, contra odds): só pré-jogo, nunca ao vivo.
 */
export type MatchCapabilities = {
  analyze: boolean;
  seuPalpite: boolean;
  registerBets: boolean;
  pool: boolean;
  analyzeMarkets: boolean;
};

export type MatchCapability = keyof MatchCapabilities;

export type MatchCapabilityOptions = {
  /** `ai_config.enable_live_mode`. Default false: só pré-jogo, como antes do #580. */
  liveMode?: boolean;
  /** Há modelo em jogo para o jogo (base do apito ou cálculo na hora). */
  modelReady?: boolean;
  /** Janela das apostas do bolão aberta (`poolWindowOpen`, regra do bolão ao vivo). */
  poolWindowOpen?: boolean;
};

const PRE_MATCH: MatchCapabilities = {
  analyze: true,
  seuPalpite: true,
  registerBets: true,
  pool: true,
  analyzeMarkets: true,
};

/**
 * Regras por capacidade (ADR 0060 §1). Pré-jogo libera tudo. Ao vivo, só
 * `in_play`/`half_time` com estado de no máximo 2 min e minuto conhecido
 * (`phase.actionable`): a análise e o "Seu palpite" pedem modelo; o registro não (sai
 * sem avaliação); a reanálise por mercado nunca. O bolão segue a própria janela. Com
 * `liveMode` desligado ou sem estado, tudo fecha no apito, como antes.
 */
export function matchCapabilities(
  phase: MatchPhase,
  {
    liveMode = false,
    modelReady = false,
    poolWindowOpen = false,
  }: MatchCapabilityOptions = {}
): MatchCapabilities {
  if (phase.kind === "pre") return { ...PRE_MATCH };
  const live =
    liveMode &&
    phase.actionable &&
    (phase.kind === "in_play" || phase.kind === "half_time");
  // O bolão não depende do estado bom (sem minuto, fecha pelo relógio), mas nunca abre
  // num jogo encerrado, adiado, cancelado ou interrompido.
  const poolBlocked =
    phase.kind === "finished" ||
    phase.kind === "postponed" ||
    phase.kind === "cancelled" ||
    phase.kind === "interrupted";
  return {
    analyze: live && modelReady,
    seuPalpite: live && modelReady,
    registerBets: live,
    pool: liveMode && poolWindowOpen && !poolBlocked,
    analyzeMarkets: false,
  };
}

// Linha do HERO sem palpite quando não dá mais pra analisar.
export const EMPTY_HERO_UNAVAILABLE_COPY: Record<
  MatchUnavailableReason,
  string
> = {
  started: "Jogo já começou, sem palpite por aqui.",
  live: "Jogo em andamento, sem palpite por aqui.",
  postponed: "Jogo adiado, sem palpite por enquanto.",
  cancelled: "Jogo cancelado, sem palpite por aqui.",
  finished: "Jogo encerrado, sem palpite por aqui.",
  extra_time: "Jogo na prorrogação ou nos pênaltis, sem palpite por aqui.",
  interrupted: "Jogo interrompido, sem palpite por enquanto.",
  live_unavailable:
    "Placar ao vivo indisponível agora, sem palpite por enquanto.",
};

// Aviso (label + detalhe) abaixo do HERO quando o jogo não é analisável e não tem
// análise salva. Placar final só entra no encerrado.
export function unavailableNoticeCopy(
  reason: MatchUnavailableReason,
  score: { home: number; away: number } | null
): { label: string; detail: string } {
  switch (reason) {
    case "started":
      return {
        label: "jogo já começou",
        detail: "A análise fica disponível só antes do apito inicial.",
      };
    case "live":
      return {
        label: "jogo em andamento",
        detail: "A análise fica disponível só antes do apito inicial.",
      };
    case "postponed":
      return {
        label: "jogo adiado",
        detail: "Análise indisponível até o jogo ser remarcado.",
      };
    case "cancelled":
      return {
        label: "jogo cancelado",
        detail: "Análise indisponível para jogos cancelados.",
      };
    case "finished":
      return {
        label: "jogo encerrado",
        detail: score
          ? `Placar final ${score.home}–${score.away}. Análise indisponível para jogos já encerrados.`
          : "Análise indisponível para jogos já encerrados.",
      };
    case "extra_time":
      return {
        label: "prorrogação",
        detail:
          "Os mercados valem pelos 90 minutos e já estão decididos. Análise indisponível.",
      };
    case "interrupted":
      return {
        label: "jogo interrompido",
        detail: "A análise volta quando o jogo recomeçar.",
      };
    case "live_unavailable":
      return {
        label: "placar ao vivo indisponível",
        detail: "Placar ao vivo indisponível agora. Tente em um minuto.",
      };
  }
}
