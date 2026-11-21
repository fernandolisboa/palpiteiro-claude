import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { underdogViews } from "@/db/schema";
import { db } from "@/lib/db";
import {
  NARRATIVE_SOURCES,
  UNDERDOG_SIDES,
  UnderdogFactsSchema,
  UnderdogNarrativeSchema,
  UnderdogVersionsSchema,
  type UnderdogFacts,
  type UnderdogNarrative,
  type UnderdogNarrativeSource,
  type UnderdogSide,
  type UnderdogVersions,
} from "@/lib/underdog/types";

// Fronteira ÚNICA de `underdog_views` (#671, ADR 0072). Insert (com dedupe da corrida por
// (user, base)), troca da row da MESMA base quando ela ficou velha (versão do cálculo) ou
// inválida, e leitura da mais recente do usuário no jogo. Toda escrita valida antes de
// gravar e toda leitura passa pelo Zod; row inválida → omitida com log, nunca derruba a
// página.

export type NewUnderdogView = typeof underdogViews.$inferInsert;

export type UnderdogViewRecord = {
  id: string;
  matchId: string;
  modelSnapshotId: string;
  createdAt: Date;
  side: UnderdogSide;
  facts: UnderdogFacts;
  narrative: UnderdogNarrative;
  narrativeSource: UnderdogNarrativeSource;
  versions: UnderdogVersions;
};

const recordSchema = z.object({
  id: z.string(),
  matchId: z.string(),
  modelSnapshotId: z.string(),
  createdAt: z.date(),
  side: z.enum(UNDERDOG_SIDES),
  facts: UnderdogFactsSchema,
  narrative: UnderdogNarrativeSchema,
  narrativeSource: z.enum(NARRATIVE_SOURCES),
  versions: UnderdogVersionsSchema,
});

const t = underdogViews;
const columns = {
  id: t.id,
  matchId: t.matchId,
  modelSnapshotId: t.modelSnapshotId,
  createdAt: t.createdAt,
  side: t.underdogSide,
  facts: t.facts,
  narrative: t.narrative,
  narrativeSource: t.narrativeSource,
  versions: t.versions,
};

function parseRow(row: Record<string, unknown>): UnderdogViewRecord | null {
  const parsed = recordSchema.safeParse(row);
  if (parsed.success) return parsed.data;
  console.error(
    JSON.stringify({
      scope: "underdog_views",
      error: "invalid_underdog_view_row",
      id: row.id,
      issues: parsed.error.issues.slice(0, 5).map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    })
  );
  return null;
}

/**
 * Existe row do usuário nesta base? `record` null = existe, mas falhou no Zod. A action
 * usa isto ANTES de cobrar: row existente que não vale é trocada (replace), nunca vira
 * um insert que bate no UNIQUE e devolve a velha depois da cobrança.
 */
export async function findUnderdogViewForSnapshot(
  userId: string,
  modelSnapshotId: string
): Promise<{ record: UnderdogViewRecord | null } | null> {
  const [row] = await db
    .select(columns)
    .from(t)
    .where(and(eq(t.userId, userId), eq(t.modelSnapshotId, modelSnapshotId)))
    .limit(1);
  return row ? { record: parseRow(row) } : null;
}

const writableSchema = z.object({
  underdogSide: z.enum(UNDERDOG_SIDES),
  facts: UnderdogFactsSchema,
  narrative: UnderdogNarrativeSchema,
  narrativeSource: z.enum(NARRATIVE_SOURCES),
  versions: UnderdogVersionsSchema,
});

/** Grava só o que a leitura aceita: row que não releria nunca chega ao banco. */
function assertWritable(row: NewUnderdogView): void {
  const parsed = writableSchema.safeParse(row);
  if (!parsed.success) {
    throw new Error(
      `underdog_views: row inválida (${parsed.error.issues
        .slice(0, 3)
        .map((i) => i.path.join("."))
        .join(", ")})`
    );
  }
}

/** A row do usuário nesta base; null sem row ou com row inválida. */
export async function getUnderdogViewForSnapshot(
  userId: string,
  modelSnapshotId: string
): Promise<UnderdogViewRecord | null> {
  const [row] = await db
    .select(columns)
    .from(t)
    .where(and(eq(t.userId, userId), eq(t.modelSnapshotId, modelSnapshotId)))
    .limit(1);
  return row ? parseRow(row) : null;
}

/**
 * Grava o painel. Dois cliques na mesma base: ON CONFLICT DO NOTHING e relê a row que
 * ficou (a outra aba ganhou). null só se a releitura falhar no Zod.
 */
export async function insertUnderdogView(
  row: NewUnderdogView
): Promise<UnderdogViewRecord | null> {
  assertWritable(row);
  const [inserted] = await db
    .insert(t)
    .values(row)
    .onConflictDoNothing({ target: [t.userId, t.modelSnapshotId] })
    .returning(columns);
  if (inserted) return parseRow(inserted);
  return getUnderdogViewForSnapshot(row.userId, row.modelSnapshotId);
}

/**
 * Troca a row do usuário nesta base (ou grava, se não houver): a row velha (outra versão
 * do cálculo, números que não batem mais) ou inválida dá lugar ao texto recém-pago.
 */
export async function replaceUnderdogView(
  row: NewUnderdogView
): Promise<UnderdogViewRecord | null> {
  assertWritable(row);
  const [saved] = await db
    .insert(t)
    .values(row)
    .onConflictDoUpdate({
      target: [t.userId, t.modelSnapshotId],
      set: {
        matchId: row.matchId,
        underdogSide: row.underdogSide,
        facts: row.facts,
        narrative: row.narrative,
        narrativeSource: row.narrativeSource,
        versions: row.versions,
        advocateAiCallId: row.advocateAiCallId ?? null,
        reviewerAiCallId: row.reviewerAiCallId ?? null,
        createdAt: row.createdAt ?? new Date(),
      },
    })
    .returning(columns);
  return saved ? parseRow(saved) : null;
}

/**
 * A row mais recente do usuário neste jogo, de qualquer base (a página decide se ela
 * ainda vale pela materialidade). Pula rows inválidas (lê as 3 mais recentes).
 */
export async function getLatestUnderdogView(
  userId: string,
  matchId: string
): Promise<UnderdogViewRecord | null> {
  const rows = await db
    .select(columns)
    .from(t)
    .where(and(eq(t.userId, userId), eq(t.matchId, matchId)))
    .orderBy(desc(t.createdAt))
    .limit(3);
  for (const row of rows) {
    const parsed = parseRow(row);
    if (parsed) return parsed;
  }
  return null;
}
