import type { DbMatch } from "@/lib/db/queries/matches";

/**
 * Gate de quota da The Odds API: só vale buscar odds de um jogo PRÉ-JOGO, ou seja
 * `status === "scheduled"` E kickoff estritamente no futuro. PURA (now injetável).
 *
 * Bloqueia (sem chamada ao provider):
 * - kickoff ≤ now, qualquer status (inclui o `scheduled` stale pós-apito: o enum só
 *   é atualizado pelo cron de fixtures, de 6 em 6h);
 * - `live` / `finished` / `cancelled` (e qualquer status futuro: allowlist, não
 *   denylist — fail-closed como o gate de `predict.ts`);
 * - `postponed`: o jogo remarcado vira OUTRA row (`external_id` inclui o kickoff,
 *   ver `compositeFixtureKey`), que nasce `scheduled`. A row adiada não é analisável
 *   (`matchUnavailableReason`/`predict.ts`), então odds novas dela não têm consumidor.
 *
 * Por que não buscar depois do apito: a escrita só cobre jogos com kickoff ≥ now
 * (`getMatchesInLeagueWindow`), então o snapshot de um jogo começado nunca ficava
 * fresco e cada visita gastava créditos sem gravar nada. E alargar a janela de
 * escrita gravaria odds AO VIVO, contaminando a referência pré-jogo (closing line/CLV).
 *
 * A captura de fechamento do CLV (KO em ≤90min) cai inteira no lado permitido:
 * só o instante do kickoff em diante é bloqueado.
 *
 * Espelha o gate de pré-jogo de `predict.ts`/`matchUnavailableReason`, mas mora aqui
 * de propósito: mesmo que um dia o jogo ao vivo vire analisável, odds ao vivo nunca
 * devem entrar como snapshot pré-jogo.
 */
export function isPreMatchForOdds(
  match: Pick<DbMatch, "status" | "kickoffAt">,
  now: Date = new Date(),
): boolean {
  return (
    match.status === "scheduled" &&
    match.kickoffAt.getTime() > now.getTime()
  );
}
