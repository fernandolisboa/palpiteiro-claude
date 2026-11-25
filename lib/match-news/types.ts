import { z } from "zod";

import { JUDGMENT_QUESTION_IDS } from "@/lib/ai/judgments/questions";
import type { JudgmentQuestionId } from "@/lib/ai/judgments/types";
import {
  CLAIM_DIRECTIONS,
  CLAIM_ROLES,
  CLAIM_SCOPES,
  CLAIM_STATUSES,
  CLAIM_TEAMS,
  CLAIM_TOPICS,
  ClaimSchema,
  MAX_CLAIMS,
  OTHER_KINDS,
  SIGNAL_STRENGTHS,
  type Claim,
  type StoredContextClaim,
  type UserEvidence,
} from "@/lib/user-palpite/types";

// Tipos e schemas das notícias do jogo (#672, PLAN-672 §2). Módulo só de Zod e tipos
// (o schema do banco importa daqui). Toda leitura de jsonb de `match_news_batches` e de
// `judgments.news` passa por estes schemas: o Postgres não garante a forma.

// ─── Afirmação extraída das notícias ────────────────────────────────────────

// Id de uma notícia dentro do lote ("N1".."N10"), na ordem do ranking do ge.
export const NEWS_REF_RE = /^N(?:[1-9]|10)$/;
export const NewsSourcesSchema = z.array(z.string().regex(NEWS_REF_RE)).min(1).max(3);

// A afirmação do contexto extra (o MESMO ClaimSchema, com o superRefine) + as notícias
// que a sustentam. `text` e `players` ficam SÓ no lote (auditoria): nunca vão a outro
// LLM nem à tela.
export type NewsClaim = Claim & { sources: string[] };

export const NewsClaimSchema: z.ZodType<NewsClaim> = ClaimSchema.safeExtend({
  sources: NewsSourcesSchema,
});

// ─── Lote ───────────────────────────────────────────────────────────────────

export const MATCH_NEWS_BATCH_STATUSES = ["ok", "empty", "failed"] as const;
export type MatchNewsBatchStatus = (typeof MATCH_NEWS_BATCH_STATUSES)[number];

export const MATCH_NEWS_SOURCES = ["ge"] as const;
export type MatchNewsSource = (typeof MATCH_NEWS_SOURCES)[number];

export const MATCH_NEWS_FEED_SIDES = ["home", "away"] as const;
export type MatchNewsFeedSide = (typeof MATCH_NEWS_FEED_SIDES)[number];

// Item do lote, na ordem do ranking (ref = posição). Sem o trecho: ele mora em
// `match_news.snippet` (uso interno).
export const MatchNewsBatchItemSchema = z.object({
  ref: z.string().regex(NEWS_REF_RE),
  newsId: z.string(),
  url: z.string(),
  title: z.string(),
  publishedAt: z.string(),
});
export type MatchNewsBatchItem = z.infer<typeof MatchNewsBatchItemSchema>;

// Row de `match_news_batches` validada.
export const StoredNewsBatchSchema = z.object({
  id: z.string(),
  matchId: z.string(),
  batchHash: z.string(),
  promptVersion: z.string(),
  items: z.array(MatchNewsBatchItemSchema).max(10),
  status: z.enum(MATCH_NEWS_BATCH_STATUSES),
  claims: z.array(NewsClaimSchema).max(MAX_CLAIMS),
  warnings: z.array(z.string()),
  attempts: z.number().int().positive(),
  partial: z.boolean(),
  unknownOpponent: z.boolean(),
  aiCallId: z.string().nullable(),
  createdAt: z.date(),
  checkedAt: z.date(),
  // Quando ficou usável (ok/empty), no relógio do run. null = failed (ou row anterior à
  // coluna: quem lê cai no createdAt).
  usableAt: z.date().nullable(),
});
export type StoredNewsBatch = z.infer<typeof StoredNewsBatchSchema>;

// ─── O que a base guarda (judgments.news) ───────────────────────────────────

// Afirmação conferida SEM texto livre e SEM nome de jogador (StoredContextClaim) + as
// notícias que a sustentam.
export type StoredNewsClaim = StoredContextClaim & { sources: string[] };

export type MatchModelNews = {
  batchId: string;
  // N: notícias do lote lidas (na janela).
  itemsRead: number;
  claims: StoredNewsClaim[];
  // Só as notícias citadas por alguma afirmação aplicada.
  sources: { ref: string; url: string; title: string }[];
  // Nouls que entraram no combine (JEV ∨ isto = o que a base aplicou).
  evidence: UserEvidence;
  // Fatores que a notícia moveu acima do JEV.
  moved: JudgmentQuestionId[];
  // Linhas montadas pelo código (motivação, troca de técnico), sem efeito no número.
  notes: string[];
  versions: { extract: string; newsEvidence: string };
};

const questionIdSchema = z.enum(
  JUDGMENT_QUESTION_IDS as [JudgmentQuestionId, ...JudgmentQuestionId[]],
);
const sideSchema = z.enum(["home", "away"]);

export const StoredNewsClaimSchema: z.ZodType<StoredNewsClaim> = z.object({
  team: z.enum(CLAIM_TEAMS),
  topic: z.enum(CLAIM_TOPICS),
  role: z.enum(CLAIM_ROLES).optional(),
  direction: z.enum(CLAIM_DIRECTIONS).optional(),
  scope: z.enum(CLAIM_SCOPES).optional(),
  otherKind: z.enum(OTHER_KINDS).optional(),
  playersCount: z.number().int().nonnegative().optional(),
  index: z.number().int().nonnegative(),
  status: z.enum(CLAIM_STATUSES),
  evidence: z.string(),
  sides: z.array(z.object({ side: sideSchema, status: z.enum(CLAIM_STATUSES) })),
  playerChecks: z.array(
    z.object({ status: z.enum(CLAIM_STATUSES), questionId: questionIdSchema.nullable() }),
  ),
  signals: z.array(
    z.object({ questionId: questionIdSchema, strength: z.enum(SIGNAL_STRENGTHS) }),
  ),
  sources: z.array(z.string()),
});

export const MatchModelNewsSchema: z.ZodType<MatchModelNews> = z.object({
  batchId: z.string(),
  itemsRead: z.number().int().nonnegative(),
  claims: z.array(StoredNewsClaimSchema).max(MAX_CLAIMS),
  sources: z.array(z.object({ ref: z.string(), url: z.string(), title: z.string() })),
  evidence: z.partialRecord(questionIdSchema, z.number()),
  moved: z.array(questionIdSchema),
  notes: z.array(z.string()),
  versions: z.object({ extract: z.string(), newsEvidence: z.string() }),
});
