import { eq } from "drizzle-orm";

import { users } from "@/db/schema";
import { db } from "@/lib/db";

/**
 * True se existe uma row em `users` com este id. Sob sessão JWT o `token.id` é
 * carimbado no login e nunca revalidado contra o DB; se a row do usuário for
 * deletada/recriada depois (ex.: reset + claim-admin), o cookie segue apontando
 * pra um id que não existe mais. Usado pra recusar a sessão órfã ANTES de gastar
 * uma chamada paga ao Anthropic (FK `ai_calls_user_id_users_id_fk` falharia de
 * qualquer forma, mas só depois do custo).
 */
export async function userExists(id: string): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return rows.length > 0;
}
