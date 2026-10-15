import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/bet-slip", () => ({ registerBetSlip: vi.fn() }));
vi.mock("@/app/actions/bets", () => ({ parseBet: vi.fn() }));

import { BetSlipProvider } from "@/components/bet-slip/bet-slip-provider";
import { MarketTable } from "@/components/bet-slip/market-table";
import { SlipPanel } from "@/components/bet-slip/slip-panel";
import { inPlayScoreline } from "@/lib/quant/in-play";
import type { ReferenceMarket } from "@/lib/bets/evaluate-slip";
import { scorelineMatrix } from "@/lib/quant/scoreline-model";
import { toBetGridView, type BetGridView } from "@/lib/view/bet-slip";

const MATCH_ID = "11111111-1111-1111-1111-111111111111";
const TEAMS = { home: "Flamengo", away: "Palmeiras" };
const NOW = new Date("2026-10-12T12:12:00Z");
const MODEL = {
  source: "dixon_coles" as const,
  degraded: false,
  lambdaHome: 1.6,
  lambdaAway: 1.0,
  matrix: scorelineMatrix(1.6, 1.0),
  baseCheckedAt: new Date("2026-10-12T09:12:00Z"),
};
const ref = (odds: Record<string, number>): ReferenceMarket => ({
  bookmaker: "pinnacle",
  capturedAt: new Date("2026-10-12T12:00:00Z"),
  odds,
});

function grid(over: Partial<Parameters<typeof toBetGridView>[0]> = {}): BetGridView {
  return toBetGridView({
    teams: TEAMS,
    model: MODEL,
    references: new Map([["match_result", ref({ home: 2.1, draw: 3.3, away: 3.6 })]]),
    analysis: new Map([
      [
        "match_result",
        {
          predictionId: "p1",
          createdAt: new Date("2026-10-12T10:00:00Z"),
          probs: { home: 52, draw: 26, away: 22 },
          recommendation: "home",
        },
      ],
    ]),
    modelReading: { source: "Dixon-Coles", jev: "+ JEV" },
    now: NOW,
    ...over,
  });
}

// Ao vivo (#580): 2–0 aos 63', modelo em jogo, odd de antes do jogo.
const LIVE_SCORE = { home: 2, away: 0 };
const LIVE_MODEL = inPlayScoreline(MODEL, {
  statusShort: "2H",
  elapsed: 63,
  extra: null,
  score: LIVE_SCORE,
  red: null,
})!;
const liveGrid = () =>
  grid({
    model: LIVE_MODEL,
    references: new Map([
      ["match_result", ref({ home: 2.1, draw: 3.3, away: 3.6 })],
      ["over_under:1.5", ref({ over: 1.3, under: 3.4 })],
    ]),
    unavailable: "live",
    live: { score: LIVE_SCORE, minuteLabel: "63'" },
  });

const html = (g: BetGridView) =>
  renderToStaticMarkup(
    <BetSlipProvider matchId={MATCH_ID}>
      <MarketTable grid={g} />
    </BetSlipProvider>,
  );

const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("MarketTable — células", () => {
  it("odd, chance e justa em pt-BR, cada número com rótulo pro leitor de tela", () => {
    const t = text(html(grid()));
    // 1X2 analisado: chance da análise (52%) e justa 100/52.
    expect(t).toContain("Flamengo odd de mercado 2,10 chance pela sua análise 52,0% · , odd justa 1,92");
    // Ambas marcam sem odd: a justa em cinza e só a chance.
    expect(t).toMatch(/Sim justa \d,\d\d chance do modelo \d\d,\d%/);
  });

  it("marca IA + texto sr-only só na seleção recomendada", () => {
    const h = html(grid());
    expect(h.split("recomendada pela análise da IA").length - 1).toBe(1);
    expect(h.split(">IA</span>").length - 1).toBe(1);
    expect(text(h)).toContain("Flamengo odd de mercado 2,10");
  });

  it("rodapé do mercado: chance sem a margem, margem e idade", () => {
    const t = text(html(grid()));
    expect(t).toMatch(/sem a margem: \d\d,\d% · \d\d,\d% · \d\d,\d% · margem \d,\d% · há 12min/);
    expect(t).toContain("pela sua análise");
    expect(t).toContain("Nos mercados que você analisou, a chance é a da análise da IA.");
  });

  it("rodapé da tabela com o modelo usado e o calculado há", () => {
    expect(text(html(grid()))).toContain("chances pelo modelo Dixon-Coles + JEV · calculado há 3h");
    expect(text(html(grid({ model: null })))).toContain(
      "A chance do modelo aparece quando o cálculo do jogo rodar",
    );
  });

  it("só leitura: nenhum <button>, sem placar exato nem texto livre", () => {
    const h = html(grid({ mode: "readOnly", unavailable: "finished" }));
    expect(h).not.toContain("<button type=\"button\" aria-pressed");
    expect(h).not.toContain("Placar exato");
    expect(h).not.toContain("ou digite sua aposta");
    expect(text(h)).toContain("Odds antes do jogo");
  });

  it("sem nenhuma captura: o aviso por estado, com a fonte", () => {
    const t = text(html(grid({ references: new Map(), mode: "readOnly", unavailable: "live" })));
    expect(t).toContain("Odds indisponíveis");
    expect(t).toContain("Jogo em andamento, sem cotação pré-jogo publicada.");
    expect(t).toContain("fonte: the-odds-api");
    // Só leitura sem odd: nada de tabela vazia.
    expect(t).not.toContain("Odds antes do jogo");
  });
});

describe("MarketTable — legenda da chance", () => {
  it("com o modelo: chance do modelo, com a dica", () => {
    const h = html(grid());
    expect(text(h)).toContain("odd de mercado · chance do modelo · odd justa");
    expect(h).toContain('aria-label="Ajuda: chance do modelo e odd justa"');
  });

  it("só leitura com análise: a chance é a da análise, sem a dica do modelo", () => {
    const h = html(grid({ mode: "readOnly", unavailable: "finished" }));
    const t = text(h);
    expect(t).toContain("odd de mercado · chance pela sua análise · odd justa");
    expect(t).not.toContain("chance do modelo");
    expect(h).not.toContain("Ajuda: chance do modelo");
    // A legenda já diz a fonte: sem a nota de "nos mercados que você analisou".
    expect(t).not.toContain("Nos mercados que você analisou");
  });

  it("só leitura sem análise: só a odd, sem dica", () => {
    const h = html(grid({ mode: "readOnly", unavailable: "finished", analysis: new Map() }));
    const t = text(h);
    expect(t).toContain("odd de mercado");
    // ("Dupla chance" é o título do mercado.)
    expect(t).not.toMatch(/chance (do modelo|pela sua análise)|odd justa/);
    expect(h).not.toContain("Ajuda: chance do modelo");
  });
});

// Todos os modos da tabela: registro com e sem modelo, sem nenhuma odd, só leitura com e
// sem odd.
const ALL_MODES: [string, BetGridView][] = [
  ["registro", grid()],
  ["registro sem modelo", grid({ model: null })],
  ["registro sem odd", grid({ references: new Map() })],
  ["só leitura", grid({ mode: "readOnly", unavailable: "finished" })],
  ["só leitura sem odd", grid({ mode: "readOnly", unavailable: "live", references: new Map() })],
  ["registro ao vivo", liveGrid()],
];

describe("MarketTable — ao vivo (#580)", () => {
  it("cabeçalho, legenda pré-jogo × ao vivo e rodapé do momento", () => {
    const t = text(html(liveGrid()));
    expect(t).toContain("Odds antes do jogo");
    expect(t).toContain("odd pré-jogo · chance ao vivo · odd justa");
    expect(t).toContain("chances pelo modelo ao vivo · 63&#x27; · 2–0");
    expect(t).toContain("digite a odd que pegou");
    expect(t).toContain("odd antes do jogo 2,10 chance do modelo ao vivo");
    // A análise salva (que recomendaria a casa) não aparece ao vivo.
    expect(t).not.toContain("pela sua análise");
    expect(html(liveGrid())).not.toContain("recomendada pela análise da IA");
  });

  it("seleção decidida: 'decidido', sem botão nem número", () => {
    const h = html(liveGrid());
    const t = text(h);
    expect(t).toContain("Mais de 1,5 decidido");
    expect(t).toContain("Menos de 1,5 decidido");
    expect(t).not.toContain("1,30");
    // Os botões de Mais/Menos de 1,5 não existem; os de 2,5 sim.
    expect(h).not.toMatch(/<button[^>]*>(?:(?!<\/button>).)*Mais de 1,5/s);
    expect(h).toMatch(/<button[^>]*>(?:(?!<\/button>).)*Mais de 2,5/s);
  });
});

describe("MarketTable — guardas", () => {
  it.each(ALL_MODES)("%s: sem linguagem de valor (a tabela não mede vantagem)", (_, g) => {
    expect(text(html(g))).not.toMatch(/edge|valor|\bEV\b|stake/i);
  });

  it.each(ALL_MODES)("%s: nunca o nome da casa (a captura é da pinnacle)", (_, g) => {
    expect(html(g)).not.toMatch(/pinnacle/i);
  });
});

describe("MarketTable — interação", () => {
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
  });

  it("células são botões nativos (Tab/Enter/Espaço) que alternam aria-pressed", async () => {
    await act(async () =>
      root.render(
        <BetSlipProvider matchId={MATCH_ID}>
          <MarketTable grid={grid()} />
        </BetSlipProvider>,
      ),
    );
    const cell = Array.from(container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")).find(
      (b) => b.textContent?.startsWith("Empate"),
    )!;
    expect(cell.type).toBe("button");
    expect(cell.getAttribute("aria-pressed")).toBe("false");
    await act(async () => cell.click());
    expect(cell.getAttribute("aria-pressed")).toBe("true");
    await act(async () => cell.click());
    expect(cell.getAttribute("aria-pressed")).toBe("false");
  });

  it("ao vivo, tocar numa célula NÃO pré-preenche a odd de antes do jogo", async () => {
    const odds = () =>
      Array.from(container.querySelectorAll<HTMLInputElement>('input[inputmode="decimal"]')).map(
        (i) => i.value,
      );
    const homeCell = () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")).find((b) =>
        /^Flamengo(?! ou)/.test(b.textContent ?? ""),
      )!;
    // Pré-jogo: a referência entra pré-preenchida.
    await act(async () =>
      root.render(
        <BetSlipProvider matchId={MATCH_ID}>
          <MarketTable grid={grid()} />
          <SlipPanel />
        </BetSlipProvider>,
      ),
    );
    await act(async () => homeCell().click());
    expect(odds()[0]).toBe("2,10");
    await act(async () => root.unmount());
    root = createRoot(container);
    // Ao vivo: o campo fica vazio, a pessoa digita a odd que pegou.
    await act(async () =>
      root.render(
        <BetSlipProvider matchId={MATCH_ID}>
          <MarketTable grid={liveGrid()} />
          <SlipPanel />
        </BetSlipProvider>,
      ),
    );
    await act(async () => homeCell().click());
    expect(homeCell().getAttribute("aria-pressed")).toBe("true");
    expect(odds()[0]).toBe("");
    expect(container.textContent).toContain("odd que você pegou");
  });
});
