import { and, eq } from "drizzle-orm";

import { authenticators } from "@/db/schema";
import { db } from "@/lib/db";

export type AuthenticatorSummary = {
  credentialID: string;
  credentialDeviceType: string;
  credentialBackedUp: boolean;
  transports: string | null;
};

/**
 * Lista as passkeys (credenciais WebAuthn) de UM usuário pra UI de gerência em
 * `/perfil` (#255). Seleciona só o necessário pra renderizar/identificar a
 * credencial (NÃO traz `credentialPublicKey`/`counter` — irrelevantes pra UI).
 * Redundante com o `listAuthenticatorsByUserId` interno do adapter de propósito:
 * a camada de queries é o padrão do repo e o adapter não expõe um delete público,
 * então a UI lê/apaga pela mesma porta tipada.
 */
export async function listAuthenticatorsByUserId(
  userId: string,
): Promise<AuthenticatorSummary[]> {
  return db
    .select({
      credentialID: authenticators.credentialID,
      credentialDeviceType: authenticators.credentialDeviceType,
      credentialBackedUp: authenticators.credentialBackedUp,
      transports: authenticators.transports,
    })
    .from(authenticators)
    .where(eq(authenticators.userId, userId));
}

/**
 * Remove UMA passkey de UM usuário. O gate de dono mora em DUAS camadas: o
 * filtro aqui exige `userId` E `credentialID` (um usuário não apaga a credencial
 * de outro nem adivinhando o `credentialID`), e a server action chamadora
 * (`app/actions/profile.ts → removePasskey`) tira o `userId` da sessão (`auth()`),
 * nunca do form. Retorna a contagem de rows apagadas pra a action distinguir
 * "removido" de "nada combinou" (credencial inexistente ou de outro dono).
 */
export async function deleteAuthenticator(
  userId: string,
  credentialID: string,
): Promise<number> {
  const deleted = await db
    .delete(authenticators)
    .where(
      and(
        eq(authenticators.userId, userId),
        eq(authenticators.credentialID, credentialID),
      ),
    )
    .returning({ credentialID: authenticators.credentialID });
  return deleted.length;
}
