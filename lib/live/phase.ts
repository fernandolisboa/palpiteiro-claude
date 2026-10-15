// Fase do jogo ao vivo (#580, ADR 0060 §3), pura. A classificação do status curto da
// API-Football é a mesma do sync (`lib/providers/sports-data/api-football/constants.ts`),
// só que com granularidade de jogo em andamento: o que importa aqui é se dá pra ler o
// jogo (1º/2º tempo, intervalo) ou não (prorrogação, interrupção, terminal).

/** As colunas de `match_live_states` que decidem a fase (a row satisfaz este tipo). */
export type LiveStateInput = {
  statusShort: string | null;
  elapsed: number | null;
  extra: number | null;
  fetchedAt: Date | null;
};

export type LiveStatusClass =
  | "pre_match" // TBD, NS: ainda não começou (depois do horário = atraso)
  | "in_play" // 1H, 2H, LIVE (LIVE sem saber o tempo: minuto desconhecido)
  | "half_time" // HT
  | "extra_time" // ET, BT, P: os mercados de 90' já estão decididos
  | "interrupted" // INT, SUSP
  | "finished" // FT, AET, PEN, AWD, WO
  | "postponed" // PST
  | "cancelled" // CANC, ABD (o sync mapeia os dois para `cancelled`)
  | "unknown"; // código fora da lista: fail-closed

const STATUS_CLASS: Record<string, LiveStatusClass> = {
  TBD: "pre_match",
  NS: "pre_match",
  "1H": "in_play",
  "2H": "in_play",
  LIVE: "in_play",
  HT: "half_time",
  ET: "extra_time",
  BT: "extra_time",
  P: "extra_time",
  INT: "interrupted",
  SUSP: "interrupted",
  FT: "finished",
  AET: "finished",
  PEN: "finished",
  AWD: "finished",
  WO: "finished",
  PST: "postponed",
  CANC: "cancelled",
  ABD: "cancelled",
};

export function classifyStatusShort(short: string | null): LiveStatusClass {
  if (short === null) return "unknown";
  return STATUS_CLASS[short] ?? "unknown";
}

/** Terminal: a row não precisa ser buscada de novo (§5.2 passo 2). */
export function isTerminalStatusShort(short: string | null): boolean {
  const c = classifyStatusShort(short);
  return c === "finished" || c === "postponed" || c === "cancelled";
}

/**
 * Minuto conhecido = dá pra posicionar o jogo no tempo: 1º/2º tempo com `elapsed`, o
 * intervalo, ou o atraso (`NS`/`TBD` depois do horário, minuto 0). `LIVE` não diz o
 * tempo, e `1H`/`2H` sem `elapsed` não dizem o minuto.
 */
export function isMinuteKnown(
  state: Pick<LiveStateInput, "statusShort" | "elapsed">
): boolean {
  switch (state.statusShort) {
    case "1H":
    case "2H":
      return state.elapsed !== null;
    case "HT":
    case "NS":
    case "TBD":
      return true;
    default:
      return false;
  }
}

/**
 * Rótulo do minuto para a tela e o carimbo: "63'", "45+2'", "90+5'", "intervalo".
 * Atraso (`NS`/`TBD`) = "0'". Sem minuto conhecido → null. Provider que manda
 * `elapsed = 47` sem `extra` no 1º tempo sai "45+2'".
 */
export function liveMinuteLabel(
  state: Pick<LiveStateInput, "statusShort" | "elapsed" | "extra">
): string | null {
  if (!isMinuteKnown(state)) return null;
  switch (state.statusShort) {
    case "HT":
      return "intervalo";
    case "NS":
    case "TBD":
      return "0'";
  }
  const elapsed = state.elapsed ?? 0;
  const regulation = state.statusShort === "1H" ? 45 : 90;
  if (state.extra !== null && state.extra > 0) {
    return `${Math.min(elapsed, regulation)}+${state.extra}'`;
  }
  if (elapsed > regulation) return `${regulation}+${elapsed - regulation}'`;
  return `${elapsed}'`;
}
