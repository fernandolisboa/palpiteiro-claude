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
import { ROW_ANALYZE_TITLE } from "@/components/match-list/row-analyze";
import {
  PALPITE_RUN_ENDPOINT,
  resetRunStoreForTests,
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
  it("só pré-jogo analisável, não analisado e com odd publicada", () => {
    expect(canAnalyzeFromList(row())).toBe(true);
    expect(canAnalyzeFromList(row({ hasPrediction: true }))).toBe(false);
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

  it("sem o botão com a flag desligada, em jogo sem odd, ao vivo ou já analisado", () => {
    const cases: [MatchListRowView, boolean][] = [
      [row(), false],
      [row({ odds: null }), true],
      [row({ isInProgress: true }), true],
      [row({ hasPrediction: true }), true],
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

  function mount() {
    act(() => {
      root.render(
        <AppRouterContext.Provider value={router as unknown as AppRouterInstance}>
          <UpcomingMatchesDesktop matches={[row()]} analyzeEnabled />
        </AppRouterContext.Provider>,
      );
    });
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    resetRunStoreForTests({ pollMs: 0 });
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
    await act(async () => {
      button.click();
      await settle();
    });
    expect(container.textContent).toContain("analisando");
    expect(container.textContent).toContain("Lendo os preços do mercado");
    expect(container.querySelector("button")).toBeNull();

    await act(async () => {
      release!();
      await settle();
    });
    expect(container.textContent).toContain("analisado");
    expect(container.textContent).not.toContain("Lendo os preços do mercado");
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
  });
});
