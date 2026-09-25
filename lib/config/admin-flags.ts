import { z } from "zod";

// `import type`: o registry é lido também pela UI; nada de drizzle no bundle.
import type { aiConfig } from "@/db/schema";

// Registry declarativo das flags de `ai_config` (single row id=1) editáveis no
// /admin/settings (#514). A seção "flags" da página, o Server Action e a query
// layer (getAdminFlagValues/setAdminFlag) são dirigidos por ESTA lista: uma flag
// nova (boolean ou enum) entra com uma entrada aqui + a coluna no schema, sem
// mexer na tela. Os getters dedicados (getEnable*) seguem sendo a leitura do
// runtime; este registry só descreve e edita.

type AiConfigRow = typeof aiConfig.$inferSelect;
type AiConfigColumn = keyof AiConfigRow;

/** Colunas boolean de ai_config — typo no `key` vira erro de compilação. */
export type BooleanFlagColumn = {
  [K in AiConfigColumn]: AiConfigRow[K] extends boolean ? K : never;
}[AiConfigColumn];

/** Colunas text de ai_config (candidatas a flag enum). */
export type EnumFlagColumn = {
  [K in AiConfigColumn]: AiConfigRow[K] extends string ? K : never;
}[AiConfigColumn];

type FlagCommon = {
  /** Rótulo curto em PT-BR. */
  label: string;
  /** Uma ou duas frases: o que a flag faz ligada/desligada. */
  description: string;
  /** Nota de custo (quota de API, chamadas pagas de LLM). Opcional. */
  costNote?: string;
};

export type BooleanFlagDef = FlagCommon & {
  key: BooleanFlagColumn;
  kind: "boolean";
  /** Tem que casar com o default da coluna E o `??` do getter (teste pina). */
  default: boolean;
};

export type EnumFlagDef<V extends string = string> = FlagCommon & {
  key: EnumFlagColumn;
  kind: "enum";
  values: readonly [V, ...V[]];
  /** Rótulo por valor no select; sem entrada → mostra o valor cru. */
  valueLabels?: Partial<Record<V, string>>;
  default: V;
};

export type AdminFlagDef = BooleanFlagDef | EnumFlagDef;

export const ADMIN_FLAGS = [
  {
    key: "enableOverUnderExtraLines",
    kind: "boolean",
    label: "Linhas extras de over/under",
    description:
      "Liga as linhas 1.5 e 3.5 de over/under (cartucho multi-linha over_under_v3.0) onde há cobertura de alternate_totals. Desligada, a análise usa só a linha 2.5.",
    default: false,
    costNote:
      "Sem chamada extra de LLM; usa odds de alternate_totals da The Odds API.",
  },
  {
    key: "enableBestBetFanOut",
    kind: "boolean",
    label: "Melhor aposta do jogo (fan-out)",
    description:
      "Mostra pra todos os usuários a opção \"Analisar todos os mercados\" onde há 2 ou mais mercados candidatos: uma análise por mercado, ranqueadas por edge.",
    default: false,
    costNote:
      "Cada uso faz até 6 chamadas pagas de LLM (uma por mercado) e até 4 buscas extras de odds.",
  },
  {
    key: "enableClvCapture",
    kind: "boolean",
    label: "Captura da closing line (CLV)",
    description:
      "O cron capture-closing-odds busca as odds perto do kickoff dos jogos com palpite non-pass, pra calcular o CLV. A exibição do CLV não depende desta flag.",
    default: false,
    costNote: "Gasta quota da The Odds API (free tier: 500 req/mês).",
  },
  {
    key: "enableFidelityValidation",
    kind: "boolean",
    label: "Validação de fidelidade",
    description:
      "Checa por regras se as contagens citadas na manchete (H2H, gols) contradizem os fatos pré-contados; se contradizem, o palpite é descartado em vez de sair errado.",
    default: true,
    costNote:
      "Custo praticamente zero: regex e comparação de inteiros, sem chamada de LLM.",
  },
  {
    key: "enableKellyStaking",
    kind: "boolean",
    label: "Staking quarter-Kelly",
    description:
      "Permite trocar as bandas de stake (ADR 0019) pelo quarter-Kelly, mas só quando o gate do Kelly em /admin/calibration estiver pronto. Desligada, usa as bandas sempre.",
    default: true,
  },
] as const satisfies readonly AdminFlagDef[];

type RegistryEntry = (typeof ADMIN_FLAGS)[number];

export type AdminFlagKey = RegistryEntry["key"];

/** Tipo do valor de uma entrada: boolean ou a união dos valores do enum. */
export type FlagValueOf<D extends AdminFlagDef> = D extends { kind: "enum" }
  ? D["values"][number]
  : boolean;

export type AdminFlagValues = {
  [K in AdminFlagKey]: FlagValueOf<Extract<RegistryEntry, { key: K }>>;
};

export type AdminFlagValue = AdminFlagValues[AdminFlagKey];

export function getAdminFlagDef(key: AdminFlagKey): AdminFlagDef {
  const def = ADMIN_FLAGS.find((f) => f.key === key);
  // Inalcançável: AdminFlagKey é derivado do próprio registry.
  if (!def) throw new Error(`flag desconhecida: ${key}`);
  return def;
}

/** Defaults do registry (o que vale quando não há row em ai_config). */
export function adminFlagDefaults(): AdminFlagValues {
  return Object.fromEntries(
    ADMIN_FLAGS.map((f) => [f.key, f.default]),
  ) as AdminFlagValues;
}

/**
 * Valor persistido → valor da flag. Valor fora do esperado (enum que encolheu,
 * DB editado na mão) cai no default, espelhando o fallback de getGenerationParams.
 */
export function coerceStoredFlagValue(
  def: AdminFlagDef,
  stored: unknown,
): boolean | string {
  if (def.kind === "boolean") {
    return typeof stored === "boolean" ? stored : def.default;
  }
  return typeof stored === "string" &&
    (def.values as readonly string[]).includes(stored)
    ? stored
    : def.default;
}

/** Schema Zod do valor vindo do form (FormData = string) pra uma entrada. */
export function flagValueSchema(def: AdminFlagDef) {
  if (def.kind === "boolean") {
    return z.enum(["true", "false"]).transform((v) => v === "true");
  }
  return z.enum(def.values);
}

export type AdminFlagInputValidation<K extends string = AdminFlagKey> =
  | { ok: true; key: K; value: boolean | string }
  | { ok: false; error: string };

/**
 * Valida o input do Server Action (pura, pra teste): a key tem que estar no
 * registry e o valor tem que casar com o kind (boolean: "true"/"false"; enum: um
 * dos valores permitidos). Qualquer outra coisa é recusada. `flags` é parâmetro só
 * pra teste poder exercitar uma entrada enum fictícia.
 */
export function validateAdminFlagInput<
  const F extends readonly AdminFlagDef[] = typeof ADMIN_FLAGS,
>(
  input: { key: unknown; value: unknown },
  flags: F = ADMIN_FLAGS as unknown as F,
): AdminFlagInputValidation<F[number]["key"]> {
  const key = z.string().safeParse(input.key);
  const def = key.success ? flags.find((f) => f.key === key.data) : undefined;
  if (!def) return { ok: false, error: "Flag desconhecida." };

  const value = flagValueSchema(def).safeParse(input.value);
  if (!value.success) return { ok: false, error: "Valor inválido pra flag." };

  return { ok: true, key: def.key as F[number]["key"], value: value.data };
}
