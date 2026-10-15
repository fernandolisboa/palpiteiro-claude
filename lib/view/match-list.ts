import type { MatchRowView } from "@/lib/view/types";

/**
 * Fase da linha na lista de jogos (#577). Antes o mesmo if/else vivia em três
 * componentes (linha do celular, grade do desktop e célula de status); agora é um
 * lugar só. `live` = status `live` OU o derivado `isInProgress` (#385: pega o jogo
 * recém-apitado ainda `scheduled` no banco; o `live` cru pega o jogo longo que já
 * saiu da janela de 3h). `off` = adiado ou cancelado.
 *
 * Encaixe do #580 (ao vivo): dados novos entram no ramo `live` da linha
 * (`components/match-list/row-trailing.tsx`), sem mudar estas fases.
 */
export type MatchRowPhase = "live" | "finished" | "off" | "upcoming";

export function matchRowPhase(
  m: Pick<MatchRowView, "status" | "isInProgress">,
): MatchRowPhase {
  if (m.status === "live" || m.isInProgress) return "live";
  if (m.status === "finished") return "finished";
  if (m.status === "postponed" || m.status === "cancelled") return "off";
  return "upcoming";
}

export type MatchDayGroup<T> = { key: string; label: string; rows: T[] };

/**
 * Agrupa linhas CONSECUTIVAS pela chave do dia, preservando a ordem de entrada (a
 * query já ordena por kickoff; vale pros dois sentidos). Um grupo "Ao vivo" no topo
 * (#580) é troca do `day` no mapper, sem mudar esta função.
 */
export function groupByDay<T extends { day: { key: string; label: string } }>(
  rows: readonly T[],
): MatchDayGroup<T>[] {
  const groups: MatchDayGroup<T>[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.key === row.day.key) {
      last.rows.push(row);
    } else {
      groups.push({ key: row.day.key, label: row.day.label, rows: [row] });
    }
  }
  return groups;
}
