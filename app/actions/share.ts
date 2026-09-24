"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/auth";
import {
  getPalpiteSetOwner,
  setPalpiteSetSharedAt,
} from "@/lib/db/queries/palpites";

export type ShareSetResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

const idSchema = z.string().uuid();

/**
 * shareSet (ADR 0035 §7 / #384): o gesto opt-in de compartilhar. Carimba `shared_at` do set
 * (tornando-o resolvível em /p/[id]) — ownership-gated, idempotente (skip-not-restamp).
 *
 * Chamado IMPERATIVAMENTE (string id, não FormData/useActionState) pelo ShareButton.
 *
 * AUTORIZAÇÃO (privacy MAJOR 5):
 *   - sem sessão → erro;
 *   - id não-UUID → erro ANTES da query (evita 22P02=500);
 *   - set inexistente (null) OU dono ≠ sessão → UM erro OPACO (colapsa 404/403): erros
 *     distintos seriam um oráculo de existência cross-user (um atacante autenticado iterando
 *     setIds aprenderia quais UUIDs são sets reais de OUTRO usuário). Ownership da ROW vs
 *     sessão, NUNCA do input do cliente;
 *   - já compartilhado (shared_at set) → ok SEM re-carimbar (não move shared_at a cada clique);
 *   - dono + ainda-não-compartilhado → carimba + ok.
 */
export async function shareSet(setId: string): Promise<ShareSetResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Sessão inválida." };
  }

  if (!idSchema.safeParse(setId).success) {
    return { ok: false, error: "Palpite inválido." };
  }

  const set = await getPalpiteSetOwner(setId);
  // COLAPSA 404 (sem row) e 403 (dono errado) num único erro opaco — fecha o oráculo.
  if (!set || set.userId !== session.user.id) {
    return { ok: false, error: "Não foi possível compartilhar este palpite." };
  }

  const path = `/p/${setId}`;
  // Skip-not-restamp: já compartilhado → devolve o path sem mover shared_at.
  if (set.sharedAt) {
    return { ok: true, path };
  }

  await setPalpiteSetSharedAt(setId, new Date());
  // Purga uma cópia ISR stale do /p (ex.: 404 cacheado de um unshare anterior → re-share).
  revalidateSharedPaths(setId);
  return { ok: true, path };
}

export type UnshareSetResult = { ok: true } | { ok: false; error: string };

/**
 * unshareSet (ADR 0035 §3e / #438): o KILL-SWITCH do compartilhamento. Limpa `shared_at`
 * (o set volta a privado → a query gateada do /p devolve null → 404) e purga a cópia ISR
 * da página e da imagem OG via revalidatePath.
 *
 * AUTORIZAÇÃO: ESPELHA shareSet exatamente — sessão via auth(), UUID antes da query, e
 * set inexistente OU dono ≠ sessão colapsados num erro OPACO (sem oráculo de existência,
 * sem IDOR: ownership da ROW vs sessão, nunca do input do cliente).
 *
 * Idempotente: já-privado (shared_at NULL) → ok sem escrita.
 *
 * LIMITE CONHECIDO (irrevogável por nós): unfurls de OG já raspados (WhatsApp, X, Telegram,
 * Slack…) ficam no cache DO SCRAPER — título/imagem continuam visíveis na conversa onde o
 * link foi colado até o scraper expirar. O clique no link, porém, cai no 404.
 */
export async function unshareSet(setId: string): Promise<UnshareSetResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Sessão inválida." };
  }

  if (!idSchema.safeParse(setId).success) {
    return { ok: false, error: "Palpite inválido." };
  }

  const set = await getPalpiteSetOwner(setId);
  // COLAPSA 404 e 403 num único erro opaco — mesmo contrato do shareSet.
  if (!set || set.userId !== session.user.id) {
    return {
      ok: false,
      error: "Não foi possível parar de compartilhar este palpite.",
    };
  }

  if (set.sharedAt) {
    await setPalpiteSetSharedAt(setId, null);
  }
  // Revalida mesmo no caminho idempotente: barato, e cobre um clear feito fora da action.
  revalidateSharedPaths(setId);
  return { ok: true };
}

// A página E a sub-rota OG têm cópia ISR própria (revalidate 24h) — purgar as duas.
function revalidateSharedPaths(setId: string): void {
  revalidatePath(`/p/${setId}`);
  revalidatePath(`/p/${setId}/opengraph-image`);
}
