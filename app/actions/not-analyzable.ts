// Gate de analisabilidade market-agnóstico (helper PURO, não-action) — vive FORA
// de predictions.ts ("use server") porque num módulo server TODO export tem que
// ser uma async Server Action (Next falha o build senão). Compartilhado pelos 3
// fan-outs + o caminho de race do friendlyMessage, e testado direto.

/**
 * Pré-jogo = `scheduled` E kickoff no FUTURO (#385): o enum DB fica stale
 * `scheduled` por até ~6h depois do apito (cron de 6 em 6h), então o status
 * sozinho deixaria gastar num jogo já em andamento. `live`/`postponed` NÃO têm odds
 * pré-jogo (ou data definida) e `finished`/`cancelled` já passaram. Retorna
 * `null` quando analisável; senão a copy de UI POR status (pra não dizer
 * "encerrado" num jogo ao vivo). Espelha o gate de `predict.ts` — read grátis,
 * curto-circuita ANTES de qualquer pré-warm/spend.
 *
 * `kickoffAt` é opcional: o caminho de race (friendlyMessage) só tem o status do
 * context; quando ausente, cai no switch por status (sem o gate de kickoff).
 */
export function notAnalyzableMessage(
  status: string,
  kickoffAt?: Date,
  now: Date = new Date(),
): string | null {
  // Jogo já apitado mas ainda DB-`scheduled` (cron 6h não virou): em andamento,
  // não analisável — MESMA copy do `live`.
  if (
    status === "scheduled" &&
    kickoffAt !== undefined &&
    kickoffAt.getTime() <= now.getTime()
  ) {
    return "Jogo em andamento — a análise fica disponível só antes do apito inicial.";
  }
  switch (status) {
    case "scheduled":
      return null;
    case "live":
      return "Jogo em andamento — a análise fica disponível só antes do apito inicial.";
    case "postponed":
      return "Jogo adiado — análise indisponível até o jogo ser remarcado.";
    default:
      // finished | cancelled (+ qualquer status futuro): fail-closed.
      return "Este jogo já foi encerrado ou cancelado.";
  }
}
