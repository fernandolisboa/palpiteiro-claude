"use server";

import { auth } from "@/auth";
import { setTourState } from "@/lib/db/queries/users";
import { isTourState } from "@/lib/tour/steps";

export type SaveTourStateResult = { ok: boolean };

/**
 * Grava o progresso do tour guiado do usuário da sessão (id vem da sessão, nunca do
 * cliente). Sem `revalidatePath`: o tour só lê o estado ao montar, e revalidar aqui
 * re-renderizaria a página no meio do passo seguinte. O cliente também guarda o
 * valor no aparelho (`mergeTourState`), então uma falha aqui não reabre o tour lá.
 */
export async function saveTourState(state: unknown): Promise<SaveTourStateResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false };
  // Valor vindo do cliente: só aceita o enum (a action é um POST chamável por fora).
  if (!isTourState(state)) return { ok: false };
  await setTourState(session.user.id, state);
  return { ok: true };
}
