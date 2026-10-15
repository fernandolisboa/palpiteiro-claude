// Fase do jogo ao vivo (#580, ADR 0060 §3), pura. A classificação do status curto da
// API-Football é a mesma do sync (`lib/providers/sports-data/api-football/constants.ts`),
// só que com granularidade de jogo em andamento: o que importa aqui é se dá pra ler o
// jogo (1º/2º tempo, intervalo) ou não (prorrogação, interrupção, terminal).
//
// O gate de pré-jogo (`matchUnavailableReason`, #385) mora aqui também, para a fase
// não depender da camada de view: `lib/view/match-availability.ts` reexporta os dois e
// segue sendo a porta da página, das listas e das actions.

import {
  isLiveStateActionable,
  isPastInPlayWindow,
} from "@/lib/live/freshness";

// `null` = analisável (pré-jogo). `started` = DB ainda `scheduled` mas o kickoff já
// passou: pode estar rolando ou já ter acabado (o enum fica stale por até ~6h e a badge
// "ao vivo" só cobre 3h), então a copy é neutra, sem afirmar "em andamento".
// Ao vivo (#580, ADR 0060): `extra_time` (prorrogação/pênaltis, os mercados de 90' já
// estão decididos), `interrupted` e `live_unavailable` (o apito passou e o estado ao
// vivo está velho demais ou sem minuto). Só `matchPhase` com estado devolve esses três.
export type MatchUnavailableReason =
  | "started"
  | "live"
  | "postponed"
  | "cancelled"
  | "finished"
  | "extra_time"
  | "interrupted"
  | "live_unavailable";

/**
 * Pré-jogo = `scheduled` E kickoff no FUTURO (#385): o enum DB fica stale
 * `scheduled` por até ~6h depois do apito (cron de 6 em 6h), então um
 * `scheduled` já apitado vira `started`. `kickoffAt` é opcional: o caminho
 * de race das actions só tem o status; sem ele, decide só pelo status.
 * Status desconhecido → `finished` (fail-closed). Não olha o estado ao vivo.
 */
export function matchUnavailableReason(
  status: string,
  kickoffAt?: Date,
  now: Date = new Date()
): MatchUnavailableReason | null {
  switch (status) {
    case "scheduled":
      return kickoffAt !== undefined && kickoffAt.getTime() <= now.getTime()
        ? "started"
        : null;
    case "live":
    case "postponed":
    case "cancelled":
      return status;
    default:
      return "finished";
  }
}

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

export type MatchPhaseKind =
  | "pre"
  | "in_play" // 1º/2º tempo, ou NS/TBD depois do horário (atraso, minuto 0)
  | "half_time"
  | "extra_time"
  | "interrupted"
  | "finished"
  | "postponed"
  | "cancelled"
  | "started_unknown"; // apito passou e não há estado ao vivo utilizável

export type MatchPhase = {
  kind: MatchPhaseKind;
  /** Por que não é pré-jogo; null só em `pre`. Sem estado é o motivo de hoje. */
  reason: MatchUnavailableReason | null;
  /**
   * `in_play`/`half_time` com estado de no máximo 2 min (IN_PLAY_ACT_MAX_AGE_MS) e
   * minuto conhecido: dá pra registrar e ler o jogo ao vivo.
   */
  actionable: boolean;
};

function phaseFromReason(reason: MatchUnavailableReason): MatchPhase {
  switch (reason) {
    case "postponed":
    case "cancelled":
    case "finished":
    case "extra_time":
    case "interrupted":
      return { kind: reason, reason, actionable: false };
    case "started":
    case "live":
    case "live_unavailable":
      return { kind: "started_unknown", reason, actionable: false };
  }
}

/**
 * Fase do jogo agora. Com `liveMode` desligado, é exatamente o gate de hoje
 * (`matchUnavailableReason`): pré-jogo, ou bloqueado pelo mesmo motivo. Ligado, depois
 * do apito e sem estado (ou sem nenhuma busca bem-sucedida, `fetchedAt` null), a fase é
 * `started_unknown` com motivo `live_unavailable`. Com estado, o
 * status do provider decide a fase depois do apito; um terminal no DB (o sync só grava
 * depois do fim) vence o estado. O estado nunca reabre um jogo que o DB diz ser
 * pré-jogo: antes do apito, a fase é `pre`. Passada a janela de busca (kickoff + 4h)
 * sem um terminal lido, o estado não vai mais chegar: volta o motivo de hoje
 * (`started`), não um "placar indisponível" que nunca se resolve.
 */
export function matchPhase(
  match: { status: string; kickoffAt: Date },
  state: LiveStateInput | null,
  now: Date = new Date(),
  { liveMode }: { liveMode: boolean } = { liveMode: false }
): MatchPhase {
  const legacy = matchUnavailableReason(match.status, match.kickoffAt, now);
  if (legacy === null) return { kind: "pre", reason: null, actionable: false };
  if (!liveMode) return phaseFromReason(legacy);
  if (legacy !== "started" && legacy !== "live") return phaseFromReason(legacy);
  if (
    isPastInPlayWindow(match.kickoffAt, now) &&
    !isTerminalStatusShort(state?.statusShort ?? null)
  ) {
    return phaseFromReason(legacy);
  }
  // Modo ao vivo ligado, apito passado e nenhum estado lido (provider fora, sem row):
  // "placar indisponível", não a copy de antes do modo ao vivo ("só antes do apito").
  if (state === null || state.fetchedAt === null) {
    return phaseFromReason("live_unavailable");
  }

  const cls = classifyStatusShort(state.statusShort);
  switch (cls) {
    case "pre_match":
    case "in_play":
    case "half_time": {
      const actionable =
        isLiveStateActionable(state.fetchedAt, now) && isMinuteKnown(state);
      return {
        kind: cls === "half_time" ? "half_time" : "in_play",
        reason: actionable ? "live" : "live_unavailable",
        actionable,
      };
    }
    case "extra_time":
    case "interrupted":
    case "finished":
    case "postponed":
    case "cancelled":
      return phaseFromReason(cls);
    case "unknown":
      return phaseFromReason("live_unavailable");
  }
}
