import { z } from "zod";

import { envelope } from "@/lib/providers/sports-data/api-football/schemas";

// Resposta do /odds da api-football. As odds vêm como STRING no fio ("8.20") — o
// adapter faz Number.parseFloat. `update` (timestamp por aposta) é opcional: sua
// presença NÃO foi confirmada pro bet=10 (liga pausada) → fallback no adapter.
// Só o fixture.id é load-bearing aqui (join com a metadata de fixture pra times +
// data); o schema é tolerante (Zod descarta chaves extras do fio).
const OddsValueSchema = z.object({
  value: z.string(), // "2:1" / "Any Other Score" — resolveSelectionKey decide
  odd: z.string(), // STRING no fio → number no DTO
});

const OddsBetSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  values: z.array(OddsValueSchema),
});

const OddsBookmakerSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  bets: z.array(OddsBetSchema),
});

export const OddsItemSchema = z.object({
  fixture: z.object({ id: z.number().int() }),
  update: z.string().optional(),
  bookmakers: z.array(OddsBookmakerSchema),
});

export type ApiFootballOddsItem = z.infer<typeof OddsItemSchema>;

export const OddsEnvelopeSchema = envelope(OddsItemSchema);
