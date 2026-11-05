import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UpcomingMatchesDesktop } from "@/components/upcoming-matches-desktop";
import { UpcomingMatchesMobile } from "@/components/upcoming-matches-mobile";
import {
  ROW_ANALYZE_TITLE,
  ROW_REANALYZE_TITLE,
  resetRowStatesForTests,
} from "@/components/match-list/row-analyze";
import {
  PALPITE_RUN_ENDPOINT,
  getRun,
  resetRunStoreForTests,
  resumeRun,
} from "@/components/palpites/palpite-run-store";
import { encodeStreamMessage, type StreamMessage } from "@/lib/ai/progress/protocol";
import { canAnalyzeFromList } from "@/lib/view/match-list";
import type { MatchListRowView } from "@/lib/view/types";

// "analisar" direto na lista de jogos: o mesmo run da página do jogo (rota de streaming),
// com o selo no lugar do "analisado".

function row(over: Partial<MatchListRowView> = {}): MatchListRowView {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    home: { name: "Palmeiras", fullName: "SE Palmeiras", short: "PAL", hue: 120 },
    away: { name: "Flamengo", fullName: "CR Flamengo", short: "FLA", hue: 210 },
    league: "brasileirao_a",
    kickoff: "amanhã, 16:00",
    when: "amanhã",
    odds: {
      outcomes: [
        { label: "PAL", odd: "2,10" },
        { label: "Empate", odd: "3,30" },
        { label: "FLA", odd: "3,60" },
      ],
    },
    hasPrediction: false,
    status: "scheduled",
    isInProgress: false,
    analyzable: true,
    homeScore: null,
    awayScore: null,
    day: { key: "2026-11-05", label: "Amanhã" },
    time: "16:00",
    ...over,
  } as MatchListRowView;
}

describe("canAnalyzeFromList", () => {
  it("só pré-jogo analisável e com odd publicada (já analisado entra: reanalisar)", () => {
    expect(canAnalyzeFromList(row())).toBe(true);
    expect(canAnalyzeFromList(row({ hasPrediction: true }))).toBe(true);
    expect(canAnalyzeFromList(row({ odds: null }))).toBe(false);
    expect(canAnalyzeFromList(row({ analyzable: false }))).toBe(false);
    expect(canAnalyzeFromList(row({ isInProgress: true }))).toBe(false);
    expect(canAnalyzeFromList(row({ status: "live" }))).toBe(false);
    expect(canAnalyzeFromList(row({ status: "finished", analyzable: false }))).toBe(false);
  });
});

describe("selo na linha (render do servidor)", () => {
  const both = (m: MatchListRowView, analyzeEnabled: boolean) => [
    renderToStaticMarkup(<UpcomingMatchesDesktop matches={[m]} analyzeEnabled={analyzeEnabled} />),
    renderToStaticMarkup(<UpcomingMatchesMobile matches={[m]} analyzeEnabled={analyzeEnabled} />),
  ];

  it("mostra 'analisar' com o aviso do limite, fora do link do jogo", () => {
    for (const html of both(row(), true)) {
      expect(html).toContain('aria-label="Analisar com IA"');
      expect(html).toContain(`title="${ROW_ANALYZE_TITLE}"`);
      // Botão dentro de <a> é HTML inválido: o link fecha antes do botão.
      const link = html.slice(html.indexOf("<a "), html.indexOf("</a>"));
      expect(link).not.toContain("<button");
    }
  });

  it("sem o botão com a flag desligada, em jogo sem odd ou ao vivo", () => {
    const cases: [MatchListRowView, boolean][] = [
      [row(), false],
      [row({ odds: null }), true],
      [row({ isInProgress: true }), true],
      [row({ hasPrediction: true }), false],
    ];
    for (const [m, enabled] of cases) {
      for (const html of both(m, enabled)) expect(html).not.toContain("<button");
    }
  });

  it("'analisado' segue no mesmo lugar", () => {
    for (const html of both(row({ hasPrediction: true }), true)) {
      expect(html).toContain("analisado");
    }
  });

  it("já analisado: 'reanalisar' no desktop e o menu do 'analisado' no celular", () => {
    const m = row({ hasPrediction: true });
    const desktop = renderToStaticMarkup(
      <UpcomingMatchesDesktop matches={[m]} analyzeEnabled />,
    );
    expect(desktop).toContain('aria-label="Analisar com IA de novo"');
    expect(desktop).toContain(`title="${ROW_REANALYZE_TITLE}"`);
    const below = renderToStaticMarkup(
      <UpcomingMatchesDesktop matches={[m]} analyzeEnabled placement="embaixo" />,
    );
    expect(below).toContain(">reanalisar<");
    const mobile = renderToStaticMarkup(<UpcomingMatchesMobile matches={[m]} analyzeEnabled />);
    expect(mobile).toContain('aria-label="Analisado: ver palpite ou reanalisar"');
    expect(mobile).not.toContain('aria-label="Analisar com IA de novo"');
  });

  it("posição no desktop: ícone no lugar da setinha (padrão) ou botão largo embaixo das odds", () => {
    const side = renderToStaticMarkup(<UpcomingMatchesDesktop matches={[row()]} analyzeEnabled />);
    expect(side).toContain("grid-cols-[132px_1fr_auto_32px]");
    expect(side).not.toContain(">analisar<");
    const below = renderToStaticMarkup(
      <UpcomingMatchesDesktop matches={[row()]} analyzeEnabled placement="embaixo" />,
    );
    expect(below).toContain("grid-cols-[132px_1fr_auto_24px]");
    expect(below).toContain(">analisar<");
  });

  it("palpite feito: veredito e placar no meio da linha (desktop), no lugar do selo", () => {
    const m = row({
      hasPrediction: true,
      palpite: {
        verdict: "Palmeiras vence em casa",
        probableScore: { home: 2, away: 1 },
        confidence: "media",
        narrative: "O Palmeiras chega embalado.",
      },
    });
    const desktop = renderToStaticMarkup(<UpcomingMatchesDesktop matches={[m]} analyzeEnabled />);
    expect(desktop).toContain("Palmeiras vence em casa");
    expect(desktop).toContain("2–1");
    expect(desktop).toContain("O Palmeiras chega embalado.");
    expect(desktop).not.toContain(">analisado<");
  });
});

describe("run pela linha", () => {
  let container: HTMLDivElement;
  let root: Root;
  const refresh = vi.fn();
  const router = { refresh, prefetch: vi.fn(), push: vi.fn(), replace: vi.fn() };
  let release: (() => void) | null = null;

  // A rota de streaming: as etapas saem já; o resultado só depois de `release()`.
  function streamingFetch(result: StreamMessage) {
    return vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe(PALPITE_RUN_ENDPOINT);
      const fd = init.body as FormData;
      expect(fd.get("intent")).toBe("analysis");
      expect(fd.get("matchId")).toBe(row().id);
      expect(fd.get("pageLive")).toBe("0");
      const enc = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(enc.encode(encodeStreamMessage({ t: "run", id: "r1" })));
          c.enqueue(
            enc.encode(
              encodeStreamMessage({
                t: "step",
                id: "odds",
                status: "active",
                label: "Lendo os preços do mercado",
              }),
            ),
          );
          release = () => {
            c.enqueue(enc.encode(encodeStreamMessage(result)));
            c.close();
          };
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "application/x-ndjson" },
      });
    });
  }

  async function settle() {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
  }

  // As duas árvores montadas, como na página (o CSS esconde uma delas).
  function mount(analyzeEnabled = true) {
    act(() => {
      root.render(
        <AppRouterContext.Provider value={router as unknown as AppRouterInstance}>
          <UpcomingMatchesDesktop matches={[row()]} analyzeEnabled={analyzeEnabled} />
          <UpcomingMatchesMobile matches={[row()]} analyzeEnabled={analyzeEnabled} />
        </AppRouterContext.Provider>,
      );
    });
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    resetRunStoreForTests({ pollMs: 0 });
    resetRowStatesForTests();
    refresh.mockClear();
    release = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("mostra a etapa durante o run e vira 'analisado' no fim, relendo a lista", async () => {
    vi.stubGlobal(
      "fetch",
      streamingFetch({ t: "result", outcome: { ok: true, analysis: true } }),
    );
    mount();
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Analisar com IA"]')!;
    expect(container.querySelectorAll('button[aria-label="Analisar com IA"]')).toHaveLength(2);
    await act(async () => {
      button.click();
      await settle();
    });
    expect(container.textContent).toContain("analisando");
    expect(container.textContent).toContain("Lendo os preços do mercado");
    expect(container.querySelector('button[aria-label="Analisar com IA"]')).toBeNull();
    // Celular: "analisando" abre as etapas; desktop: "ver progresso".
    expect(container.querySelector('button[aria-label="Ver o progresso da análise"]')).not.toBeNull();
    expect(container.textContent).toContain("ver progresso");

    await act(async () => {
      release!();
      await settle();
    });
    expect(container.textContent).toContain("analisado");
    expect(container.textContent).not.toContain("Lendo os preços do mercado");
    expect(container.querySelector('button[aria-label="Analisar com IA"]')).toBeNull();
    // Já analisado: o desktop oferece reanalisar; o celular, o menu do "analisado".
    expect(container.querySelector('button[aria-label="Analisar com IA de novo"]')).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="Analisado: ver palpite ou reanalisar"]'),
    ).not.toBeNull();
    // Uma releitura só, mesmo com as duas árvores olhando o mesmo jogo; e o run sai do
    // store (o HERO não reabre as etapas de um run já visto na lista).
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(getRun(row().id)).toBeNull();
  });

  it("run sem desfecho conhecido volta pro 'analisar' (não finge 'analisado')", async () => {
    // Run retomado (F5 na página do jogo) cujo marcador sumiu: o store desiste sem desfecho.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ run: null })),
    );
    mount();
    await act(async () => {
      resumeRun(
        row().id,
        { runId: "r9", intent: "analysis", live: false, startedAt: Date.now(), status: "running", steps: [], outcome: null },
        null,
      );
      await settle();
    });
    expect(container.textContent).not.toContain("analisado");
    expect(container.querySelectorAll('button[aria-label="Analisar com IA"]')).toHaveLength(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("falha mostra a mensagem e o 'tentar de novo'", async () => {
    vi.stubGlobal(
      "fetch",
      streamingFetch({
        t: "result",
        outcome: { ok: false, error: "Você atingiu o limite de 10 análises por dia." },
      }),
    );
    mount();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Analisar com IA"]')!.click();
      await settle();
      release!();
      await settle();
    });
    expect(container.textContent).toContain("Você atingiu o limite de 10 análises por dia.");
    expect(
      container.querySelector('button[aria-label="Tentar a análise com IA de novo"]'),
    ).not.toBeNull();
    expect(refresh).not.toHaveBeenCalled();
    // Sem o botão (flag desligada), a falha antiga não aparece nem oferece "tentar de novo".
    mount(false);
    expect(container.textContent).not.toContain("limite");
    expect(container.querySelector("button")).toBeNull();
  });
});
