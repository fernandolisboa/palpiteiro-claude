import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/bet-slip", () => ({ registerBetSlip: vi.fn() }));
vi.mock("@/app/actions/bets", () => ({ parseBet: vi.fn() }));

import { registerBetSlip } from "@/app/actions/bet-slip";
import { BetSlipProvider } from "@/components/bet-slip/bet-slip-provider";
import { MarketTable } from "@/components/bet-slip/market-table";
import { SlipPanel } from "@/components/bet-slip/slip-panel";
import { MAX_SLIP_SELECTIONS } from "@/lib/bets/slip-markets";
import { scorelineMatrix } from "@/lib/quant/scoreline-model";
import { toBetGridView } from "@/lib/view/bet-slip";

const MATCH_ID = "11111111-1111-1111-1111-111111111111";
const TEAMS = { home: "Flamengo", away: "Palmeiras" };
const grid = toBetGridView({
  teams: TEAMS,
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

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.mocked(registerBetSlip).mockReset();
});

// Duas instâncias do painel (a coluna do desktop e a folha do celular) no mesmo provider.
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
      </BetSlipProvider>,
    ),
  );
}

const panel = (id: "a" | "b") =>
  container.querySelector(`[data-testid="panel-${id}"]`)!.textContent ?? "";

function cell(label: RegExp): HTMLButtonElement {
  const b = Array.from(container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")).find(
    (el) => label.test(el.textContent ?? ""),
  );
  if (!b) throw new Error(`célula não encontrada: ${label}`);
  return b;
}

const click = (el: HTMLElement) => act(async () => el.click());

describe("BetSlipProvider", () => {
  it("uma seleção por mercado: trocar o lado substitui", async () => {
    await mountPage();
    await click(cell(/^Flamengo(?! ou)/));
    await click(cell(/^Palmeiras/));
    expect(panel("a")).toContain("suas apostas (1)");
    expect(panel("a")).toContain("Vitória do Palmeiras");
    expect(panel("a")).not.toContain("Vitória do Flamengo");
    expect(cell(/^Palmeiras/).getAttribute("aria-pressed")).toBe("true");
  });

  it("placar exato aceita vários; tocar de novo tira", async () => {
    await mountPage();
    const scores = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"),
    ).filter((b) => /^\d × \d/.test(b.textContent ?? ""));
    await click(scores[0]);
    await click(scores[1]);
    expect(panel("a")).toContain("suas apostas (2)");
    await click(scores[0]);
    expect(panel("a")).toContain("suas apostas (1)");
  });

  it(`limite de ${MAX_SLIP_SELECTIONS} seleções, com aviso`, async () => {
    await mountPage();
    const all = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"),
    );
    // Uma por mercado (6 grupos) + placares: passa do limite.
    const picks = [
      ...grid.groups.map((g) => all.find((b) => b.textContent?.startsWith(g.selections[0].label))!),
      ...all.filter((b) => /^\d × \d/.test(b.textContent ?? "")),
    ];
    for (const b of picks) await click(b);
    expect(panel("a")).toContain(`suas apostas (${MAX_SLIP_SELECTIONS})`);
    expect(panel("a")).toContain(`No máximo ${MAX_SLIP_SELECTIONS} seleções por vez.`);
  });

  it("as duas instâncias do painel mostram o mesmo estado", async () => {
    await mountPage();
    await click(cell(/^Empate/));
    expect(panel("a")).toContain("suas apostas (1)");
    expect(panel("b")).toContain("suas apostas (1)");
    const limpar = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[data-testid="panel-b"] button'),
    ).find((b) => b.textContent === "limpar")!;
    await click(limpar);
    expect(panel("a")).not.toContain("suas apostas (1)");
    expect(panel("b")).not.toContain("suas apostas (1)");
  });

  it("registrar com sucesso limpa a lista e mostra a avaliação", async () => {
    vi.mocked(registerBetSlip).mockResolvedValue({
      ok: true,
      registered: 1,
      evaluation: {
        mode: "simples",
        legs: [],
        combo: null,
        stakeRuleNote: "Stake sugerido pelas bandas.",
        modelCaveat: "Leia o edge como opinião do modelo.",
      },
    });
    await mountPage();
    await click(cell(/^Empate/));
    const form = container.querySelector<HTMLFormElement>('[data-testid="panel-a"] form')!;
    await act(async () => form.requestSubmit());
    await act(async () => {});
    expect(registerBetSlip).toHaveBeenCalledTimes(1);
    expect(panel("a")).not.toContain("suas apostas (1)");
    expect(panel("a")).toContain("aposta registrada");
    expect(panel("b")).toContain("aposta registrada");
  });
});
