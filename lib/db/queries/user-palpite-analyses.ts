import { and, desc, eq } from "drizzle-orm";

import { userPalpiteAnalyses } from "@/db/schema";
import { db } from "@/lib/db";
import {
  NARRATION_SOURCES,
  PALPITE_SOURCES,
  StoredClaimsSchema,
  StoredModelSchema,
  StoredNarrationSchema,
  StoredReadingSchema,
  UserPalpiteSchema,
  type CheckedClaim,
  type NarrationSource,
  type PalpiteSource,
  type StoredNarration,
  type StoredPalpiteModel,
  type StoredReading,
  type UserPalpite,
} from "@/lib/user-palpite/types";
import { z } from "zod";

// Fronteira ÚNICA de `user_palpite_analyses` (#564, ADR 0055). Append-only: só insert e
// leitura da mais recente. Toda leitura passa pelo Zod; row inválida → null com log,
// nunca derruba a página. O `reason_text` não volta na leitura: a página não reexibe o
// texto cru.

export type NewUserPalpiteAnalysis = typeof userPalpiteAnalyses.$inferInsert;

export type UserPalpiteAnalysisRecord = {
  id: string;
  createdAt: Date;
  palpite: UserPalpite;
  palpiteSource: PalpiteSource;
  claims: CheckedClaim[];
  model: StoredPalpiteModel;
  reading: StoredReading;
  narration: StoredNarration;
  narrationSource: NarrationSource;
};

const recordSchema = z.object({
  id: z.string(),
  createdAt: z.date(),
  palpite: UserPalpiteSchema,
  palpiteSource: z.enum(PALPITE_SOURCES),
  claims: StoredClaimsSchema,
  model: StoredModelSchema,
  reading: StoredReadingSchema,
  narration: StoredNarrationSchema,
  narrationSource: z.enum(NARRATION_SOURCES),
});

export async function insertUserPalpiteAnalysis(
  row: NewUserPalpiteAnalysis,
): Promise<string> {
  const [inserted] = await db
    .insert(userPalpiteAnalyses)
    .values(row)
    .returning({ id: userPalpiteAnalyses.id });
  return inserted.id;
}

/** A análise mais recente do usuário neste jogo; null sem análise ou com row inválida. */
export async function getLatestUserPalpiteAnalysis(
  matchId: string,
  userId: string,
): Promise<UserPalpiteAnalysisRecord | null> {
  const t = userPalpiteAnalyses;
  const [row] = await db
    .select({
      id: t.id,
      createdAt: t.createdAt,
      palpite: t.palpite,
      palpiteSource: t.palpiteSource,
      claims: t.claims,
      model: t.model,
      reading: t.reading,
      narration: t.narration,
      narrationSource: t.narrationSource,
    })
    .from(t)
    .where(and(eq(t.matchId, matchId), eq(t.userId, userId)))
    .orderBy(desc(t.createdAt))
    .limit(1);
  if (!row) return null;
  const parsed = recordSchema.safeParse(row);
  if (parsed.success) return parsed.data;
  console.error(
    JSON.stringify({
      scope: "user_palpite_analyses",
      error: "invalid_row",
      analysisId: row.id,
      matchId,
      issues: parsed.error.issues.slice(0, 5).map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    }),
  );
  return null;
}
