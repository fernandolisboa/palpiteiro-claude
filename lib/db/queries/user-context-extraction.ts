import { and, desc, eq, sql } from "drizzle-orm";

import { aiCalls } from "@/db/schema";
import { db } from "@/lib/db";

// Reaproveitamento da extração do contexto extra (#668). O texto que a pessoa escreveu
// vai cru na mensagem da extração, e o ai_calls já grava o pedido e a resposta do
// provedor. Mesma pessoa, mesmo jogo, mesma versão do prompt e a MESMA mensagem (texto
// normalizado + times) → a última chamada ok responde de novo, sem outra Haiku. Nada
// novo é gravado (sem hash nem coluna).
//
// O caminho no jsonb é o do pedido Anthropic (lib/ai/providers/anthropic/request-builder:
// `messages: [{ role: "user", content: <mensagem> }]`). Por isso o filtro de provider:
// row de outro provedor nunca casa e a extração roda do zero.

export type StoredExtractionCall = {
  id: string;
  outputPayload: unknown;
};

export async function findLatestExtractionCall(args: {
  userId: string;
  matchId: string;
  promptVersion: string;
  userMessage: string;
}): Promise<StoredExtractionCall | null> {
  const [row] = await db
    .select({ id: aiCalls.id, outputPayload: aiCalls.outputPayload })
    .from(aiCalls)
    .where(
      and(
        eq(aiCalls.userId, args.userId),
        eq(aiCalls.matchId, args.matchId),
        eq(aiCalls.promptVersion, args.promptVersion),
        eq(aiCalls.status, "ok"),
        eq(aiCalls.provider, "anthropic"),
        sql`${aiCalls.inputPayload} -> 'messages' -> 0 ->> 'content' = ${args.userMessage}`,
      ),
    )
    .orderBy(desc(aiCalls.createdAt), desc(aiCalls.id))
    .limit(1);
  return row ?? null;
}
