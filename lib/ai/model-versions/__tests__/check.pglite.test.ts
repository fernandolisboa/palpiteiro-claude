// @vitest-environment node
//
// Cron check-model-versions (ADR 0062) contra Postgres REAL (pglite) com as migrations
// reais: adoção via db.batch com uma `active` já existente, reprovação, transitório
// (N5), dedup por versão (S3), kill switch, regressão (S2), conferida aposentada (S8),
// e-mail que falha, e as queries do painel. A listagem da API, a sondagem e o e-mail
// são mockados: nenhuma chamada real.
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import * as schema from "@/db/schema";
import type { ApiModelInfo } from "@/lib/ai/providers/anthropic/models-catalog";

// Este arquivo testa a query layer de verdade: desfaz o mock global (vitest.setup.ts).
vi.unmock("@/lib/db/queries/model-versions");

let realDb: PgliteDatabase<typeof schema>;
let client: PGlite;

vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get(_t, prop) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const v = (realDb as any)[prop];
        return typeof v === "function" ? v.bind(realDb) : v;
      },
    },
  ),
}));

vi.mock("@/lib/ai/providers/anthropic/models-catalog", () => ({
  listApiModels: vi.fn(),
}));
vi.mock("@/lib/ai/model-versions/probe", () => ({
  probeModelVersion: vi.fn(),
}));
vi.mock("@/lib/notifications/model-versions-alert", () => ({
  sendModelVersionsAlert: vi.fn(async () => ({ sent: true })),
}));

import { runModelVersionCheck } from "@/lib/ai/model-versions/check";
import { resetActiveModelMemo, resolveActiveModel } from "@/lib/ai/model-versions/active";
import { probeModelVersion } from "@/lib/ai/model-versions/probe";
import { listApiModels } from "@/lib/ai/providers/anthropic/models-catalog";
import {
  confirmModelVersionPrice,
  getActiveModelState,
  getModelVersionsCheck,
  listModelVersions,
  markModelVersionFailed,
  rejectModelVersion,
} from "@/lib/db/queries/model-versions";
import { sendModelVersionsAlert } from "@/lib/notifications/model-versions-alert";

const listMock = vi.mocked(listApiModels);
const probeMock = vi.mocked(probeModelVersion);
const emailMock = vi.mocked(sendModelVersionsAlert);

const CAPS = {
  effort: {
    supported: true,
    low: { supported: true },
    medium: { supported: true },
    high: { supported: true },
    max: { supported: true },
    xhigh: { supported: true },
  },
  thinking: { supported: true, types: { adaptive: { supported: true } } },
} as unknown as ApiModelInfo["capabilities"];

function api(id: string, over: Partial<ApiModelInfo> = {}): ApiModelInfo {
  return {
    id,
    displayName: id,
    createdAt: "2026-11-01T00:00:00Z",
    capabilities: CAPS,
    maxTokens: 128_000,
    ...over,
  };
}

const PINNED = [api("claude-opus-5-5"), api("claude-sonnet-5-5"), api("claude-haiku-5-5")];

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-11-10T08:15:00Z");

async function resetTables(): Promise<void> {
  await realDb.delete(schema.modelVersions);
  await realDb.delete(schema.aiCalls);
  await realDb.delete(schema.aiConfig);
}

beforeAll(async () => {
  client = new PGlite();
  const base = drizzle(client, { schema, casing: "snake_case" });
  // neon-http tem db.batch (transação); o pglite não — shim sequencial.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (base as any).batch = async (qs: unknown[]) => {
    const out: unknown[] = [];
    for (const q of qs) out.push(await q);
    return out;
  };
  realDb = base;
  await migrate(base, { migrationsFolder: "./db/migrations" });
}, 60_000);

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await resetTables();
  resetActiveModelMemo();
  listMock.mockReset();
  probeMock.mockReset();
  emailMock.mockReset();
  emailMock.mockResolvedValue({ sent: true });
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function rowsById() {
  const rows = await listModelVersions();
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

describe("runModelVersionCheck", () => {
  it("sem chave → skipped, sem listar", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(await runModelVersionCheck(T0)).toEqual({ status: "skipped", reason: "no_key" });
    expect(listMock).not.toHaveBeenCalled();
  });

  it("listagem que falha → listing_failed gravado no resumo", async () => {
    listMock.mockRejectedValue(new Error("api fora"));
    const r = await runModelVersionCheck(T0);
    expect(r.status).toBe("listing_failed");
    const check = await getModelVersionsCheck();
    expect(check.checkedAt).toEqual(T0);
    expect(check.summary).toMatchObject({
      status: "listing_failed",
      error: expect.stringContaining("api fora"),
    });
  });

  it("adota a versão nova que passa: row active com preço herdado (estimado), e-mail pedindo confirmação", async () => {
    listMock.mockResolvedValue([api("claude-sonnet-5-6"), ...PINNED]);
    probeMock.mockResolvedValue({ kind: "pass", aiCallId: null });
    const r = await runModelVersionCheck(T0);
    expect(r).toMatchObject({ status: "ok", summary: { adopted: ["claude-sonnet-5-6"] } });
    expect(probeMock).toHaveBeenCalledTimes(1);
    expect(probeMock.mock.calls[0][0]).toMatchObject({
      id: "claude-sonnet-5-6",
      family: "sonnet",
      inputPricePerMTok: 2,
      adopted: { priceEstimated: true, pinnedId: "claude-sonnet-5-5" },
    });

    const row = (await rowsById())["claude-sonnet-5-6"];
    expect(row).toMatchObject({
      family: "sonnet",
      status: "active",
      pricing: { inputPricePerMTok: 2, outputPricePerMTok: 10 },
      priceConfirmedAt: null,
      adoptedAt: T0,
      maxTokens: 128_000,
    });
    expect(emailMock).toHaveBeenCalledWith({
      adopted: [
        {
          id: "claude-sonnet-5-6",
          pinnedId: "claude-sonnet-5-5",
          inputPricePerMTok: 2,
          outputPricePerMTok: 10,
        },
      ],
      failed: [],
      pinnedMissing: [],
    });

    // O seam passa a usar a adotada (memo zerado na adoção).
    expect((await resolveActiveModel("sonnet")).id).toBe("claude-sonnet-5-6");
  });

  it("B2: adotar com uma `active` já na família → db.batch rebaixa a antiga e insere a nova (índice parcial ok)", async () => {
    listMock.mockResolvedValue([api("claude-sonnet-5-6"), ...PINNED]);
    probeMock.mockResolvedValue({ kind: "pass", aiCallId: null });
    await runModelVersionCheck(T0);

    listMock.mockResolvedValue([api("claude-sonnet-5-7"), api("claude-sonnet-5-6"), ...PINNED]);
    const later = new Date(T0.getTime() + DAY);
    const r = await runModelVersionCheck(later);
    expect(r).toMatchObject({ summary: { adopted: ["claude-sonnet-5-7"], failed: [] } });
    const rows = await rowsById();
    expect(rows["claude-sonnet-5-6"].status).toBe("superseded");
    expect(rows["claude-sonnet-5-7"].status).toBe("active");
    const state = await getActiveModelState();
    expect(state.active.map((a) => a.id)).toEqual(["claude-sonnet-5-7"]);
  });

  it("índice parcial: duas `active` na mesma família são recusadas pelo banco", async () => {
    const base = {
      family: "opus",
      displayName: "x",
      status: "active",
      pricing: { inputPricePerMTok: 1, outputPricePerMTok: 1 },
    };
    await realDb.insert(schema.modelVersions).values({ ...base, id: "claude-opus-5-6" });
    await expect(
      realDb.insert(schema.modelVersions).values({ ...base, id: "claude-opus-5-7" }),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
    // Status/família fora do CHECK também.
    await expect(
      realDb.insert(schema.modelVersions).values({ ...base, id: "x", status: "reverted" }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(
      realDb.insert(schema.modelVersions).values({ ...base, id: "y", family: "fable", status: "failed" }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
  });

  it("capabilities insuficientes → `failed` sem sondar; S3: no dia seguinte nem o snapshot da mesma versão é tentado", async () => {
    listMock.mockResolvedValue([api("claude-opus-5-6", { maxTokens: 8_000 }), ...PINNED]);
    const r = await runModelVersionCheck(T0);
    expect(probeMock).not.toHaveBeenCalled();
    expect(r).toMatchObject({
      summary: { failed: [{ id: "claude-opus-5-6", reason: expect.stringContaining("max_tokens") }] },
    });
    expect((await rowsById())["claude-opus-5-6"]).toMatchObject({
      status: "failed",
      failureReason: expect.stringContaining("capabilities"),
    });
    expect(emailMock.mock.calls[0][0].failed).toHaveLength(1);

    listMock.mockResolvedValue([
      api("claude-opus-5-6-20261101"),
      api("claude-opus-5-6", { maxTokens: 8_000 }),
      ...PINNED,
    ]);
    await runModelVersionCheck(new Date(T0.getTime() + DAY));
    expect(probeMock).not.toHaveBeenCalled();
  });

  it("sondagem reprovada → `failed` com o motivo", async () => {
    listMock.mockResolvedValue([api("claude-haiku-6"), ...PINNED]);
    probeMock.mockResolvedValue({ kind: "fail", reason: "resposta errada (6)", aiCallId: null });
    await runModelVersionCheck(T0);
    expect((await rowsById())["claude-haiku-6"]).toMatchObject({
      family: "haiku",
      status: "failed",
      failureReason: "sondagem: resposta errada (6)",
    });
  });

  it("N5: transitório só vai pro resumo; depois de 7 dias seguidos vira `failed`", async () => {
    listMock.mockResolvedValue([api("claude-sonnet-5-6"), ...PINNED]);
    probeMock.mockResolvedValue({ kind: "transient", reason: "timeout: t", aiCallId: null });

    const r1 = await runModelVersionCheck(T0);
    expect(r1).toMatchObject({
      summary: {
        failed: [],
        transient: [{ id: "claude-sonnet-5-6", family: "sonnet", since: T0.toISOString() }],
      },
    });
    expect(await listModelVersions()).toEqual([]);
    expect(emailMock.mock.calls[0][0]).toEqual({ adopted: [], failed: [], pinnedMissing: [] });

    // Dia 6: ainda transitório, `since` preservado.
    const r6 = await runModelVersionCheck(new Date(T0.getTime() + 6 * DAY));
    expect(r6).toMatchObject({ summary: { transient: [{ since: T0.toISOString() }] } });

    // Dia 7: reprovada.
    const r7 = await runModelVersionCheck(new Date(T0.getTime() + 7 * DAY));
    expect(r7).toMatchObject({
      summary: {
        transient: [],
        failed: [{ id: "claude-sonnet-5-6", reason: expect.stringContaining("transitório persistente") }],
      },
    });
    expect((await rowsById())["claude-sonnet-5-6"].status).toBe("failed");
  });

  it("capabilities null é transitório, não reprovação", async () => {
    listMock.mockResolvedValue([api("claude-sonnet-5-6", { capabilities: null }), ...PINNED]);
    const r = await runModelVersionCheck(T0);
    expect(r).toMatchObject({ summary: { transient: [{ id: "claude-sonnet-5-6" }], failed: [] } });
    expect(probeMock).not.toHaveBeenCalled();
  });

  it("kill switch desligado → só grava o resumo (disabled), sem sondar nem adotar", async () => {
    await realDb
      .insert(schema.aiConfig)
      .values({ id: 1, defaultModelId: "claude-sonnet-5-5", enableAutoModelVersions: false });
    listMock.mockResolvedValue([api("claude-sonnet-5-6"), ...PINNED]);
    const r = await runModelVersionCheck(T0);
    expect(r.status).toBe("disabled");
    expect(probeMock).not.toHaveBeenCalled();
    expect(await listModelVersions()).toEqual([]);
    expect((await getModelVersionsCheck()).summary?.status).toBe("disabled");
    expect(await getActiveModelState()).toEqual({ enabled: false, active: [] });
  });

  it("S8: conferida fora da listagem vai pro resumo; e-mail só na primeira vez", async () => {
    listMock.mockResolvedValue([api("claude-opus-5-5"), api("claude-haiku-5-5")]);
    const r = await runModelVersionCheck(T0);
    expect(r).toMatchObject({ summary: { pinnedMissing: ["claude-sonnet-5-5"] } });
    expect(emailMock.mock.calls[0][0].pinnedMissing).toEqual(["claude-sonnet-5-5"]);

    const r2 = await runModelVersionCheck(new Date(T0.getTime() + DAY));
    expect(r2).toMatchObject({ summary: { pinnedMissing: ["claude-sonnet-5-5"] } });
    expect(emailMock.mock.calls[1][0].pinnedMissing).toEqual([]);
  });

  it("e-mail que falha não derruba a checagem: vira emailError no resumo", async () => {
    listMock.mockResolvedValue([api("claude-sonnet-5-6"), ...PINNED]);
    probeMock.mockResolvedValue({ kind: "pass", aiCallId: null });
    emailMock.mockRejectedValue(new Error("resend fora"));
    const r = await runModelVersionCheck(T0);
    expect(r).toMatchObject({
      status: "ok",
      summary: { adopted: ["claude-sonnet-5-6"], emailError: "resend fora" },
    });
    expect((await getModelVersionsCheck()).summary?.emailError).toBe("resend fora");
  });

  it("S2: versão adotada há mais de 24h que regrediu vira `failed` (regressão) e a família volta pra conferida", async () => {
    listMock.mockResolvedValue([api("claude-sonnet-5-6"), ...PINNED]);
    probeMock.mockResolvedValue({ kind: "pass", aiCallId: null });
    await runModelVersionCheck(T0);

    const [user] = await realDb
      .insert(schema.users)
      .values({ email: "u@x.com" })
      .returning({ id: schema.users.id });
    const [match] = await realDb
      .insert(schema.matches)
      .values({
        externalId: "ext-reg",
        league: "brasileirao_a",
        homeTeam: "A",
        awayTeam: "B",
        kickoffAt: T0,
      })
      .returning({ id: schema.matches.id });
    const call = (model: string, status: "ok" | "tool_missing", at: Date) => ({
      userId: user.id,
      matchId: match.id,
      provider: "anthropic",
      model,
      promptVersion: "over_under_v3.0",
      inputPayload: {},
      outputPayload: {},
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
      costUsd: "0",
      status,
      createdAt: at,
    });
    const after = new Date(T0.getTime() + 60_000);
    const before = new Date(T0.getTime() - DAY);
    await realDb.insert(schema.aiCalls).values([
      // Adotada: 4 ruins em 10 (40%).
      ...Array.from({ length: 6 }, () => call("claude-sonnet-5-6", "ok", after)),
      ...Array.from({ length: 4 }, () => call("claude-sonnet-5-6", "tool_missing", after)),
      // Conferida antes da adoção: 1 em 20 (5%).
      ...Array.from({ length: 19 }, () => call("claude-sonnet-5-5", "ok", before)),
      call("claude-sonnet-5-5", "tool_missing", before),
    ]);

    // Antes de 24h: ainda não julga.
    listMock.mockResolvedValue([api("claude-sonnet-5-6"), ...PINNED]);
    await runModelVersionCheck(new Date(T0.getTime() + 12 * 60 * 60 * 1000));
    expect((await rowsById())["claude-sonnet-5-6"].status).toBe("active");

    const r = await runModelVersionCheck(new Date(T0.getTime() + DAY + 1));
    expect(r).toMatchObject({
      summary: { failed: [{ id: "claude-sonnet-5-6", reason: expect.stringContaining("regressão: 4/10") }] },
    });
    expect((await rowsById())["claude-sonnet-5-6"].status).toBe("failed");
    expect(emailMock.mock.lastCall?.[0].failed).toHaveLength(1);
    expect((await resolveActiveModel("sonnet")).id).toBe("claude-sonnet-5-5");
  });
});

describe("runModelVersionCheck — ajustes do review", () => {
  // users/matches não são limpos entre testes: e-mail e externalId únicos.
  let seq = 0;
  async function seedCallFixtures() {
    seq += 1;
    const [user] = await realDb
      .insert(schema.users)
      .values({ email: `r${seq}@x.com` })
      .returning({ id: schema.users.id });
    const [match] = await realDb
      .insert(schema.matches)
      .values({
        externalId: `ext-rev-${seq}`,
        league: "brasileirao_a",
        homeTeam: "A",
        awayTeam: "B",
        kickoffAt: T0,
      })
      .returning({ id: schema.matches.id });
    return (model: string, status: "ok" | "tool_missing", at: Date) => ({
      userId: user.id,
      matchId: match.id,
      provider: "anthropic",
      model,
      promptVersion: "over_under_v3.0",
      inputPayload: {},
      outputPayload: {},
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
      costUsd: "0",
      status,
      createdAt: at,
    });
  }

  // 5.6 adotada em T0, 5.7 em T1: nos 7 dias antes de T1 quem serviu o Sonnet foi a 5.6.
  const T1 = new Date(T0.getTime() + 3 * DAY);
  async function adoptTwice() {
    listMock.mockResolvedValue([api("claude-sonnet-5-6"), ...PINNED]);
    probeMock.mockResolvedValue({ kind: "pass", aiCallId: null });
    await runModelVersionCheck(T0);
    listMock.mockResolvedValue([api("claude-sonnet-5-7"), api("claude-sonnet-5-6"), ...PINNED]);
    await runModelVersionCheck(T1);
    expect((await rowsById())["claude-sonnet-5-7"].status).toBe("active");
  }

  it("S2: a base é o que a FAMÍLIA serviu antes da adoção (a adotada anterior conta)", async () => {
    await adoptTwice();
    const call = await seedCallFixtures();
    const before = new Date(T1.getTime() - DAY);
    const after = new Date(T1.getTime() + 60_000);
    await realDb.insert(schema.aiCalls).values([
      ...Array.from({ length: 19 }, () => call("claude-sonnet-5-6", "ok", before)),
      call("claude-sonnet-5-6", "tool_missing", before),
      ...Array.from({ length: 6 }, () => call("claude-sonnet-5-7", "ok", after)),
      ...Array.from({ length: 4 }, () => call("claude-sonnet-5-7", "tool_missing", after)),
    ]);
    const r = await runModelVersionCheck(new Date(T1.getTime() + DAY + 1));
    expect(r).toMatchObject({
      summary: {
        failed: [
          {
            id: "claude-sonnet-5-7",
            reason: expect.stringContaining("contra 1/20 (5%) da família"),
          },
        ],
      },
    });
    expect((await rowsById())["claude-sonnet-5-7"].status).toBe("failed");
  });

  it("S2: base com menos de 10 chamadas → não julga (a adotada segue)", async () => {
    await adoptTwice();
    const call = await seedCallFixtures();
    const before = new Date(T1.getTime() - DAY);
    const after = new Date(T1.getTime() + 60_000);
    await realDb.insert(schema.aiCalls).values([
      ...Array.from({ length: 9 }, () => call("claude-sonnet-5-6", "ok", before)),
      ...Array.from({ length: 10 }, () => call("claude-sonnet-5-7", "tool_missing", after)),
    ]);
    await runModelVersionCheck(new Date(T1.getTime() + DAY + 1));
    expect((await rowsById())["claude-sonnet-5-7"].status).toBe("active");
  });

  it("§9: versão que o wrapper marcou `failed` entre checagens sai no e-mail, uma vez só; a rejeição do admin não", async () => {
    listMock.mockResolvedValue([api("claude-sonnet-5-6"), api("claude-haiku-5-6"), ...PINNED]);
    probeMock.mockResolvedValue({ kind: "pass", aiCallId: null });
    await runModelVersionCheck(T0);
    expect(emailMock.mock.calls[0][0].failed).toEqual([]);

    // O seam marca a Sonnet 5.6 (como withAdoptedVersions faz); o admin rejeita a Haiku.
    const seamReason = "a API recusou o pedido (400), e a conferida passou: bad";
    await markModelVersionFailed("claude-sonnet-5-6", seamReason, new Date(T0.getTime() + 3600_000));
    await rejectModelVersion("claude-haiku-5-6", new Date(T0.getTime() + 7200_000));

    await runModelVersionCheck(new Date(T0.getTime() + DAY));
    expect(emailMock.mock.calls[1][0].failed).toEqual([
      { id: "claude-sonnet-5-6", reason: seamReason },
    ]);

    await runModelVersionCheck(new Date(T0.getTime() + 2 * DAY));
    expect(emailMock.mock.calls[2][0].failed).toEqual([]);
  });

  it("§9: a reprovação desta checagem não sai duplicada no e-mail", async () => {
    listMock.mockResolvedValue([...PINNED]);
    await runModelVersionCheck(T0);
    listMock.mockResolvedValue([api("claude-opus-5-6"), ...PINNED]);
    probeMock.mockResolvedValue({ kind: "fail", reason: "resposta errada (6)", aiCallId: null });
    await runModelVersionCheck(new Date(T0.getTime() + DAY));
    expect(emailMock.mock.calls[1][0].failed).toEqual([
      { id: "claude-opus-5-6", reason: "sondagem: resposta errada (6)" },
    ]);
  });

  it("§9: listagem fora do ar ainda avisa a falha marcada pelo seam", async () => {
    listMock.mockResolvedValue([api("claude-sonnet-5-6"), ...PINNED]);
    probeMock.mockResolvedValue({ kind: "pass", aiCallId: null });
    await runModelVersionCheck(T0);
    await markModelVersionFailed("claude-sonnet-5-6", "404", new Date(T0.getTime() + 3600_000));
    listMock.mockRejectedValue(new Error("api fora"));
    const r = await runModelVersionCheck(new Date(T0.getTime() + DAY));
    expect(r.status).toBe("listing_failed");
    expect(emailMock.mock.lastCall?.[0].failed).toEqual([{ id: "claude-sonnet-5-6", reason: "404" }]);
  });

  it("N5: o transitório não reavaliado (flag desligada, erro no meio) segue com o `since`; o snapshot conta os mesmos dias", async () => {
    listMock.mockResolvedValue([api("claude-sonnet-5-6"), ...PINNED]);
    probeMock.mockResolvedValue({ kind: "transient", reason: "timeout: t", aiCallId: null });
    await runModelVersionCheck(T0);

    // Dia 3: flag desligada, nada sondado, o transitório segue.
    await realDb
      .update(schema.aiConfig)
      .set({ enableAutoModelVersions: false })
      .where(eq(schema.aiConfig.id, 1));
    const r3 = await runModelVersionCheck(new Date(T0.getTime() + 3 * DAY));
    expect(r3).toMatchObject({
      status: "disabled",
      summary: { transient: [{ id: "claude-sonnet-5-6", since: T0.toISOString() }] },
    });
    await realDb
      .update(schema.aiConfig)
      .set({ enableAutoModelVersions: true })
      .where(eq(schema.aiConfig.id, 1));

    // Dia 5: a família lança no meio, o transitório segue.
    probeMock.mockRejectedValueOnce(new Error("boom"));
    const r5 = await runModelVersionCheck(new Date(T0.getTime() + 5 * DAY));
    expect(r5).toMatchObject({
      summary: {
        error: expect.stringContaining("sonnet: boom"),
        transient: [{ id: "claude-sonnet-5-6", since: T0.toISOString() }],
      },
    });

    // Dia 7: só o snapshot datado da mesma versão na listagem → mesma contagem, reprova.
    listMock.mockResolvedValue([api("claude-sonnet-5-6-20261101"), ...PINNED]);
    const r7 = await runModelVersionCheck(new Date(T0.getTime() + 7 * DAY));
    expect(r7).toMatchObject({
      summary: {
        transient: [],
        failed: [
          {
            id: "claude-sonnet-5-6-20261101",
            reason: expect.stringContaining("transitório persistente"),
          },
        ],
      },
    });
  });

  it("N5: família avaliada sem o candidato antigo larga o transitório", async () => {
    listMock.mockResolvedValue([api("claude-sonnet-5-6"), ...PINNED]);
    probeMock.mockResolvedValue({ kind: "transient", reason: "timeout: t", aiCallId: null });
    await runModelVersionCheck(T0);
    listMock.mockResolvedValue([...PINNED]);
    const r = await runModelVersionCheck(new Date(T0.getTime() + DAY));
    expect(r).toMatchObject({ summary: { transient: [] } });
  });
});

describe("queries de model_versions", () => {
  async function seedActive(id = "claude-haiku-5-6") {
    listMock.mockResolvedValue([api(id), ...PINNED]);
    probeMock.mockResolvedValue({ kind: "pass", aiCallId: null });
    await runModelVersionCheck(T0);
  }

  it("markModelVersionFailed é idempotente: a 2ª marcação não troca o motivo", async () => {
    await seedActive();
    expect(await markModelVersionFailed("claude-haiku-5-6", "404")).toBe(true);
    expect(await markModelVersionFailed("claude-haiku-5-6", "outro")).toBe(false);
    expect((await rowsById())["claude-haiku-5-6"].failureReason).toBe("404");
  });

  it("rejectModelVersion → failed 'rejeitada pelo admin'", async () => {
    await seedActive();
    expect(await rejectModelVersion("claude-haiku-5-6")).toBe(true);
    expect((await rowsById())["claude-haiku-5-6"]).toMatchObject({
      status: "failed",
      failureReason: "rejeitada pelo admin",
    });
    expect(await rejectModelVersion("claude-haiku-5-6")).toBe(false);
  });

  it("confirmModelVersionPrice grava o preço, marca a data e mantém a tarifa de prompt longo herdada", async () => {
    await seedActive();
    const at = new Date(T0.getTime() + DAY);
    expect(
      await confirmModelVersionPrice(
        "claude-haiku-5-6",
        { inputPricePerMTok: 0.2, outputPricePerMTok: 1 },
        at,
      ),
    ).toBe(true);
    expect((await rowsById())["claude-haiku-5-6"]).toMatchObject({
      pricing: {
        inputPricePerMTok: 0.2,
        outputPricePerMTok: 1,
        longPromptPricing: { aboveInputTokens: 100_000, inputPricePerMTok: 0.5, outputPricePerMTok: 2.5 },
      },
      priceConfirmedAt: at,
    });
    resetActiveModelMemo();
    expect(await resolveActiveModel("haiku")).toMatchObject({
      id: "claude-haiku-5-6",
      inputPricePerMTok: 0.2,
      adopted: { priceEstimated: false },
    });
    expect(
      await confirmModelVersionPrice("claude-x-1", { inputPricePerMTok: 1, outputPricePerMTok: 1 }),
    ).toBe(false);
  });

  it("getActiveModelState sem row em ai_config → ligado por padrão", async () => {
    await seedActive();
    await realDb.delete(schema.aiConfig).where(eq(schema.aiConfig.id, 1));
    const state = await getActiveModelState();
    expect(state.enabled).toBe(true);
    expect(state.active.map((r) => r.id)).toEqual(["claude-haiku-5-6"]);
  });
});
