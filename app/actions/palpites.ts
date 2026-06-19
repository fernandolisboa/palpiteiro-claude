"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/auth";
import { generatePalpites, PalpiteError } from "@/lib/ai/palpites";
import { getPalpiteSetsForMatch } from "@/lib/db/queries/palpites";
import { checkPalpitesRateLimit } from "@/lib/rate-limit";

// ─── Gate comum ───────────────────────────────────────────────────────────────

type Gate =
  | { ok: false; error: "id" | "login" | "rate" }
  | { ok: true; userId: string };

/**
 * Gate dos palpites (#315, ADR 0028 §1). BYPASS DELIBERADO de getUserAccessState/
 * isEmailAllowed/isModelAllowedForAudience — palpite é UNIVERSAL e disjunto da
 * análise paga. Só exige `auth()` (a FK ai_calls.userId precisa de um user real) +
 * o rate-limit do bucket próprio (`ratelimit:palpites`, fail-open sem KV).
 */
async function gatePalpite(matchId: string): Promise<Gate> {
  if (!z.uuid().safeParse(matchId).success) {
    return { ok: false, error: "id" };
  }
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "login" };
  }
  const rl = await checkPalpitesRateLimit(session.user.id);
  if (!rl.ok) {
    return { ok: false, error: "rate" };
  }
  return { ok: true, userId: session.user.id };
}

// ─── Auto-run idempotente (falha SILENCIOSA, fire-and-forget) ─────────────────

/**
 * Auto-geração de palpites na entrada da página do jogo (#315). SEMPRE retorna
 * `{ ok: true }` (fire-and-forget): qualquer bloqueio/erro é engolido — o erro de
 * verdade já vive em `ai_calls.status != "ok"` (persistAiCallError), nunca na UI.
 *
 * GUARD DE IDEMPOTÊNCIA antes de gastar token: se já existe um set p/ (match,user),
 * é no-op (0 gasto de Haiku). O guard server é o REAL; o useRef do PalpiteAutoRun
 * (#316/cliente) só evita o double-fire do StrictMode.
 */
export async function generatePalpitesAction(
  matchId: string,
): Promise<{ ok: true }> {
  try {
    const gate = await gatePalpite(matchId);
    if (!gate.ok) return { ok: true };
    const previousSets = await getPalpiteSetsForMatch(matchId, gate.userId);
    if (previousSets.length > 0) return { ok: true }; // já existe → no-op
    await generatePalpites({
      matchId,
      userId: gate.userId,
      previousSets: [], // 1ª geração: sem exclusão
      modelOverride: "claude-haiku-4-5",
    });
    revalidatePath(`/match/${matchId}`); // #316 lê o set novo no próximo render
    return { ok: true };
  } catch (err) {
    // FALHA SILENCIOSA (ADR 0028 §5): o erro já foi logado em ai_calls dentro de
    // generatePalpites. Aqui só engolimos p/ a UI nunca ver.
    console.error(
      JSON.stringify({
        scope: "generatePalpitesAction",
        matchId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { ok: true };
  }
}

// ─── Regen sob demanda (ação explícita do usuário, sem repetir) ───────────────

export type RegenResult =
  | { ok: true; setId: string }
  | { ok: false; error: "rate" | "not_found" | "generation_error" };

/**
 * Regen explícito (#315): gera um set NOVO passando os anteriores como contexto de
 * exclusão (sem repetir placares/ideias). NÃO tem o guard de idempotência (o ponto
 * é gerar de novo). MANTÉM o rate-limit (regen gasta token). Retorna uma
 * discriminated union VISÍVEL — o botão que a consome é #316. Cada chamada cria um
 * set novo (sem UNIQUE(matchId,userId); a "repetição" é evitada no PROMPT).
 */
export async function regeneratePalpitesAction(
  matchId: string,
): Promise<RegenResult> {
  const gate = await gatePalpite(matchId);
  if (!gate.ok) {
    // id inválido / sem login também caem em not_found p/ a UI (sem vazar detalhe);
    // o caso de teto explícito é o único distinto (rate).
    return { ok: false, error: gate.error === "rate" ? "rate" : "not_found" };
  }
  try {
    const previousSets = await getPalpiteSetsForMatch(matchId, gate.userId);
    const result = await generatePalpites({
      matchId,
      userId: gate.userId,
      previousSets,
      modelOverride: "claude-haiku-4-5",
    });
    revalidatePath(`/match/${matchId}`);
    return { ok: true, setId: result.palpiteSet.id };
  } catch (err) {
    if (err instanceof PalpiteError && err.message.includes("match not found")) {
      return { ok: false, error: "not_found" };
    }
    console.error(
      JSON.stringify({
        scope: "regeneratePalpitesAction",
        matchId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { ok: false, error: "generation_error" };
  }
}
