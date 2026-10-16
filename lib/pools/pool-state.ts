import { isLiveStateActionable } from "@/lib/live/freshness";
import {
  classifyStatusShort,
  matchUnavailableReason,
  type LiveStateInput,
} from "@/lib/live/phase";
import { resolvePoolScore } from "@/lib/pools/winners";

// Estado do bolão derivado do jogo (#567), puro e com `now` injetável. Com o modo ao
// vivo (#580, ADR 0060 §7, emenda a ADR 0054 §3) são três perguntas separadas:
// - tirar aposta (`poolEntriesRemovable`): só antes do apito, com ou sem modo ao vivo;
// - a janela do jogo (`poolWindowOpen`, criar bolão e o atalho da página do jogo): até
//   os 15' de jogo, ou apito + 15 min de relógio sem minuto do provider;
// - anotar (`poolBetsOpen`): a janela, mais o "fechar" e o "reabrir" do dono e o
//   "estender" do admin; com resultado (placar manual ou do jogo encerrado) nunca.
// Com `enable_live_mode` desligado tudo fecha no apito, como antes, e os controles do
// dono e do admin somem (`poolOwnerClosable`, `poolOwnerReopenable`, `poolExtendable`).
// Reabrir (#601) não tem coluna própria. Antes do apito só desfaz o "fechar" (volta a
// janela de sempre); depois, é uma extensão até o teto (apito + 3h), então fica aberto
// até o dono fechar de novo ou o jogo acabar (`poolOpenUntilEnd`).

/** Minuto jogado em que o bolão fecha sozinho. */
export const POOL_LIVE_CUTOFF_MINUTE = 15;
/** Sem minuto do provider: o bolão fecha no apito + isto, pelo relógio. */
export const POOL_CLOCK_CUTOFF_MS = POOL_LIVE_CUTOFF_MINUTE * 60_000;
/** "Estender prazo" do admin: minutos a partir de agora. */
export const POOL_EXTEND_PRESETS_MIN = [15, 30, 60] as const;
export type PoolExtendPreset = (typeof POOL_EXTEND_PRESETS_MIN)[number];
/** Teto da extensão: apito + 3h. */
export const POOL_EXTEND_CAP_MS = 3 * 60 * 60_000;
/**
 * Depois do apito + isto (tempo normal com o intervalo), o jogo pode ter acabado: o
 * "reabrir" do dono só vale com estado ao vivo novo (`poolReopenNeedsFreshState`).
 */
export const POOL_REOPEN_FRESH_AFTER_MS = 105 * 60_000;

/** Placar do jogo opcional: só entra na pergunta "o bolão já tem resultado?". */
export type PoolMatch = {
  status: string;
  kickoffAt: Date;
  homeScore?: number | null;
  awayScore?: number | null;
};
/** Os controles do dono e do admin e o placar manual (colunas de `friend_pools`). */
export type PoolControls = {
  betsClosedAt?: Date | null;
  betsExtendedUntil?: Date | null;
  manualHomeScore?: number | null;
  manualAwayScore?: number | null;
};
export type PoolLiveOptions = { liveMode: boolean };

/** Tirar aposta = o jogo ainda não começou. Não muda com o modo ao vivo. */
export function poolEntriesRemovable(match: PoolMatch, now: Date = new Date()): boolean {
  return matchUnavailableReason(match.status, match.kickoffAt, now) === null;
}

/**
 * Onde o jogo está em relação à janela do bolão:
 * - `pre`: antes do apito;
 * - `minute`: ao vivo com minuto do provider (1º tempo, ou o atraso `NS` depois do
 *   horário), aberto enquanto o minuto estimado < 15;
 * - `clock`: ao vivo sem minuto do provider, aberto até `closesAt` (apito + 15 min);
 * - `closed`.
 */
export type PoolWindow =
  | { kind: "pre" }
  | { kind: "minute"; estimatedMinute: number }
  | { kind: "clock"; closesAt: Date }
  | { kind: "closed" };

function clockWindow(match: PoolMatch, now: Date): PoolWindow {
  const closesAt = new Date(match.kickoffAt.getTime() + POOL_CLOCK_CUTOFF_MS);
  return now.getTime() < closesAt.getTime() ? { kind: "clock", closesAt } : { kind: "closed" };
}

function minuteWindow(estimatedMinute: number): PoolWindow {
  return estimatedMinute < POOL_LIVE_CUTOFF_MINUTE
    ? { kind: "minute", estimatedMinute }
    : { kind: "closed" };
}

export function poolWindow(
  match: PoolMatch,
  state: LiveStateInput | null,
  now: Date = new Date(),
  { liveMode }: PoolLiveOptions = { liveMode: false },
): PoolWindow {
  const legacy = matchUnavailableReason(match.status, match.kickoffAt, now);
  if (legacy === null) return { kind: "pre" };
  if (!liveMode) return { kind: "closed" };
  // Adiado, cancelado, encerrado no DB: fechado (o DB terminal vence o estado).
  if (legacy !== "started" && legacy !== "live") return { kind: "closed" };
  if (state === null || state.fetchedAt === null) return clockWindow(match, now);

  // O minuto é extrapolado pela idade do estado: um estado velho não deixa o bolão
  // aberto além do corte. No atraso (`NS` depois do horário) a extrapolação supõe que a
  // bola rolou no instante da leitura, o que só pode adiantar o corte, nunca atrasar.
  const ageMin = Math.max(0, now.getTime() - state.fetchedAt.getTime()) / 60_000;
  switch (classifyStatusShort(state.statusShort)) {
    case "pre_match":
      return minuteWindow(ageMin);
    case "in_play":
      if (state.statusShort === "1H" && state.elapsed !== null) {
        // No 1º tempo `extra` só existe depois do 45', irrelevante para o corte.
        return minuteWindow(state.elapsed + ageMin);
      }
      // `2H`: já passou dos 15'. `LIVE` ou `1H` sem `elapsed`: sem minuto, relógio.
      return state.statusShort === "2H" ? { kind: "closed" } : clockWindow(match, now);
    case "half_time":
    case "extra_time":
    case "interrupted":
    case "finished":
    case "postponed":
    case "cancelled":
      return { kind: "closed" };
    case "unknown":
      return clockWindow(match, now);
  }
}

/** A janela do jogo está aberta (criar bolão, atalho "criar bolão" da página do jogo). */
export function poolWindowOpen(
  match: PoolMatch,
  state: LiveStateInput | null,
  now: Date = new Date(),
  opts: PoolLiveOptions = { liveMode: false },
): boolean {
  return poolWindow(match, state, now, opts).kind !== "closed";
}

/** O bolão já tem resultado (`resolvePoolScore`: placar manual > jogo encerrado). */
export function poolHasResult(pool: PoolControls, match: PoolMatch): boolean {
  return (
    resolvePoolScore(
      {
        manualHomeScore: pool.manualHomeScore ?? null,
        manualAwayScore: pool.manualAwayScore ?? null,
      },
      {
        status: match.status,
        homeScore: match.homeScore ?? null,
        awayScore: match.awayScore ?? null,
      },
    ) !== null
  );
}

/** O dono fechou as apostas (e ainda não reabriu: reabrir limpa `bets_closed_at`). */
export function poolClosedByOwner(pool: PoolControls, now: Date = new Date()): boolean {
  return pool.betsClosedAt != null && pool.betsClosedAt.getTime() <= now.getTime();
}

/** Jogo terminado (ou que não vai ser jogado): pelo DB ou pelo estado ao vivo. */
export function poolMatchEnded(
  match: PoolMatch,
  state: LiveStateInput | null,
  now: Date = new Date(),
): boolean {
  const legacy = matchUnavailableReason(match.status, match.kickoffAt, now);
  if (legacy === "finished" || legacy === "postponed" || legacy === "cancelled") return true;
  if (state === null || state.fetchedAt === null) return false;
  const cls = classifyStatusShort(state.statusShort);
  return cls === "finished" || cls === "postponed" || cls === "cancelled";
}

/**
 * Extensão do admin valendo agora: prazo no futuro e jogo não terminado. Com o modo ao
 * vivo desligado não vale (kill-switch: tudo fecha no apito).
 */
export function poolExtensionActive(
  pool: PoolControls,
  match: PoolMatch,
  state: LiveStateInput | null,
  now: Date = new Date(),
  { liveMode }: PoolLiveOptions = { liveMode: false },
): boolean {
  if (!liveMode || pool.betsExtendedUntil == null) return false;
  if (pool.betsExtendedUntil.getTime() <= now.getTime()) return false;
  return !poolMatchEnded(match, state, now);
}

/**
 * Anotar aposta: com resultado → fechado (o placar lançado não muda com aposta nova);
 * o dono fechou → fechado; extensão valendo → aberto; senão a janela do jogo. A
 * extensão só alonga: quando ela vence, volta a valer a janela.
 */
export function poolBetsOpen(
  pool: PoolControls,
  match: PoolMatch,
  state: LiveStateInput | null,
  now: Date = new Date(),
  opts: PoolLiveOptions = { liveMode: false },
): boolean {
  if (poolHasResult(pool, match)) return false;
  if (poolClosedByOwner(pool, now)) return false;
  if (poolExtensionActive(pool, match, state, now, opts)) return true;
  return poolWindowOpen(match, state, now, opts);
}

/** Placar manual: só depois do apito e com as apostas fechadas. */
export function poolManualScoreAllowed(
  pool: PoolControls,
  match: PoolMatch,
  state: LiveStateInput | null,
  now: Date = new Date(),
  opts: PoolLiveOptions = { liveMode: false },
): boolean {
  return !poolEntriesRemovable(match, now) && !poolBetsOpen(pool, match, state, now, opts);
}

/**
 * Até quando a extensão vai: `now + minutos`, com teto no apito + 3h. `null` quando o
 * teto já passou (não há o que estender).
 */
export function poolExtensionUntil(
  match: PoolMatch,
  now: Date,
  minutes: PoolExtendPreset,
): Date | null {
  const cap = match.kickoffAt.getTime() + POOL_EXTEND_CAP_MS;
  if (now.getTime() >= cap) return null;
  return new Date(Math.min(now.getTime() + minutes * 60_000, cap));
}

/**
 * "Fechar apostas" do dono: só com o modo ao vivo (flag desligada = como antes, sem o
 * controle) e com as apostas abertas.
 */
export function poolOwnerClosable(
  pool: PoolControls,
  match: PoolMatch,
  state: LiveStateInput | null,
  now: Date = new Date(),
  opts: PoolLiveOptions = { liveMode: false },
): boolean {
  return opts.liveMode && poolBetsOpen(pool, match, state, now, opts);
}

/** O teto técnico da extensão e do "reabrir": apito + 3h. */
export function poolExtendCap(match: PoolMatch): Date {
  return new Date(match.kickoffAt.getTime() + POOL_EXTEND_CAP_MS);
}

/**
 * A extensão vai até o teto: é o "reabrir" do dono (#601), ou uma extensão do admin que
 * bateu no teto. Nos dois casos as apostas ficam abertas até o jogo acabar (ou o dono
 * fechar). Só diz do prazo gravado; se vale agora é `poolExtensionActive`.
 */
export function poolOpenUntilEnd(pool: PoolControls, match: PoolMatch): boolean {
  return (
    pool.betsExtendedUntil != null &&
    pool.betsExtendedUntil.getTime() >= poolExtendCap(match).getTime()
  );
}

/**
 * O admin pode estender agora: modo ao vivo ligado, depois do apito (antes dele as
 * apostas já estão abertas), sem resultado no bolão, jogo não terminado e antes do teto.
 */
export function poolExtendable(
  pool: PoolControls,
  match: PoolMatch,
  state: LiveStateInput | null,
  now: Date = new Date(),
  { liveMode }: PoolLiveOptions = { liveMode: false },
): boolean {
  if (!liveMode || poolEntriesRemovable(match, now)) return false;
  if (poolHasResult(pool, match) || poolMatchEnded(match, state, now)) return false;
  return now.getTime() < match.kickoffAt.getTime() + POOL_EXTEND_CAP_MS;
}

/**
 * "Reabrir apostas" do dono (#601), só com o modo ao vivo ligado (flag desligada = como
 * antes, sem o controle):
 * - antes do apito: o dono fechou as apostas (e o bolão não tem resultado). Reabrir só
 *   limpa o fechamento: volta a janela de sempre (pré-jogo, depois o corte dos 15');
 * - depois do apito: apostas fechadas agora (pelo corte dos 15', pelo próprio dono ou
 *   por uma extensão vencida), sem resultado, jogo não terminado e antes do teto (apito
 *   + 3h). Reabrir grava a extensão até o teto.
 * Fechar e reabrir podem se alternar quantas vezes o dono quiser.
 */
export function poolOwnerReopenable(
  pool: PoolControls,
  match: PoolMatch,
  state: LiveStateInput | null,
  now: Date = new Date(),
  opts: PoolLiveOptions = { liveMode: false },
): boolean {
  if (!opts.liveMode) return false;
  if (poolEntriesRemovable(match, now)) {
    return poolClosedByOwner(pool, now) && !poolHasResult(pool, match);
  }
  return (
    poolExtendable(pool, match, state, now, opts) && !poolBetsOpen(pool, match, state, now, opts)
  );
}

/**
 * O "reabrir" depois do apito + 105 min pede estado ao vivo novo (≤ 2 min, a regra de
 * registrar): sem ele (cota baixa ou busca falhou devolvem a row velha, que ainda diz
 * 1º/2º tempo), não dá pra saber se o jogo já acabou, e reabrir deixaria apostar com o
 * jogo encerrado até o teto. Só para a action de reabrir; a extensão não muda.
 */
export function poolReopenNeedsFreshState(
  match: PoolMatch,
  state: LiveStateInput | null,
  now: Date = new Date(),
): boolean {
  if (now.getTime() <= match.kickoffAt.getTime() + POOL_REOPEN_FRESH_AFTER_MS) return false;
  return state === null || !isLiveStateActionable(state.fetchedAt, now);
}

/**
 * O detalhe do bolão deve buscar o estado ao vivo (`getInPlayState`) agora? Só depois
 * do apito, com o modo ao vivo ligado e enquanto o bolão ainda pode estar aberto pela
 * row que já existe (do apito até o corte ou o fim da extensão; PLAN-580 §10). Reaberto
 * pelo dono (#601) é uma extensão até o teto: busca enquanto o jogo não acaba. O atraso
 * (`NS`) sempre busca: a extrapolação de uma row velha pode ter fechado cedo demais.
 */
export function poolLiveStateWanted(
  pool: PoolControls,
  match: PoolMatch,
  row: LiveStateInput | null,
  now: Date = new Date(),
  opts: PoolLiveOptions = { liveMode: false },
): boolean {
  if (!opts.liveMode) return false;
  const legacy = matchUnavailableReason(match.status, match.kickoffAt, now);
  if (legacy !== "started" && legacy !== "live") return false;
  if (poolClosedByOwner(pool, now)) return false;
  if (poolBetsOpen(pool, match, row, now, opts)) return true;
  return row !== null && row.fetchedAt !== null && classifyStatusShort(row.statusShort) === "pre_match";
}
