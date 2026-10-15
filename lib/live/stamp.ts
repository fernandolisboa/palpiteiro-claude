import { z } from "zod";

// Carimbo de um registro feito com o jogo rolando (#580, ADR 0060 §6): o que estava em
// campo quando a predição, a aposta, o palpite ou a aposta do bolão foi gravada. Vai na
// coluna `live_state` (jsonb) de predictions, bet_slips, palpite_sets,
// user_palpite_analyses e friend_pool_entries, sempre junto de `is_live = true` (CHECK
// no banco). Zod nos dois sentidos: a escrita valida e falha alto (bug nosso); a leitura
// usa safeParse e nunca lança (jsonb editado à mão vira "ao vivo, sem carimbo").
//
// Instantes em ISO 8601 (jsonb não tem tipo de data). O estado vem SEMPRE do servidor
// (match_live_states), nunca do cliente.

export const LIVE_STAMP_VERSION = 1 as const;

const GoalsPairSchema = z.object({
  home: z.number().int().min(0).max(99),
  away: z.number().int().min(0).max(99),
});

const IsoInstantSchema = z.string().datetime({ offset: true });

// Entradas do modelo em jogo (§6.4), para a leitura ficar recomputável a partir da row.
// Opcional: o bolão e os registros sem modelo não têm.
const InPlayStampSchema = z.object({
  liveModelVersion: z.string().min(1).max(40),
  r: z.number().min(0).max(1),
  muHome: z.number().min(0),
  muAway: z.number().min(0),
  multipliers: z.object({
    home: z.number().positive(),
    away: z.number().positive(),
  }),
  preMatch: z.object({
    source: z.string().min(1).max(40),
    lambdaHome: z.number().min(0),
    lambdaAway: z.number().min(0),
    rho: z.number(),
    baseCheckedAt: IsoInstantSchema.nullable(),
  }),
});

export const LiveStampSchema = z.object({
  v: z.literal(LIVE_STAMP_VERSION),
  // `api_football` = estado do provider; `clock` = sem minuto do provider (só o bolão,
  // que anota pelo relógio desde o apito).
  source: z.enum(["api_football", "clock"]),
  // Status curto do provider ("1H", "HT", "2H"…); null no relógio.
  status: z.string().min(1).max(8).nullable(),
  elapsed: z.number().int().min(0).max(200).nullable(),
  extra: z.number().int().min(0).max(60).nullable(),
  // "63'", "45+2'", "intervalo"; null quando não há minuto.
  minuteLabel: z.string().min(1).max(20).nullable(),
  score: GoalsPairSchema.nullable(),
  // Vermelhos por time; null = sem dado de expulsão.
  red: GoalsPairSchema.nullable(),
  // Instante da resposta do provider; null no relógio.
  fetchedAt: IsoInstantSchema.nullable(),
  recordedAt: IsoInstantSchema,
  inPlay: InPlayStampSchema.optional(),
});

export type LiveStamp = z.infer<typeof LiveStampSchema>;
export type InPlayStamp = z.infer<typeof InPlayStampSchema>;

/** Entrada da escrita: instantes como `Date`; o resto igual ao carimbo. */
export type LiveStampInput = Omit<
  LiveStamp,
  "v" | "fetchedAt" | "recordedAt" | "inPlay"
> & {
  fetchedAt: Date | null;
  recordedAt: Date;
  inPlay?: Omit<InPlayStamp, "preMatch"> & {
    preMatch: Omit<InPlayStamp["preMatch"], "baseCheckedAt"> & {
      baseCheckedAt: Date | null;
    };
  };
};

/**
 * Monta e VALIDA o carimbo para gravar. Lança em entrada inválida: o carimbo sai do
 * código (estado lido no servidor), então inválido é bug e não pode ir pro banco.
 */
export function buildLiveStamp(input: LiveStampInput): LiveStamp {
  const { inPlay, ...rest } = input;
  return LiveStampSchema.parse({
    ...rest,
    v: LIVE_STAMP_VERSION,
    fetchedAt: input.fetchedAt?.toISOString() ?? null,
    recordedAt: input.recordedAt.toISOString(),
    ...(inPlay
      ? {
          inPlay: {
            ...inPlay,
            preMatch: {
              ...inPlay.preMatch,
              baseCheckedAt:
                inPlay.preMatch.baseCheckedAt?.toISOString() ?? null,
            },
          },
        }
      : {}),
  });
}

/**
 * As duas colunas de uma vez, coerentes com o CHECK `is_live = false OR live_state IS
 * NOT NULL`: sem carimbo = registro de pré-jogo.
 */
export function liveColumns(stamp: LiveStamp | null): {
  isLive: boolean;
  liveState: LiveStamp | null;
} {
  return stamp === null
    ? { isLive: false, liveState: null }
    : { isLive: true, liveState: LiveStampSchema.parse(stamp) };
}

/**
 * Lê o jsonb gravado. Nunca lança: ausente ou inválido → null (o chamador mostra "ao
 * vivo" pelo `is_live`, sem minuto nem placar).
 */
export function readLiveStamp(raw: unknown): LiveStamp | null {
  if (raw === null || raw === undefined) return null;
  const parsed = LiveStampSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** O estado lido no servidor que vira carimbo (o InPlayState satisfaz). */
export type StampableState = {
  statusShort: string;
  elapsed: number | null;
  extra: number | null;
  minuteLabel: string | null;
  score: { home: number; away: number } | null;
  red: { home: number; away: number } | null;
  fetchedAt: Date;
};

/** As entradas do modelo em jogo que tornam a leitura recomputável (InPlayMeta cabe). */
export type StampableInPlay = {
  liveModelVersion: string;
  r: number;
  muHome: number;
  muAway: number;
  multipliers: { home: number; away: number };
  preMatch: {
    source: string;
    lambdaHome: number;
    lambdaAway: number;
    rho: number;
    baseCheckedAt: Date | null;
  };
};

/**
 * Carimbo de um registro feito com o estado do provider (`source: "api_football"`),
 * validado. `inPlay` = as entradas do modelo em jogo quando houve avaliação; sem modelo,
 * o carimbo leva só o momento. Lança em entrada inválida (como `buildLiveStamp`).
 */
export function liveStampFromState(
  state: StampableState,
  recordedAt: Date,
  inPlay: StampableInPlay | null = null
): LiveStamp {
  return buildLiveStamp({
    source: "api_football",
    status: state.statusShort,
    elapsed: state.elapsed,
    extra: state.extra,
    minuteLabel: state.minuteLabel,
    score: state.score,
    red: state.red,
    fetchedAt: state.fetchedAt,
    recordedAt,
    ...(inPlay
      ? {
          inPlay: {
            liveModelVersion: inPlay.liveModelVersion,
            r: inPlay.r,
            muHome: inPlay.muHome,
            muAway: inPlay.muAway,
            multipliers: { ...inPlay.multipliers },
            preMatch: { ...inPlay.preMatch },
          },
        }
      : {}),
  });
}
