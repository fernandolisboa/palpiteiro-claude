import { z } from "zod";

import {
  ConfirmBetLegSchema,
  MAX_LEGS,
  MAX_RAW_INPUT,
  type ConfirmBetLeg,
} from "@/lib/ai/bet-parse/schema";
import { MAX_SLIP_SELECTIONS } from "@/lib/bets/slip-markets";
import { parsePtBrOdd } from "@/lib/view/grade-my-bet-input";

// Contrato fail-closed do cupom (#556). Módulo SEM "use server": o cliente monta o
// payload, a action re-valida. Cada perna reusa o ConfirmBetLegSchema da aposta em
// texto (params = os schemas das regras de settlement, guard anti-drift) e só soma o
// stake opcional em unidades.

export const MAX_STAKE_UNITS = 100;
// Teto das colunas numeric(6,3) de bet_slips.combo_user_odd e bet_legs.user_odd: acima
// disso o insert estoura (numeric field overflow).
export const MAX_SLIP_ODD = 999.999;

const PtBrOddSchema = z
  .string()
  .transform(parsePtBrOdd)
  .pipe(z.number().finite().gt(1).lte(MAX_SLIP_ODD));

const PtBrStakeSchema = z
  .string()
  .transform(parsePtBrOdd)
  .pipe(z.number().finite().gt(0).lte(MAX_STAKE_UNITS));

const RawLegSchema = z
  .object({ stakeUnits: PtBrStakeSchema.optional() })
  .catchall(z.unknown());

const EnvelopeSchema = z
  .object({
    matchId: z.uuid(),
    mode: z.enum(["simples", "combinada"]),
    legs: z.array(RawLegSchema).min(1).max(MAX_SLIP_SELECTIONS),
    comboUserOdd: PtBrOddSchema.optional(),
    comboStakeUnits: PtBrStakeSchema.optional(),
    // Preenchido quando o cupom veio do atalho "digite sua aposta".
    rawInput: z.string().max(MAX_RAW_INPUT).nullable().optional(),
    parseAiCallId: z.uuid().nullable().optional(),
    // A tabela que montou o cupom estava no modo ao vivo (#580). Página aberta antes do
    // apito manda false (ou nada): a odd foi pré-preenchida com a de pré-jogo e a action
    // recusa registrar ao vivo a partir dela.
    gridLive: z.boolean().optional(),
  })
  .strict();

export type SlipLegValidated = ConfirmBetLeg & { stakeUnits: number | null };

export type ValidatedSlip = {
  matchId: string;
  mode: "simples" | "combinada";
  legs: SlipLegValidated[];
  comboUserOdd: number | null;
  comboStakeUnits: number | null;
  rawInput: string | null;
  parseAiCallId: string | null;
  gridLive: boolean;
};

export type SlipValidationError =
  | "payload"
  | "perna"
  | "combinada-curta"
  | "combinada-longa"
  | "perna-repetida";

export function parseSlipPayload(
  raw: unknown,
): { ok: true; slip: ValidatedSlip } | { ok: false; error: SlipValidationError } {
  const env = EnvelopeSchema.safeParse(raw);
  if (!env.success) return { ok: false, error: "payload" };

  const legs: SlipLegValidated[] = [];
  for (const rawLeg of env.data.legs) {
    const { stakeUnits, ...rest } = rawLeg;
    const leg = ConfirmBetLegSchema.safeParse(rest);
    if (!leg.success) return { ok: false, error: "perna" };
    if (leg.data.userOdd !== undefined && leg.data.userOdd > MAX_SLIP_ODD) {
      return { ok: false, error: "perna" };
    }
    legs.push({ ...leg.data, stakeUnits: stakeUnits ?? null });
  }

  // A mesma seleção duas vezes no mesmo cupom é erro de UI, não aposta.
  const seen = new Set(legs.map((l) => `${l.kind}:${JSON.stringify(l.params)}`));
  if (seen.size !== legs.length) return { ok: false, error: "perna-repetida" };

  const combinada = env.data.mode === "combinada";
  if (combinada && legs.length < 2) return { ok: false, error: "combinada-curta" };
  if (combinada && legs.length > MAX_LEGS) {
    return { ok: false, error: "combinada-longa" };
  }

  return {
    ok: true,
    slip: {
      matchId: env.data.matchId,
      mode: env.data.mode,
      legs,
      // Odd/stake da combinada só valem no modo combinada.
      comboUserOdd: combinada ? (env.data.comboUserOdd ?? null) : null,
      comboStakeUnits: combinada ? (env.data.comboStakeUnits ?? null) : null,
      rawInput: env.data.rawInput ?? null,
      parseAiCallId: env.data.parseAiCallId ?? null,
      gridLive: env.data.gridLive ?? false,
    },
  };
}
