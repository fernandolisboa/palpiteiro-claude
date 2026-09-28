// Por que um jogo não aceita análise agora — fonte única do gate de pré-jogo (#385)
// pra página do jogo (HERO + aviso) e pras actions (notAnalyzableMessage). A copy
// sai POR estado: um jogo ao vivo ou adiado não pode dizer "encerrado".

// `null` = analisável (pré-jogo).
export type MatchUnavailableReason =
  | "live"
  | "postponed"
  | "cancelled"
  | "finished";

/**
 * Pré-jogo = `scheduled` E kickoff no FUTURO (#385): o enum DB fica stale
 * `scheduled` por até ~6h depois do apito (cron de 6 em 6h), então um
 * `scheduled` já apitado conta como ao vivo. `kickoffAt` é opcional: o caminho
 * de race das actions só tem o status; sem ele, decide só pelo status.
 * Status desconhecido → `finished` (fail-closed).
 */
export function matchUnavailableReason(
  status: string,
  kickoffAt?: Date,
  now: Date = new Date()
): MatchUnavailableReason | null {
  switch (status) {
    case "scheduled":
      return kickoffAt !== undefined && kickoffAt.getTime() <= now.getTime()
        ? "live"
        : null;
    case "live":
    case "postponed":
    case "cancelled":
      return status;
    default:
      return "finished";
  }
}

// Linha do HERO sem palpite quando não dá mais pra analisar.
export const EMPTY_HERO_UNAVAILABLE_COPY: Record<
  MatchUnavailableReason,
  string
> = {
  live: "Jogo em andamento, sem palpite por aqui. O palpite só sai antes do apito inicial.",
  postponed:
    "Jogo adiado, sem palpite por enquanto. Dá pra analisar quando ele for remarcado.",
  cancelled: "Jogo cancelado, sem palpite por aqui.",
  finished: "Jogo encerrado, sem palpite por aqui.",
};

// Aviso (label + detalhe) abaixo do HERO quando o jogo não é analisável e não tem
// análise salva. Placar final só entra no encerrado.
export function unavailableNoticeCopy(
  reason: MatchUnavailableReason,
  score: { home: number; away: number } | null
): { label: string; detail: string } {
  switch (reason) {
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
  }
}
