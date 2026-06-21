import { z } from "zod";

// Boundary de input NOVO (ADR 0034 §7): o ÚNICO ponto onde uma aposta PINNED
// submetida pelo usuário entra no motor de valor. Módulo SEM "use server" —
// importável tanto pelo client (o form) quanto pelo server (a action). NÃO valida
// mercado∈audiência∩liga nem seleção∈selectionKeys (isso exige match.league +
// isAdmin async → vive na action); aqui é só a forma + o parse PT-BR + odd > 1.

/**
 * Parse PT-BR de odd decimal: vírgula → ponto ANTES do parse ('1,85' → 1.85).
 * O repo NÃO tinha parse PT-BR (grep confirmou) — é net-new. Number.parseFloat
 * tolera lixo à direita ('1,85x' → 1.85), mas o `.pipe(z.number().finite().gt(1))`
 * rejeita NaN/≤1 logo em seguida, então a fronteira fica fail-closed.
 */
export function parsePtBrOdd(raw: string): number {
  return Number.parseFloat(raw.replace(",", "."));
}

/**
 * Schema da aposta pinned. `line` é z.coerce.number() porque FormData entrega
 * string ('2.5') e o cache filtra contra o number do jsonb (marketParams.line) —
 * sem coerce, '2.5' !== 2.5 daria MISS espúrio → predict() PAGO (blocker). `odd`
 * é parseada (vírgula PT-BR) e só então exigida finita > 1: assertValidOdd LANÇA
 * para odd ≤ 1, então nenhuma odd não-validada pode chegar às primitivas puras.
 */
export const GradeMyBetInputSchema = z.object({
  marketKey: z.string().min(1),
  selectionKey: z.string().min(1),
  line: z.coerce.number().optional(),
  odd: z
    .string()
    .transform(parsePtBrOdd)
    .pipe(z.number().finite().gt(1)),
});

export type GradeMyBetInput = z.infer<typeof GradeMyBetInputSchema>;
