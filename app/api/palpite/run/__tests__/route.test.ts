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

import { runPalpiteHero } from "@/app/actions/predictions";
import { maxDuration, POST } from "@/app/api/palpite/run/route";
import { parseStreamLine, type StreamMessage } from "@/lib/ai/progress/protocol";
import { trackStep } from "@/lib/ai/progress/run-progress";
import { STEPS } from "@/lib/ai/progress/steps";

const runMock = vi.mocked(runPalpiteHero);

function req(
  headers: Record<string, string> = { origin: "https://palpiteiro.live", host: "palpiteiro.live" },
): Request {
  const body = new FormData();
  body.set("matchId", "11111111-1111-1111-1111-111111111111");
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
    expect(msgs).toEqual([
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
});
