import { z } from "zod";

// Tipos e schemas do painel "Chances do azarão" (#671, ADR 0072). As colunas jsonb de
// `underdog_views` são tipadas por `$type<>`, mas o Postgres não garante a forma: toda
// leitura passa por estes schemas (row inválida → omitida com log).

export const UNDERDOG_SIDES = ["home", "away"] as const;
export type UnderdogSide = (typeof UNDERDOG_SIDES)[number];

const pp = z.number().finite().min(0).max(100);

// Chances em pontos percentuais (1 casa), do ponto de vista do azarão.
export const UnderdogChancesSchema = z.object({
  underdog: pp,
  draw: pp,
  favorite: pp,
});
export type UnderdogChances = z.infer<typeof UnderdogChancesSchema>;

// Placar final (mandante × visitante) e a chance dele, em pp com 1 casa.
export const UnderdogScorelineSchema = z.object({
  home: z.number().int().nonnegative(),
  away: z.number().int().nonnegative(),
  pct: pp,
});
export type UnderdogScoreline = z.infer<typeof UnderdogScorelineSchema>;

export const SCENARIO_IDS = ["lead_30", "red_60", "absences_max"] as const;
export type UnderdogScenarioId = (typeof SCENARIO_IDS)[number];

export const UnderdogScenarioSchema = z.object({
  id: z.enum(SCENARIO_IDS),
  beforePct: pp,
  afterPct: pp,
});
export type UnderdogScenario = z.infer<typeof UnderdogScenarioSchema>;

const FORM_RESULTS = ["W", "D", "L"] as const;
export type FormResult = (typeof FORM_RESULTS)[number];

export const JEV_SIGNAL_FACTORS = [
  "attack_weakened",
  "defense_weakened",
  "rotation_risk",
  "high_stakes",
] as const;
export type JevSignalFactor = (typeof JEV_SIGNAL_FACTORS)[number];

// Sinais a favor do azarão, estruturados (o texto da tela sai do view mapper com os
// nomes de exibição). `jev` é do modelo (já está na chance); o resto é dado.
export const UnderdogSignalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("h2h"),
    games: z.number().int().positive(),
    underdogWins: z.number().int().nonnegative(),
    favoriteWins: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("form"),
    underdog: z.array(z.enum(FORM_RESULTS)).max(10),
    favorite: z.array(z.enum(FORM_RESULTS)).max(10),
  }),
  z.object({
    kind: z.literal("absences"),
    favorite: z.number().int().nonnegative(),
    underdog: z.number().int().nonnegative(),
  }),
  z.object({ kind: z.literal("jev"), factor: z.enum(JEV_SIGNAL_FACTORS) }),
]);
export type UnderdogSignal = z.infer<typeof UnderdogSignalSchema>;

export const UnderdogModelInfoSchema = z.object({
  source: z.enum(["dixon_coles", "heuristic"]),
  jevApplied: z.boolean(),
});
export type UnderdogModelInfo = z.infer<typeof UnderdogModelInfoSchema>;

// Os números do painel congelados na row: o texto e os números batem ao reabrir.
export const UnderdogFactsSchema = z.object({
  side: z.enum(UNDERDOG_SIDES),
  chances: UnderdogChancesSchema,
  scorelines: z.array(UnderdogScorelineSchema).max(3),
  scenarios: z.array(UnderdogScenarioSchema).max(3),
  signals: z.array(UnderdogSignalSchema).max(10),
  model: UnderdogModelInfoSchema,
});
export type UnderdogFacts = z.infer<typeof UnderdogFactsSchema>;

export const UNDERDOG_VERDICTS = ["apoiada", "exagerada", "sem_base"] as const;
export type UnderdogVerdict = (typeof UNDERDOG_VERDICTS)[number];

export const NARRATIVE_SOURCES = ["llm", "template"] as const;
export type UnderdogNarrativeSource = (typeof NARRATIVE_SOURCES)[number];

// O texto que foi à tela: as frases que sobreviveram (com os fatos citados e o
// veredito do revisor; null no template), o contraponto, quantas frases foram cortadas
// e a distribuição dos vereditos (log, ADR 0072 §5).
export const UnderdogNarrativeSchema = z.object({
  sentences: z
    .array(
      z.object({
        text: z.string().min(1).max(400),
        facts: z.array(z.string()).max(3),
        verdict: z.enum(["apoiada", "exagerada"]).nullable(),
      })
    )
    .min(1)
    .max(6),
  counterpoint: z.string().min(1).max(400),
  counterpointSource: z.enum(NARRATIVE_SOURCES),
  cut: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  verdicts: z
    .object({
      apoiada: z.number().int().nonnegative(),
      exagerada: z.number().int().nonnegative(),
      sem_base: z.number().int().nonnegative(),
    })
    .nullable(),
  // Família do modelo que escreveu (Opus, Sonnet, Haiku); null no template.
  advocateFamily: z.string().max(40).nullable(),
});
export type UnderdogNarrative = z.infer<typeof UnderdogNarrativeSchema>;

export const UnderdogVersionsSchema = z.object({
  calc: z.string(),
  advocate: z.string(),
  review: z.string(),
  matchModel: z.string(),
});
export type UnderdogVersions = z.infer<typeof UnderdogVersionsSchema>;
