import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/predictions", () => ({ runPalpiteHero: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
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
    canOpenAnalysis: true,
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

const readMore = () =>
  Array.from(container.querySelectorAll("button")).find((b) =>
    /^Ler (mais|menos)$/.test(b.textContent ?? "")
  ) ?? null;

const narrative = () =>
  Array.from(container.querySelectorAll("p")).find(
    (p) => p.textContent === PALPITE.narrative
  )!;

const toggle = () =>
  Array.from(container.querySelectorAll("button")).find((b) =>
    /análise completa/.test(b.textContent ?? "")
  ) ?? null;

describe("PalpiteArea — Ler análise completa (#576)", () => {
  it("botão só com análise para abrir", () => {
    const none = renderToStaticMarkup(
      <PalpiteArea
        {...props({
          heroPalpite: null,
          hasAnalyses: false,
          canOpenAnalysis: false,
        })}
      />
    );
    expect(none).not.toContain("Ler análise completa");
    expect(none).not.toContain('data-testid="slot"');
    // Palpite sem análise para abrir: o palpite abre pelo próprio "Ler mais".
    const palpiteOnly = renderToStaticMarkup(
      <PalpiteArea {...props({ hasAnalyses: false, canOpenAnalysis: false })} />
    );
    expect(palpiteOnly).not.toContain("Ler análise completa");
    expect(palpiteOnly).toContain("Ler mais");
    expect(
      renderToStaticMarkup(<PalpiteArea {...props({ heroPalpite: null })} />)
    ).toContain("Ler análise completa");
  });

  it("depois do apito, sem palpite e sem leitura ao vivo: a análise de pré-jogo ainda abre", () => {
    // Flag desligada, jogo começado/encerrado: nada a regenerar (hasAnalyses=false),
    // mas há análise de pré-jogo pra ler.
    const html = renderToStaticMarkup(
      <PalpiteArea
        {...props({
          heroPalpite: null,
          setId: null,
          unavailable: "finished",
          hasAnalyses: false,
          canOpenAnalysis: true,
        })}
      />
    );
    expect(html).toContain("Ler análise completa");
    expect(html).toContain('data-testid="slot"');
  });

  it("fechado por padrão; abrir alterna aria-expanded e hidden, sem mexer no palpite", async () => {
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
    // O palpite continua compacto: abrir a análise não abre o texto dele.
    expect(container.textContent).not.toContain("a partir de:");
    expect(narrative().className).toContain("line-clamp-2");
    expect(readMore()!.getAttribute("aria-expanded")).toBe("false");

    await act(async () => toggle()!.click());
    expect(region.hidden).toBe(true);
  });

  it("'Ler mais' abre o palpite inteiro sem abrir a análise", async () => {
    await act(async () => root.render(<PalpiteArea {...props()} />));
    const region = container.querySelector<HTMLElement>("#analise-completa")!;
    const button = readMore()!;
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    const detail = document.getElementById(button.getAttribute("aria-controls")!)!;
    expect(detail.contains(narrative())).toBe(true);
    expect(narrative().className).toContain("line-clamp-2");

    await act(async () => button.click());
    expect(readMore()!.textContent).toBe("Ler menos");
    expect(readMore()!.getAttribute("aria-expanded")).toBe("true");
    expect(narrative().className).not.toContain("line-clamp-2");
    expect(container.textContent).toContain("a partir de:");
    expect(region.hidden).toBe(true);
    expect(toggle()!.getAttribute("aria-expanded")).toBe("false");

    // E vice-versa: fechar o palpite com a análise aberta deixa a análise aberta.
    await act(async () => toggle()!.click());
    await act(async () => readMore()!.click());
    expect(narrative().className).toContain("line-clamp-2");
    expect(region.hidden).toBe(false);
  });

  it("sem ficha e com texto curto, sem 'Ler mais' (nada a abrir)", () => {
    const html = renderToStaticMarkup(
      <PalpiteArea
        {...props({ heroPalpite: { ...PALPITE, citedMarkets: [] } })}
      />
    );
    expect(html).not.toContain("Ler mais");
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

describe("PalpiteArea — palpite anterior à escalação (#619)", () => {
  it("uma linha no HERO, só texto, sem número de valor", () => {
    const markup = renderToStaticMarkup(
      <PalpiteArea {...props({ lineupNotice: "Palpite gerado antes da escalação." })} />
    );
    const hero = markup.slice(0, markup.indexOf('data-testid="slot"'));
    expect(hero).toContain("Palpite gerado antes da escalação.");
    const line = hero.match(/data-testid="palpite-lineup-notice"[^>]*>(.*?)<\/p>/)?.[1] ?? "";
    const lineText = line.replace(/<svg.*?<\/svg>/g, "").replace(/<[^>]+>/g, "");
    expect(lineText).toBe("Palpite gerado antes da escalação.");
    expect(lineText).not.toMatch(/\d/);
  });

  it("sem aviso, nada", () => {
    expect(renderToStaticMarkup(<PalpiteArea {...props()} />)).not.toContain(
      "palpite-lineup-notice"
    );
  });
});
