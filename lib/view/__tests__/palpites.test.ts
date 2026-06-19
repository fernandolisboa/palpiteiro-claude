import { describe, expect, it } from "vitest";

import type { DbAiCall } from "@/lib/db/queries/predictions";
import type { PalpiteSetWithLines } from "@/lib/db/queries/palpites";
import { toPalpitesView } from "@/lib/view/palpites";

// ─── Factories type-válidas (sem `as`/cast) ──────────────────────────────────

type Line = PalpiteSetWithLines["palpites"][number];

function line(over: Partial<Line> & Pick<Line, "id" | "type">): Line {
  return {
    palpiteSetId: "set-0",
    text: "frase do palpite",
    params: null,
    settleable: false,
    createdAt: new Date("2026-06-01T12:00:00Z"),
    outcome: null,
    ...over,
  };
}

// aiCall POVOADO de propósito: a asserção-chave é que NADA dele (custo/modelo/
// tokens) atravessa pra view. Se o mapper algum dia expusesse, o teste pegaria.
const fullAiCall: DbAiCall = {
  id: "ai-1",
  userId: "user-1",
  matchId: "match-1",
  provider: "anthropic",
  model: "claude-haiku-4-5",
  promptVersion: "palpites_v1",
  inputPayload: { prompt: "…" },
  outputPayload: { lines: [] },
  inputTokens: 1234,
  outputTokens: 567,
  latencyMs: 890,
  costUsd: "0.004200",
  status: "ok",
  errorMessage: null,
  createdAt: new Date("2026-06-01T12:00:00Z"),
};

function set(
  id: string,
  createdAt: string,
  lines: Line[],
  aiCall: DbAiCall | null = fullAiCall,
): PalpiteSetWithLines {
  return {
    palpiteSet: {
      id,
      matchId: "match-1",
      userId: "user-1",
      aiCallId: aiCall?.id ?? null,
      modelVersion: "claude-haiku-4-5",
      promptVersion: "palpites_v2",
      headline: null,
      createdAt: new Date(createdAt),
    },
    aiCall,
    palpites: lines.map((l) => ({ ...l, palpiteSetId: id })),
  };
}

// ─── Estados derivados (PLAN §3) ─────────────────────────────────────────────

describe("toPalpitesView — derivação de estado por linha", () => {
  it("fun: settleable=false (red_card/corners) → { kind: 'fun' }, ignora outcome", () => {
    const v = toPalpitesView([
      set("s1", "2026-06-01T12:00:00Z", [
        line({ id: "l1", type: "red_card", settleable: false }),
        line({ id: "l2", type: "corners", settleable: false }),
        // Defense-in-depth: um fun-only NUNCA devia ter outcome, mas se tivesse,
        // o estado continua fun (settleable é o gate).
        line({
          id: "l3",
          type: "red_card",
          settleable: false,
          outcome: { result: "won" },
        }),
      ]),
    ]);
    expect(v.current?.lines.map((l) => l.state)).toEqual([
      { kind: "fun" },
      { kind: "fun" },
      { kind: "fun" },
    ]);
  });

  it("pending: exact_score settleable sem outcome → { kind: 'pending' }", () => {
    const v = toPalpitesView([
      set("s1", "2026-06-01T12:00:00Z", [
        line({
          id: "l1",
          type: "exact_score",
          settleable: true,
          params: { home: 2, away: 1 },
          outcome: null,
        }),
      ]),
    ]);
    expect(v.current?.lines[0].state).toEqual({ kind: "pending" });
  });

  it("settled won: exact_score com outcome won → { kind: 'settled', result: 'won' }", () => {
    const v = toPalpitesView([
      set("s1", "2026-06-01T12:00:00Z", [
        line({
          id: "l1",
          type: "exact_score",
          settleable: true,
          outcome: { result: "won" },
        }),
      ]),
    ]);
    expect(v.current?.lines[0].state).toEqual({ kind: "settled", result: "won" });
  });

  it("settled lost: exact_score com outcome lost → { kind: 'settled', result: 'lost' }", () => {
    const v = toPalpitesView([
      set("s1", "2026-06-01T12:00:00Z", [
        line({
          id: "l1",
          type: "exact_score",
          settleable: true,
          outcome: { result: "lost" },
        }),
      ]),
    ]);
    expect(v.current?.lines[0].state).toEqual({ kind: "settled", result: "lost" });
  });
});

describe("toPalpitesView — typeLabel e text verbatim", () => {
  it("rotula cada tipo em PT-BR e preserva o text", () => {
    const v = toPalpitesView([
      set("s1", "2026-06-01T12:00:00Z", [
        line({ id: "l1", type: "exact_score", text: "2 a 1 pro mandante" }),
        line({ id: "l2", type: "red_card", text: "vai ter expulsão" }),
        line({ id: "l3", type: "corners", text: "mais de 9 escanteios" }),
      ]),
    ]);
    expect(v.current?.lines.map((l) => [l.typeLabel, l.text])).toEqual([
      ["placar exato", "2 a 1 pro mandante"],
      ["cartão vermelho", "vai ter expulsão"],
      ["escanteios", "mais de 9 escanteios"],
    ]);
  });
});

describe("toPalpitesView — current/previous split", () => {
  it("vazio → { current: null, previous: [] }", () => {
    expect(toPalpitesView([])).toEqual({ current: null, previous: [] });
  });

  it("current = sets[0]; previous = sets.slice(1) (newest-first preservado)", () => {
    const v = toPalpitesView([
      set("novo", "2026-06-03T12:00:00Z", [
        line({ id: "a", type: "exact_score" }),
      ]),
      set("medio", "2026-06-02T12:00:00Z", [
        line({ id: "b", type: "corners" }),
      ]),
      set("antigo", "2026-06-01T12:00:00Z", [
        line({ id: "c", type: "red_card" }),
      ]),
    ]);
    expect(v.current?.id).toBe("novo");
    expect(v.current?.generatedAt).toEqual(new Date("2026-06-03T12:00:00Z"));
    expect(v.previous.map((s) => s.id)).toEqual(["medio", "antigo"]);
  });
});

describe("toPalpitesView — aiCall NUNCA vaza pra view (ADR 0028 §1)", () => {
  it("o JSON serializado da view não contém custo/modelo/tokens do aiCall", () => {
    const v = toPalpitesView([
      set(
        "s1",
        "2026-06-01T12:00:00Z",
        [line({ id: "l1", type: "exact_score", settleable: true })],
        fullAiCall,
      ),
    ]);
    const serialized = JSON.stringify(v);
    // Nenhum sinal de aiCall: custo, contagem de tokens, modelo, latência.
    expect(serialized).not.toContain("costUsd");
    expect(serialized).not.toContain("0.004200");
    expect(serialized).not.toContain("inputTokens");
    expect(serialized).not.toContain("1234");
    expect(serialized).not.toContain("claude-haiku");
    expect(serialized).not.toContain("latencyMs");
    // E estruturalmente: a view não tem chave aiCall em nível algum.
    expect("aiCall" in (v.current ?? {})).toBe(false);
  });
});
