import { beforeEach, describe, expect, it, vi } from "vitest";

// O run de verdade (auth, cobrança, fan-out) é da action: aqui ela é trocada por uma
// que marca etapas pelo MESMO canal do pipeline, pra provar o transporte.
vi.mock("@/app/actions/predictions", () => ({ runPalpiteHero: vi.fn() }));
const afterTasks: Promise<unknown>[] = [];
vi.mock("next/server", () => ({
  after: (task: Promise<unknown>) => {
    afterTasks.push(task);
  },
}));

const session = vi.hoisted(() => ({ userId: "user-1" as string | null }));
vi.mock("@/auth", () => ({
  auth: vi.fn(async () => (session.userId ? { user: { id: session.userId } } : null)),
}));

import { runPalpiteHero } from "@/app/actions/predictions";
import { GET, maxDuration, POST } from "@/app/api/palpite/run/route";
import { readRunMarker } from "@/lib/ai/progress/run-marker";
import { parseStreamLine, type StreamMessage } from "@/lib/ai/progress/protocol";
import { trackStep } from "@/lib/ai/progress/run-progress";
import { STEPS } from "@/lib/ai/progress/steps";

const runMock = vi.mocked(runPalpiteHero);
const MATCH = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";

function req(
  headers: Record<string, string> = { origin: "https://palpiteiro.live", host: "palpiteiro.live" },
): Request {
  const body = new FormData();
  body.set("matchId", MATCH);
  body.set("intent", "analysis");
  return new Request("https://palpiteiro.live/api/palpite/run", {
    method: "POST",
    headers,
    body,
  });
}

async function readAll(res: Response): Promise<StreamMessage[]> {
  const text = await res.text();
  return text
    .split("\n")
    .map(parseStreamLine)
    .filter((m): m is StreamMessage => m !== null);
}

beforeEach(() => {
  runMock.mockReset();
  afterTasks.length = 0;
  session.userId = "user-1";
});

describe("POST /api/palpite/run", () => {
  it("mesmo teto da página do jogo", () => {
    expect(maxDuration).toBe(300);
  });

  it("origem de outro site → 403, sem rodar nada", async () => {
    const res = await POST(req({ origin: "https://evil.example", host: "palpiteiro.live" }));
    expect(res.status).toBe(403);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("sem Origin → 403", async () => {
    const res = await POST(req({ host: "palpiteiro.live" }));
    expect(res.status).toBe(403);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("atrás do proxy vale o x-forwarded-host", async () => {
    runMock.mockResolvedValue({ ok: false, error: "Faça login para analisar." });
    const res = await POST(
      req({
        origin: "https://palpiteiro.live",
        host: "internal:3000",
        "x-forwarded-host": "palpiteiro.live",
      }),
    );
    expect(res.status).toBe(200);
    await readAll(res);
  });

  it("streama as etapas que rodaram e termina com o resultado", async () => {
    runMock.mockImplementation(async (_prev, formData) => {
      expect(formData.get("intent")).toBe("analysis");
      await trackStep(STEPS.sportsData, async () => undefined);
      await trackStep(STEPS.jev, async () => undefined);
      return {
        ok: true,
        view: { entries: [], errors: [] } as never,
        palpite: null,
        contextNotice: "aviso",
      };
    });
    const res = await POST(req());
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    expect(res.headers.get("cache-control")).toContain("no-store");
    const msgs = await readAll(res);
    expect(msgs[0]).toEqual({ t: "run", id: expect.any(String) });
    expect(msgs.slice(1)).toEqual([
      { t: "step", id: "sports_data", status: "active", label: STEPS.sportsData.active },
      { t: "step", id: "sports_data", status: "done", label: STEPS.sportsData.done },
      { t: "step", id: "jev", status: "active", label: STEPS.jev.active },
      { t: "step", id: "jev", status: "done", label: STEPS.jev.done },
      { t: "result", outcome: { ok: true, analysis: true, contextNotice: "aviso" } },
    ]);
    // O run fica registrado no after(): segue mesmo se o cliente sair.
    expect(afterTasks).toHaveLength(1);
  });

  it("erro inesperado na action vira resultado de falha, não stream quebrado", async () => {
    runMock.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const msgs = await readAll(await POST(req()));
    expect(msgs.at(-1)).toEqual({
      t: "result",
      outcome: { ok: false, error: "Falha temporária ao gerar análise. Tente novamente." },
    });
    spy.mockRestore();
  });

  it("cliente que sai no meio não derruba o run", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    runMock.mockImplementation(async () => {
      await gate;
      await trackStep(STEPS.odds, async () => undefined);
      return { ok: true, palpite: null };
    });
    const res = await POST(req());
    await res.body!.cancel();
    release();
    await expect(afterTasks[0]).resolves.toBeUndefined();
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it("grava o run no marcador do jogo: quem volta pra página acompanha e vê o fim", async () => {
    session.userId = "user-marker";
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    runMock.mockImplementation(async () => {
      await trackStep(STEPS.sportsData, async () => undefined);
      await gate;
      return { ok: true, palpite: null };
    });
    const res = await POST(req());
    const reading = readAll(res);
    await new Promise((r) => setTimeout(r, 0));
    const running = await readRunMarker("user-marker", MATCH);
    expect(running).toMatchObject({
      status: "running",
      intent: "analysis",
      live: false,
      outcome: null,
    });
    expect(running!.steps[0]).toMatchObject({ id: "sports_data" });

    release();
    const msgs = await reading;
    const runId = (msgs[0] as { id: string }).id;
    const done = await readRunMarker("user-marker", MATCH);
    expect(done).toMatchObject({
      runId,
      status: "done",
      outcome: { ok: true, analysis: false },
    });
    expect(done!.steps).toEqual([
      { id: "sports_data", status: "done", label: STEPS.sportsData.done },
    ]);
  });

  it("sem sessão: nenhum marcador (a action recusa o run)", async () => {
    session.userId = null;
    runMock.mockImplementation(async () => {
      await trackStep(STEPS.sportsData, async () => undefined);
      return { ok: false, error: "Faça login para analisar." };
    });
    await readAll(await POST(req()));
    expect(await readRunMarker("null", MATCH)).toBeNull();
  });
});

describe("GET /api/palpite/run", () => {
  const get = (matchId: string) =>
    GET(new Request(`https://palpiteiro.live/api/palpite/run?matchId=${matchId}`));

  it("matchId inválido → 400", async () => {
    expect((await get("x")).status).toBe(400);
  });

  it("sem sessão → 401", async () => {
    session.userId = null;
    expect((await get(MATCH)).status).toBe(401);
  });

  it("só o run da própria pessoa", async () => {
    session.userId = "user-get";
    runMock.mockImplementation(async () => {
      await trackStep(STEPS.odds, async () => undefined);
      return { ok: true, palpite: null };
    });
    await readAll(await POST(req()));
    const mine = await get(MATCH);
    expect(mine.headers.get("cache-control")).toContain("no-store");
    expect((await mine.json()).run).toMatchObject({ status: "done" });

    session.userId = "someone-else";
    expect((await (await get(MATCH)).json()).run).toBeNull();
  });
});
