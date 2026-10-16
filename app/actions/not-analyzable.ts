// Gate por capacidade das actions (helper PURO, não-action) — vive FORA de
// predictions.ts ("use server") porque num módulo server TODO export tem que ser uma
// async Server Action (Next falha o build senão). Cada action pergunta pela capacidade
// dela (ADR 0060 §1): análise, Seu palpite, registro de apostas, reanálise por mercado.
// Read grátis, curto-circuita ANTES de qualquer pré-warm/spend.

import type { LiveStateInput, MatchPhase } from "@/lib/live/phase";
import {
  matchCapabilities,
  matchPhase,
  type MatchCapability,
  type MatchCapabilityOptions,
  type MatchUnavailableReason,
} from "@/lib/view/match-availability";

// As copies dos motivos de pré-jogo são as de antes do #580 para toda capacidade: com o
// modo ao vivo desligado ou sem estado, as actions respondem exatamente como antes.
const MESSAGE: Record<MatchUnavailableReason, string> = {
  // `started` (scheduled já apitado) mantém a copy histórica do live nas actions.
  started:
    "Jogo em andamento — a análise fica disponível só antes do apito inicial.",
  live: "Jogo em andamento — a análise fica disponível só antes do apito inicial.",
  postponed: "Jogo adiado — análise indisponível até o jogo ser remarcado.",
  cancelled: "Este jogo já foi encerrado ou cancelado.",
  finished: "Este jogo já foi encerrado ou cancelado.",
  extra_time:
    "Jogo na prorrogação ou nos pênaltis — os mercados de 90 minutos já estão decididos.",
  interrupted: "Jogo interrompido — tente de novo quando o jogo recomeçar.",
  live_unavailable: "Placar ao vivo indisponível agora. Tente em um minuto.",
};

// Jogo rolando com estado bom (`phase.actionable`) e mesmo assim a capacidade fechada:
// o motivo é da capacidade, não do jogo.
const IN_PLAY_BLOCKED: Record<MatchCapability, string> = {
  analyze: "Sem modelo para a leitura ao vivo deste jogo.",
  seuPalpite: "Sem modelo para a leitura ao vivo deste jogo.",
  registerBets: "Placar ao vivo indisponível agora. Tente em um minuto.",
  pool: "As apostas deste bolão já fecharam.",
  analyzeMarkets:
    "Com o jogo em andamento, use Analisar com IA. A análise por mercado fica só antes do apito inicial.",
};

/**
 * Copy de UI de uma capacidade bloqueada, POR motivo (nunca "encerrado" num jogo ao
 * vivo). A capacidade vem na assinatura para cada chamador dizer qual pede; hoje os
 * motivos de pré-jogo têm a mesma copy em todas (compatibilidade com antes do #580).
 */
export function capabilityBlockedMessage(
  _capability: MatchCapability,
  reason: MatchUnavailableReason
): string {
  return MESSAGE[reason];
}

export type CapabilityGateContext = MatchCapabilityOptions & {
  now?: Date;
  /** Estado ao vivo lido no SERVIDOR (`match_live_states`); null = gate de hoje. */
  state?: LiveStateInput | null;
};

/**
 * `null` quando a capacidade está liberada; senão a copy do bloqueio. Sem `state` (ou
 * com o modo ao vivo desligado) é o gate de pré-jogo de hoje, o mesmo de
 * `lib/ai/predict.ts`: `scheduled` e kickoff no futuro (#385).
 */
export function capabilityGateMessage(
  capability: MatchCapability,
  match: { status: string; kickoffAt: Date },
  { now = new Date(), state = null, ...options }: CapabilityGateContext = {}
): string | null {
  const phase = matchPhase(match, state, now, {
    liveMode: options.liveMode ?? false,
  });
  if (matchCapabilities(phase, options)[capability]) return null;
  if (phase.actionable) return IN_PLAY_BLOCKED[capability];
  // `reason` só é null em pré-jogo, que libera tudo; o fallback é fail-closed.
  return capabilityBlockedMessage(capability, phase.reason ?? "finished");
}

export const SEU_PALPITE_PRE_MATCH_ONLY =
  "O Seu palpite fica aberto até o apito inicial.";

/**
 * Copy da aba "Seu palpite" quando ela não abre (página do jogo, #594). Com o modo ao
 * vivo desligado (ou antes do apito), a de sempre; ligado, POR motivo: um jogo ao vivo
 * nunca diz "fica aberto até o apito inicial".
 */
export function seuPalpiteClosedMessage(
  phase: MatchPhase,
  {
    liveMode = false,
    modelReady = false,
    hasScore = false,
  }: { liveMode?: boolean; modelReady?: boolean; hasScore?: boolean } = {}
): string {
  if (!liveMode || phase.kind === "pre") return SEU_PALPITE_PRE_MATCH_ONLY;
  if (phase.actionable) {
    // Sem placar não há leitura (a lista recusa); com placar, falta o modelo.
    if (!hasScore) return IN_PLAY_BLOCKED.registerBets;
    if (!modelReady) return IN_PLAY_BLOCKED.seuPalpite;
  }
  return capabilityBlockedMessage("seuPalpite", phase.reason ?? "finished");
}
