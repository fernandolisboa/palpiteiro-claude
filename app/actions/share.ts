"use server";

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
  return { ok: true, path };
}
