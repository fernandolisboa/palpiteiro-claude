import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// NewAnalysisForm importa o server action analyzeMarkets — mock leve pra não puxar server-only.
vi.mock("@/app/actions/predictions", () => ({
  analyzeMarkets: vi.fn(),
}));

import {
  NewAnalysisForm,
  deriveNewAnalysisFeedback,
} from "@/components/new-analysis-form";
import type { MarketRunSummaryItem } from "@/app/actions/predictions";

const OU = { key: "over_under", label: "Over/Under gols" };
const MR = { key: "match_result", label: "Resultado (1X2)" };
const BTTS = { key: "btts", label: "Ambas marcam" };

function render(unanalyzedMarkets: { key: string; label: string }[]) {
  return renderToStaticMarkup(
    <NewAnalysisForm
      matchId="m"
      unanalyzedMarkets={unanalyzedMarkets}
      selectableModels={[]}
      defaultModelLabel="Opus 4.8"
      preferredModelId={null}
      oddsAvailable
    />,
  );
}

const hiddenMarketKeys = (markup: string): string[] =>
  [...markup.matchAll(/name="marketKeys"[^>]*value="([^"]+)"/g)].map((m) => m[1]);

describe("deriveNewAnalysisFeedback — roteamento de feedback (AC4)", () => {
  it("rejeição total (ok:false) → errorMsg, sem banner", () => {
    expect(deriveNewAnalysisFeedback({ ok: false, error: "boom" })).toEqual({
      errorMsg: "boom",
      runSummary: null,
    });
  });

  it("falha SINGLE (1 sumário não-ok) → errorMsg (AnalysisErrorCard), sem banner", () => {
    const summaries: MarketRunSummaryItem[] = [
      {
        marketKey: "over_under",
        marketLabel: "Over/Under gols",
        status: "failed",
        message: "Sem odds publicadas para este jogo no momento.",
      },
    ];
    expect(deriveNewAnalysisFeedback({ ok: true, summaries })).toEqual({
      errorMsg: "Sem odds publicadas para este jogo no momento.",
      runSummary: null,
    });
  });

  it("sucesso SINGLE → nada inline (a seção via revalidate é a confirmação)", () => {
    const summaries: MarketRunSummaryItem[] = [
      { marketKey: "over_under", marketLabel: "Over/Under gols", status: "ok" },
    ];
    expect(deriveNewAnalysisFeedback({ ok: true, summaries })).toEqual({
      errorMsg: null,
      runSummary: null,
    });
  });

  it("multi com falha parcial → runSummary (banner), sem errorMsg", () => {
    const summaries: MarketRunSummaryItem[] = [
      { marketKey: "over_under", marketLabel: "Over/Under gols", status: "ok" },
      {
        marketKey: "btts",
        marketLabel: "Ambas marcam",
        status: "failed",
        message: "Nenhum bookmaker oferece este mercado para o jogo no momento.",
      },
    ];
    expect(deriveNewAnalysisFeedback({ ok: true, summaries })).toEqual({
      errorMsg: null,
      runSummary: summaries,
    });
  });

  it("multi all-ok → nada (banner suprimido)", () => {
    const summaries: MarketRunSummaryItem[] = [
      { marketKey: "over_under", marketLabel: "Over/Under gols", status: "ok" },
      { marketKey: "match_result", marketLabel: "Resultado (1X2)", status: "ok" },
    ];
    expect(deriveNewAnalysisFeedback({ ok: true, summaries })).toEqual({
      errorMsg: null,
      runSummary: null,
    });
  });

  it("state null → nada", () => {
    expect(deriveNewAnalysisFeedback(null)).toEqual({
      errorMsg: null,
      runSummary: null,
    });
  });
});

describe("NewAnalysisForm — render multi-select vs single (paridade AC4)", () => {
  it(">1 mercado → multi-select (legenda 'mercados') + over_under marcado por default", () => {
    const markup = render([OU, MR, BTTS]);
    expect(markup).toContain("mercados");
    // Todos os mercados aparecem como chips.
    expect(markup).toContain("Over/Under gols");
    expect(markup).toContain("Resultado (1X2)");
    expect(markup).toContain("Ambas marcam");
    // Default = SÓ over_under marcado → exatamente 1 hidden marketKeys.
    expect(hiddenMarketKeys(markup)).toEqual(["over_under"]);
    // Há um checkbox marcado (o default).
    expect(markup).toContain("checked");
    expect(markup).toContain("Analisar com IA");
  });

  it("1 mercado (over_under) → SEM multi-select, hidden marketKeys=over_under (paridade single)", () => {
    const markup = render([OU]);
    expect(markup).not.toContain(">mercados<");
    expect(hiddenMarketKeys(markup)).toEqual(["over_under"]);
    expect(markup).toContain("Analisar com IA");
  });

  it("1 mercado NÃO-over_under (btts) → hidden marketKeys=btts (pina o nome PLURAL do campo)", () => {
    const markup = render([BTTS]);
    // Sem dropdown single legado (name="marketKey" singular).
    expect(markup).not.toContain('name="marketKey"');
    expect(hiddenMarketKeys(markup)).toEqual(["btts"]);
  });
});
