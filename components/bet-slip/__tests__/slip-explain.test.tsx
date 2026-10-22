import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/bet-slip", () => ({ registerBetSlip: vi.fn() }));
vi.mock("@/app/actions/bet-slip-explain", () => ({ explainBetSlip: vi.fn() }));
vi.mock("@/app/actions/bets", () => ({ parseBet: vi.fn() }));

import {
  registerBetSlip,
  type RegisterBetSlipResult,
} from "@/app/actions/bet-slip";
import { explainBetSlip } from "@/app/actions/bet-slip-explain";
import { BetSlipProvider } from "@/components/bet-slip/bet-slip-provider";
import { MarketTable } from "@/components/bet-slip/market-table";
import { SlipPanel } from "@/components/bet-slip/slip-panel";
import { scorelineMatrix } from "@/lib/quant/scoreline-model";
import { toBetGridView } from "@/lib/view/bet-slip";

// "Explicar com IA" (#562) no painel: só com `explainable`, manda só os ids, mostra o
// texto nos dois painéis e some quando um registro novo chega.

const MATCH_ID = "11111111-1111-1111-1111-111111111111";
const grid = toBetGridView({
  teams: { home: "Flamengo", away: "Palmeiras" },
  model: {
    source: "dixon_coles",
    degraded: false,
    lambdaHome: 1.6,
    lambdaAway: 1.0,
    matrix: scorelineMatrix(1.6, 1.0),
  },
  references: new Map(),
  analysis: new Map(),
});

function registered(
  slipIds: string[],
  explainable = true
): RegisterBetSlipResult {
  return {
    ok: true,
    registered: slipIds.length,
    evaluation: {
      mode: "simples",
      legs: [],
      combo: null,
      stakeRuleNote: "Stake sugerido pelas bandas.",
      modelCaveat: "Leia o edge como opinião do modelo.",
    },
    slipIds,
    explainable,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.mocked(registerBetSlip).mockReset();
  vi.mocked(explainBetSlip).mockReset();
});

async function mountPage() {
  await act(async () =>
    root.render(
      <BetSlipProvider matchId={MATCH_ID}>
        <MarketTable grid={grid} />
        <div data-testid="panel-a">
          <SlipPanel />
        </div>
        <div data-testid="panel-b">
          <SlipPanel />
        </div>
      </BetSlipProvider>
    )
  );
}

const panel = (id: "a" | "b") =>
  container.querySelector(`[data-testid="panel-${id}"]`)!.textContent ?? "";

async function register() {
  const empate = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")
  ).find((b) => /^Empate/.test(b.textContent ?? ""))!;
  await act(async () => empate.click());
  const form = container.querySelector<HTMLFormElement>(
    '[data-testid="panel-a"] form'
  )!;
  await act(async () => form.requestSubmit());
  await act(async () => {});
}

function explainButton(id: "a" | "b" = "a"): HTMLButtonElement | undefined {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>(
      `[data-testid="panel-${id}"] button`
    )
  ).find((b) => b.textContent === "Explicar com IA");
}

describe("SlipExplain", () => {
  it("sem explainable (flag desligada, ao vivo, sem número) → sem botão", async () => {
    vi.mocked(registerBetSlip).mockResolvedValue(registered(["s-1"], false));
    await mountPage();
    await register();
    expect(panel("a")).toContain("aposta registrada");
    expect(explainButton()).toBeUndefined();
  });

  it("manda só os ids e mostra a explicação nos dois painéis", async () => {
    vi.mocked(registerBetSlip).mockResolvedValue(registered(["s-1"]));
    vi.mocked(explainBetSlip).mockResolvedValue({
      ok: true,
      slipIds: ["s-1"],
      explanation: {
        source: "llm",
        summary: "Resumo da IA.",
        legs: [{ label: "Empate", text: "Texto do empate." }],
        combo: null,
        note: "Texto gerado por IA a partir dos números acima; os números não mudam.",
      },
    });
    await mountPage();
    await register();
    expect(panel("a")).toContain("Conta 1 do seu limite");
    const button = explainButton()!;
    await act(async () => button.closest("form")!.requestSubmit());
    await act(async () => {});
    const fd = vi.mocked(explainBetSlip).mock.calls[0][1];
    expect(JSON.parse(String(fd.get("slipIds")))).toEqual(["s-1"]);
    for (const id of ["a", "b"] as const) {
      expect(panel(id)).toContain("explicação com IA");
      expect(panel(id)).toContain("Texto do empate.");
      expect(panel(id)).toContain("os números não mudam");
    }
    expect(explainButton()).toBeUndefined();
  });

  it("erro → alerta, o botão continua", async () => {
    vi.mocked(registerBetSlip).mockResolvedValue(registered(["s-1"]));
    vi.mocked(explainBetSlip).mockResolvedValue({
      ok: false,
      slipIds: ["s-1"],
      error: "Você atingiu o limite.",
      kind: "limite",
    });
    await mountPage();
    await register();
    await act(async () => explainButton()!.closest("form")!.requestSubmit());
    await act(async () => {});
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "limite"
    );
    expect(explainButton()).toBeDefined();
  });

  it("registro novo esconde a explicação do anterior", async () => {
    vi.mocked(registerBetSlip).mockResolvedValueOnce(registered(["s-1"]));
    vi.mocked(explainBetSlip).mockResolvedValue({
      ok: true,
      slipIds: ["s-1"],
      explanation: {
        source: "template",
        summary: "Resumo antigo.",
        legs: [],
        combo: null,
        note: "nota",
      },
    });
    await mountPage();
    await register();
    await act(async () => explainButton()!.closest("form")!.requestSubmit());
    await act(async () => {});
    expect(panel("a")).toContain("Resumo antigo.");
    vi.mocked(registerBetSlip).mockResolvedValueOnce(registered(["s-2"]));
    await register();
    expect(panel("a")).not.toContain("Resumo antigo.");
    expect(explainButton()).toBeDefined();
  });
});
