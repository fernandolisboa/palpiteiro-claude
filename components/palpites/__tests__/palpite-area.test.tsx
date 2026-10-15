import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/predictions", () => ({ runPalpiteHero: vi.fn() }));
vi.mock("@/app/actions/share", () => ({
  shareSet: vi.fn(),
  unshareSet: vi.fn(),
}));

import { PalpiteArea } from "@/components/palpites/palpite-area";
import type { PalpiteHeadlineView } from "@/lib/view/palpites-headline";

const PALPITE: PalpiteHeadlineView = {
  verdict: "Pra mim vai dar Palmeiras",
  probableScore: { home: 2, away: 1 },
  confidence: "media",
  narrative: "O Verdão vem melhor em casa.",
  citedMarkets: ["Resultado (1X2)"],
  badge: null,
  dimensions: [],
};

// Slot da análise com número de valor de propósito: ele NUNCA pode cair dentro da casca
// quente (firewall ADR 0030).
const SLOT = <div data-testid="slot">odd 2,10 · stake 1u</div>;

type Props = Parameters<typeof PalpiteArea>[0];
function props(over: Partial<Props> = {}): Props {
  return {
    heroPalpite: PALPITE,
    matchId: "11111111-1111-1111-1111-111111111111",
    unavailable: null,
    fanOutEnabled: true,
    finalScore: null,
    setId: "22222222-2222-2222-2222-222222222222",
    sharedAt: null,
    hasAnalyses: true,
    contextEnabled: false,
    analysis: SLOT,
    ...over,
    // Capacidade (ADR 0060): nos testes de antes, analisável = pré-jogo.
    analyzable: over.analyzable ?? (over.unavailable ?? null) === null,
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
});

const toggle = () =>
  Array.from(container.querySelectorAll("button")).find((b) =>
    /análise completa/.test(b.textContent ?? "")
  ) ?? null;

describe("PalpiteArea — Ler análise completa (#576)", () => {
  it("botão só com palpite ou análise", () => {
    const none = renderToStaticMarkup(
      <PalpiteArea {...props({ heroPalpite: null, hasAnalyses: false })} />
    );
    expect(none).not.toContain("Ler análise completa");
    expect(none).not.toContain('data-testid="slot"');
    expect(
      renderToStaticMarkup(<PalpiteArea {...props({ hasAnalyses: false })} />)
    ).toContain("Ler análise completa");
    expect(
      renderToStaticMarkup(<PalpiteArea {...props({ heroPalpite: null })} />)
    ).toContain("Ler análise completa");
  });

  it("fechado por padrão; abrir alterna aria-expanded, hidden e o HERO inteiro", async () => {
    await act(async () => root.render(<PalpiteArea {...props()} />));
    const region = container.querySelector<HTMLElement>("#analise-completa")!;
    const button = toggle()!;
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-controls")).toBe("analise-completa");
    expect(region.hidden).toBe(true);
    expect(region.getAttribute("role")).toBe("region");
    // O nome da região vem do h2 dentro dela (sempre presente, mesmo sem análise).
    const titleId = region.getAttribute("aria-labelledby")!;
    expect(region.querySelector(`h2#${titleId}`)?.textContent).toBe(
      "Análise completa"
    );
    // O slot fica no DOM mesmo fechado (busca, leitor de tela ao abrir).
    expect(region.querySelector('[data-testid="slot"]')).not.toBeNull();
    expect(container.textContent).not.toContain("a partir de:");

    await act(async () => button.click());
    expect(toggle()!.getAttribute("aria-expanded")).toBe("true");
    expect(toggle()!.textContent).toContain("Fechar análise completa");
    expect(region.hidden).toBe(false);
    expect(container.textContent).toContain("a partir de:");

    await act(async () => toggle()!.click());
    expect(region.hidden).toBe(true);
  });

  it("o slot da análise fica FORA da casca quente do palpite e do <form> do HERO", async () => {
    await act(async () => root.render(<PalpiteArea {...props()} />));
    const shell = container.querySelector('section[aria-label="palpite"]')!;
    expect(shell).not.toBeNull();
    expect(shell.querySelector('[data-testid="slot"]')).toBeNull();
    expect(container.querySelector("form")!.contains(toggle())).toBe(false);
    expect(
      container.querySelector("form")!.querySelector('[data-testid="slot"]')
    ).toBeNull();
  });
});
