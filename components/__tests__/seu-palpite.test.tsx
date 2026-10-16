import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Server actions "use server": mocks leves pra não puxar o servidor no env de teste.
vi.mock("@/app/actions/user-palpite", () => ({ analyzeUserPalpite: vi.fn() }));
vi.mock("@/app/actions/bet-slip", () => ({ registerBetSlip: vi.fn() }));
vi.mock("@/app/actions/bets", () => ({ parseBet: vi.fn() }));

import { analyzeUserPalpite } from "@/app/actions/user-palpite";
import { BetSlipProvider } from "@/components/bet-slip/bet-slip-provider";
import { MarketTable } from "@/components/bet-slip/market-table";
import { SlipMobileBar } from "@/components/bet-slip/slip-mobile-bar";
import { SlipPanel } from "@/components/bet-slip/slip-panel";
import { SeuPalpite } from "@/components/seu-palpite";
import { MAX_SLIP_SELECTIONS } from "@/lib/bets/slip-markets";
import { scorelineMatrix } from "@/lib/quant/scoreline-model";
import { ptPct, readingMatrix, readPalpite } from "@/lib/user-palpite/reading";
import { toBetGridView } from "@/lib/view/bet-slip";
import type { SeuPalpiteModelView, UserPalpiteAnalysisView } from "@/lib/view/user-palpite";

const MATCH_ID = "11111111-1111-1111-1111-111111111111";
const TEAMS = { home: "Flamengo", away: "Palmeiras" };
const MODEL: SeuPalpiteModelView = {
  lambdaHome: 1.6,
  lambdaAway: 1.0,
  rho: null,
  modelLabel: "Dixon-Coles · JEV aplicado",
  jevApplied: true,
  inPlay: null,
};

const ROWS = {
  palpiteTitle: "Chance desse placar",
  palpitePct: "9,1%",
  rank: "4º placar mais provável",
  result: { title: "Chance de vitória do Flamengo", pct: "48,2%" },
  oneXTwo: { home: "48,2%", draw: "26,0%", away: "25,8%" },
  topTitle: "placares mais prováveis",
  top: [{ label: "1 × 0", pct: "12,1%", isPalpite: false }],
  sentence: "Pelo modelo, 2 × 0 tem 9,1%.",
};

const ANALYSIS: UserPalpiteAnalysisView = {
  id: "a1",
  createdAgo: "há 5min",
  palpite: { kind: "score", home: 2, away: 0 },
  palpiteLabel: "Flamengo 2 × 0 Palmeiras",
  verdict: "em_parte",
  liveLabel: null,
  verdictLabel: "o modelo concorda em parte",
  verdictHeadline: "Flamengo 2 × 0 Palmeiras é o 4º placar mais provável (9,1%)",
  resumo: "O modelo vê o Flamengo favorito, mas 2 × 0 é só o 4º placar.",
  pontos: ["A forma do Flamengo não confere com os nossos dados."],
  discordancias: [{ claimText: "o Flamengo vem de três vitórias", texto: "Foram 1V 2E 2D." }],
  claims: [
    {
      index: 0,
      text: "o jogador citado, atacante, está fora",
      topicLabel: "desfalque",
      status: "unverifiable",
      statusLabel: "não verificável",
      evidence: "Não está na nossa lista de desfalques do Palmeiras.",
      effect: "efeito no modelo: ataque do Palmeiras ajustado para baixo",
      players: [],
    },
    {
      index: 1,
      text: "o Flamengo vem de três vitórias",
      topicLabel: "momento",
      status: "contradicted",
      statusLabel: "contradita",
      evidence: "Últimos 5 jogos do Flamengo: 1V 2E 2D.",
      effect: "sem efeito no modelo",
      players: [],
    },
    {
      index: 2,
      text: "o Palmeiras tem desfalques",
      topicLabel: "desfalque",
      status: "confirmed",
      statusLabel: "confirmada",
      evidence: "Confere com a nossa lista.",
      effect: "já considerado pelo modelo",
      players: [],
    },
  ],
  without: ROWS,
  with: { ...ROWS, palpitePct: "9,4%" },
  changed: true,
  modelLabel: "Dixon-Coles · JEV aplicado",
  jevApplied: true,
  narrationSource: "llm",
  showFullSquadNote: true,
  showUnverifiedNote: true,
  warnings: [],
};

type Props = Parameters<typeof SeuPalpite>[0];
function props(over: Partial<Props> = {}): Props {
  return {
    matchId: MATCH_ID,
    teams: TEAMS,
    model: MODEL,
    latest: null,
    aiEnabled: true,
    ...over,
  };
}

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

async function mount(node: React.ReactNode) {
  await act(async () => root.render(node));
}

function button(label: string | RegExp): HTMLButtonElement {
  const b = Array.from(container.querySelectorAll("button")).find((el) =>
    typeof label === "string"
      ? el.textContent?.trim() === label || el.getAttribute("aria-label") === label
      : label.test(el.textContent ?? ""),
  );
  if (!b) throw new Error(`botão não encontrado: ${label}`);
  return b;
}

async function click(b: HTMLElement) {
  await act(async () => b.click());
}

describe("SeuPalpite — leitura grátis pelos botões", () => {
  it("escolher 2 × 0 mostra a chance de readPalpite, sem round-trip", async () => {
    await mount(<SeuPalpite {...props()} />);
    expect(container.querySelector('[data-testid="seu-palpite-reading"]')).toBeNull();
    await click(button("2 gols do Flamengo"));
    await click(button("0 gols do Palmeiras"));
    const expected = readPalpite(
      { matrix: readingMatrix(MODEL), lambdaHome: 1.6, lambdaAway: 1.0 },
      { kind: "score", home: 2, away: 0 },
    );
    const text = container.textContent ?? "";
    expect(text).toContain(`Chance desse placar:${ptPct(expected.palpitePct)}`);
    expect(text).toContain("modelo Dixon-Coles · JEV aplicado");
    expect(analyzeUserPalpite).not.toHaveBeenCalled();
  });

  it("resultado: Vitória do mandante mostra a chance do resultado", async () => {
    await mount(<SeuPalpite {...props()} />);
    await click(button("Resultado"));
    await click(button("Vitória do Flamengo"));
    const expected = readPalpite(
      { matrix: scorelineMatrix(1.6, 1.0), lambdaHome: 1.6, lambdaAway: 1.0 },
      { kind: "result", selection: "home" },
    );
    expect(container.textContent).toContain(
      `Chance de vitória do Flamengo:${ptPct(expected.palpitePct)}`,
    );
  });

  it("outro placar: os selects + Usar placar escolhem 7 × 1", async () => {
    await mount(<SeuPalpite {...props()} />);
    const [home, away] = Array.from(container.querySelectorAll("select"));
    await act(async () => {
      home.value = "7";
      home.dispatchEvent(new Event("change", { bubbles: true }));
      away.value = "1";
      away.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click(button("Usar placar"));
    const hidden = container.querySelector<HTMLInputElement>('input[name="palpite"]');
    expect(JSON.parse(hidden!.value)).toEqual({ kind: "score", home: 7, away: 1 });
  });

  it("Analisar meu palpite fica desabilitado sem palpite ou com motivo curto", async () => {
    await mount(<SeuPalpite {...props()} />);
    const submit = button("Analisar meu palpite");
    expect(submit.disabled).toBe(true);
    await click(button("1 gols do Flamengo"));
    await click(button("1 gols do Palmeiras"));
    expect(submit.disabled).toBe(true);
    const textarea = container.querySelector("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(textarea, "o Flamengo vem bem");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(submit.disabled).toBe(false);
    expect(container.textContent).toContain("18/1000");
  });

  it("aiEnabled=false esconde o form e mostra a copy", () => {
    const html = renderToStaticMarkup(<SeuPalpite {...props({ aiEnabled: false })} />);
    expect(html).not.toContain("Analisar meu palpite");
    expect(html).not.toContain("<textarea");
    expect(html).toContain(
      "A análise do motivo está desligada no momento. A leitura pelos botões continua valendo.",
    );
  });

  it("model=null mostra o estado vazio, sem botões nem form", () => {
    const html = renderToStaticMarkup(<SeuPalpite {...props({ model: null })} />);
    expect(html).toContain("Ainda não temos o modelo deste jogo.");
    expect(html).not.toContain("Placar");
    expect(html).not.toContain("<form");
  });
});

describe("SeuPalpite — ao vivo (#594)", () => {
  const LIVE_MODEL: SeuPalpiteModelView = {
    ...MODEL,
    inPlay: {
      score: { home: 1, away: 0 },
      r: 0.35,
      multipliers: { home: 1, away: 1 },
      minuteLabel: "63'",
    },
  };

  it("lê do placar final a partir do atual; gols abaixo dele 'já passou'", async () => {
    await mount(<SeuPalpite {...props({ model: LIVE_MODEL })} />);
    expect(container.textContent).toContain("Leitura ao vivo");
    expect(button("0 gols do Flamengo: já passou").disabled).toBe(true);
    expect(button("1 gols do Flamengo").disabled).toBe(false);
    await click(button("2 gols do Flamengo"));
    await click(button("0 gols do Palmeiras"));
    const expected = readPalpite(
      { matrix: readingMatrix(LIVE_MODEL), lambdaHome: 1.6, lambdaAway: 1.0 },
      { kind: "score", home: 2, away: 0 },
    );
    expect(container.textContent).toContain(`Chance desse placar:${ptPct(expected.palpitePct)}`);
    // A página foi montada ao vivo: o form avisa o servidor.
    const pageLive = container.querySelector<HTMLInputElement>('input[name="pageLive"]');
    expect(pageLive?.value).toBe("1");
  });

  it("outro placar abaixo do atual: aviso de que já passou, sem leitura nem análise", async () => {
    await mount(<SeuPalpite {...props({ model: { ...LIVE_MODEL, inPlay: { ...LIVE_MODEL.inPlay!, score: { home: 2, away: 1 } } } })} />);
    // O padrão do "outro placar" é 1 × 0: abaixo de 2 × 1.
    await click(button("Usar placar"));
    expect(container.textContent).toContain("Esse placar já passou");
    expect(container.querySelector('[data-testid="seu-palpite-reading"]')).toBeNull();
    const hidden = container.querySelector<HTMLInputElement>('input[name="palpite"]');
    expect(hidden?.value).toBe("");
  });

  it("pré-jogo: sem 'já passou' e pageLive=0", () => {
    const html = renderToStaticMarkup(<SeuPalpite {...props()} />);
    expect(html).not.toContain("já passou");
    expect(html).not.toContain("Leitura ao vivo");
    expect(html).toContain('name="pageLive" value="0"');
  });
});

describe("SeuPalpite — ponte com Suas apostas", () => {
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

  // A página: um provider envolve a tabela, o painel e o "Seu palpite" (#576).
  const page = (withTable = true) => (
    <BetSlipProvider matchId={MATCH_ID}>
      <SeuPalpite {...props()} />
      {withTable && <MarketTable grid={grid} />}
      <SlipPanel />
      <SlipMobileBar />
    </BetSlipProvider>
  );

  it("Adicionar às suas apostas põe a perna na lista de Suas apostas", async () => {
    await mount(page());
    await click(button("2 gols do Flamengo"));
    await click(button("0 gols do Palmeiras"));
    await click(button("Adicionar às suas apostas"));
    const text = container.textContent ?? "";
    expect(text).toContain("Adicionado em Suas apostas.");
    expect(text).toContain("suas apostas (1)");
    expect(text).toContain("Placar exato: Flamengo 2 × 0 Palmeiras");
    // A barra do celular aparece e, já montada, põe o espaçador no fim do <body>.
    expect(
      document.body.querySelector('div[aria-hidden="true"][class^="h-[calc(3.0625rem"]'),
    ).not.toBeNull();
  });

  it("adicionar de novo não diz 'adicionado': avisa que já está (#564 review)", async () => {
    await mount(page());
    await click(button("2 gols do Flamengo"));
    await click(button("0 gols do Palmeiras"));
    await click(button("Adicionar às suas apostas"));
    await click(button("Adicionar às suas apostas"));
    const text = container.textContent ?? "";
    expect(text).toContain("Já está em Suas apostas.");
    expect(text).not.toContain("Adicionado em Suas apostas.");
    expect(text).toContain("suas apostas (1)");
  });

  it("lista cheia: avisa o limite em vez de 'adicionado' (#564 review)", async () => {
    await mount(page());
    const scores = [0, 1, 2, 3, 4].flatMap((h) => [0, 1].map((a) => [h, a] as const));
    for (const [h, a] of scores.slice(0, MAX_SLIP_SELECTIONS)) {
      await click(button(`${h} gols do Flamengo`));
      await click(button(`${a} gols do Palmeiras`));
      await click(button("Adicionar às suas apostas"));
      expect(container.textContent).toContain("Adicionado em Suas apostas.");
    }
    const [h, a] = scores[MAX_SLIP_SELECTIONS];
    await click(button(`${h} gols do Flamengo`));
    await click(button(`${a} gols do Palmeiras`));
    await click(button("Adicionar às suas apostas"));
    const text = container.textContent ?? "";
    expect(text).not.toContain("Adicionado em Suas apostas.");
    expect(text).toContain(`No máximo ${MAX_SLIP_SELECTIONS} seleções por vez.`);
    expect(text).toContain(`suas apostas (${MAX_SLIP_SELECTIONS})`);
  });

  it("resultado vira a perna 1X2 da grade", async () => {
    await mount(page());
    await click(button("Resultado"));
    await click(button("Empate"));
    await click(button("Adicionar às suas apostas"));
    expect(container.textContent).toContain("suas apostas (1)");
  });

  it("sem a tabela registrada: avisa que a lista ainda está carregando", async () => {
    await mount(page(false));
    await click(button("Resultado"));
    await click(button("Vitória do Palmeiras"));
    await click(button("Adicionar às suas apostas"));
    expect(container.textContent).toContain(
      "A lista de apostas ainda está carregando. Tente de novo em instantes.",
    );
  });

  it("no celular abre a folha; no desktop só a mensagem (o painel está à vista)", async () => {
    // Celular (jsdom não tem matchMedia → ramo da folha): o painel aparece na folha.
    await mount(page());
    await click(button("Resultado"));
    await click(button("Empate"));
    await click(button("Adicionar às suas apostas"));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => root.unmount());

    // Desktop (lg): nada de folha nem de rolagem; a mensagem fica onde o usuário clicou.
    const scroll = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q === "(min-width: 1024px)" }));
    try {
      root = createRoot(container);
      await mount(page());
      await click(button("Resultado"));
      await click(button("Empate"));
      await click(button("Adicionar às suas apostas"));
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(scroll).not.toHaveBeenCalled();
      expect(container.textContent).toContain("Adicionado em Suas apostas.");
      expect(container.textContent).toContain("suas apostas (1)");
    } finally {
      vi.unstubAllGlobals();
      Element.prototype.scrollIntoView = original;
    }
  });
});

describe("SeuPalpite — análise gravada", () => {
  it("renderiza os três chips, as duas colunas, as notas e o rodapé", () => {
    const html = renderToStaticMarkup(<SeuPalpite {...props({ latest: ANALYSIS })} />);
    expect(html).toContain("sua última análise · há 5min");
    expect(html).toContain("o modelo concorda em parte");
    for (const chip of ["confirmada", "contradita", "não verificável"]) {
      expect(html).toContain(`>${chip}</span>`);
    }
    expect(html).toContain("sem o seu contexto");
    expect(html).toContain("com o seu contexto");
    expect(html).toContain("9,4%");
    expect(html).toContain("efeito no modelo: ataque do Palmeiras ajustado para baixo");
    expect(html).toContain("já considerado pelo modelo");
    expect(html).toContain("Não verificável: não temos esse dado; entrou com peso menor.");
    expect(html).toContain("não aumenta a chance no modelo");
    expect(html).toContain("modelo Dixon-Coles · JEV aplicado · texto por IA");
  });

  it("depois de analisar, mostra o retorno da action", async () => {
    vi.mocked(analyzeUserPalpite).mockResolvedValue({ ok: true, analysis: ANALYSIS });
    await mount(<SeuPalpite {...props()} />);
    await click(button("2 gols do Flamengo"));
    await click(button("0 gols do Palmeiras"));
    const textarea = container.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        textarea,
        "o Flamengo vem de três vitórias",
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector("form")!.requestSubmit(button("Analisar meu palpite"));
    });
    await act(async () => {});
    expect(analyzeUserPalpite).toHaveBeenCalledTimes(1);
    const fd = vi.mocked(analyzeUserPalpite).mock.calls[0][1];
    expect(fd.get("matchId")).toBe(MATCH_ID);
    expect(JSON.parse(String(fd.get("palpite")))).toEqual({ kind: "score", home: 2, away: 0 });
    expect(fd.get("reason")).toBe("o Flamengo vem de três vitórias");
    expect(container.querySelector('[data-testid="seu-palpite-analysis"]')).not.toBeNull();
  });
});
