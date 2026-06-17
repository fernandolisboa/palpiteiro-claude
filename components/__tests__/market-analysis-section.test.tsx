import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// SectionFooterDispatch (no caminho analisável) importa o server action analyzeMatch —
// mock leve pra não puxar server-only no env de teste.
vi.mock("@/app/actions/predictions", () => ({
  analyzeMatch: vi.fn(),
}));

import {
  MarketAnalysisSection,
  MarketAnalysisSections,
} from "@/components/market-analysis-section";
import { initialModelOverride } from "@/lib/ai/model-override";
import type {
  AnalysisView,
  MarketAnalysisSectionItem,
  OutcomeView,
} from "@/lib/view/types";

const overOutcome: OutcomeView = {
  id: "over",
  label: "Over 2.5",
  scenarioLabel: "mais de 2.5 gols",
  modelProb: "58%",
  marketProb: "50.7%",
  odd: "1.92",
  edge: "+7.3pp",
  expectedReturn: "+11.4%",
  breakEven: "1.72",
  isRecommended: true,
};

function mkView(o: {
  marketKey: string;
  marketLabel: string;
  selectionLabel: string;
  line: number | null;
  oddAtRec: string;
  rationale: string;
  model?: string;
}): AnalysisView {
  return {
    recommendation: {
      marketKey: o.marketKey,
      marketLabel: o.marketLabel,
      selectionKey: "x",
      selectionLabel: o.selectionLabel,
      line: o.line,
      betSummary: { market: o.selectionLabel, plain: "" },
    },
    outcomes: [overOutcome],
    minOdd: "1.85",
    stakeUnits: "1.00 u",
    framing: null,
    note: null,
    oddAtRec: o.oddAtRec,
    oddAtRecAgo: "há 3h",
    bookmaker: "bet365",
    expectedReturn: "+11.4%",
    expectedReturnTone: "positive",
    evLegend: "x",
    minEdgeLabel: "5pp",
    minEdgePp: 5,
    rationale: o.rationale,
    factors: ["f"],
    generatedAt: "19 mai · 14:22",
    promptVersion: "v1",
    model: o.model ?? "claude-sonnet-4.5",
    costUsd: "$0.01",
  };
}

function mkItem(o: {
  marketKey: string;
  marketLabel: string;
  modelId: string;
  view: AnalysisView;
}): MarketAnalysisSectionItem {
  return {
    id: `${o.marketKey}-id`,
    marketKey: o.marketKey,
    marketLabel: o.marketLabel,
    modelId: o.modelId,
    view: o.view,
  };
}

const OU = mkItem({
  marketKey: "over_under",
  marketLabel: "Over/Under gols",
  modelId: "claude-sonnet-4-6",
  view: mkView({
    marketKey: "over_under",
    marketLabel: "Over/Under gols",
    selectionLabel: "Over",
    line: 2.5,
    oddAtRec: "1.92",
    rationale: "RACIONAL_OU",
    model: "claude-sonnet-4.6",
  }),
});
const MR = mkItem({
  marketKey: "match_result",
  marketLabel: "Resultado (1X2)",
  modelId: "claude-opus-4-8",
  view: mkView({
    marketKey: "match_result",
    marketLabel: "Resultado (1X2)",
    selectionLabel: "Casa",
    line: null,
    oddAtRec: "2.10",
    rationale: "RACIONAL_MR",
  }),
});

const ADMIN_MODELS = [
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-opus-4-8", label: "Opus 4.8" },
];

const occurrences = (s: string, sub: string) => s.split(sub).length - 1;

describe("MarketAnalysisSection — header (#243)", () => {
  it("título = marketLabel + meta (seleção + linha + odd), market-agnostic", () => {
    const markup = renderToStaticMarkup(
      <MarketAnalysisSection item={MR} defaultOpen dispatch={null} />,
    );
    expect(markup).toContain("Resultado (1X2)");
    expect(markup).toContain("Casa · 2.10"); // sem linha (1X2)
    expect(markup).toContain("RACIONAL_MR"); // conteúdo (aberto)
  });
});

describe("MarketAnalysisSections — read-only (jogo encerrado)", () => {
  it("≤1 → AnalysisResult CRU, SEM footer de reanálise (#244)", () => {
    const markup = renderToStaticMarkup(
      <MarketAnalysisSections sections={[OU]} />,
    );
    expect(markup).toContain("RACIONAL_OU");
    // Sem chrome de collapsible (meta só no trigger ≥2)…
    expect(markup).not.toContain("Over 2.5 · 1.92");
    // …e SEM footer de reanálise (read-only).
    expect(markup).not.toContain("análise feita com modelo");
    expect(markup).not.toContain('name="modelOverride"');
    expect(markup).not.toContain("Analisar de novo");
  });
});

describe("MarketAnalysisSections — analisável (footer por seção, #244)", () => {
  it("regular (sem modelos selecionáveis): footer = label + refresh, SEM dropdown", () => {
    const markup = renderToStaticMarkup(
      <MarketAnalysisSections
        sections={[OU]}
        analyzable
        matchId="m"
        selectableModels={[]}
        defaultModelLabel="Opus 4.8"
      />,
    );
    // Footer presente: label do modelo que rodou + botão refresh + hidden inputs.
    expect(markup).toContain("análise feita com modelo claude-sonnet-4.6");
    expect(markup).toContain("Analisar de novo");
    expect(markup).toContain('name="matchId"');
    expect(markup).toContain('name="marketKey"');
    expect(markup).toContain('value="over_under"'); // marketKey hidden = mercado da seção
    // Sem modelos selecionáveis (usuário regular) → sem dropdown de modelo.
    expect(markup).not.toContain('name="modelOverride"');
  });

  it("admin (≥2 mercados): seção colapsável por mercado; a aberta tem footer isolado", () => {
    const markup = renderToStaticMarkup(
      <MarketAnalysisSections
        sections={[OU, MR]}
        analyzable
        matchId="m"
        selectableModels={ADMIN_MODELS}
        defaultModelLabel="Opus 4.8"
      />,
    );
    // Uma seção colapsável por mercado (meta no trigger de CADA — sempre renderizado).
    expect(markup).toContain("Over 2.5 · 1.92");
    expect(markup).toContain("Casa · 2.10");
    // Só a seção ABERTA (índice 0, defaultOpen) renderiza conteúdo no markup estático —
    // o Radix Collapsible fechado não emite os filhos. Então o footer da aberta (OU):
    expect(occurrences(markup, 'name="modelOverride"')).toBe(1);
    expect(occurrences(markup, "Analisar de novo")).toBe(1);
    // Form da seção aberta carrega o marketKey DELA (reanálise escopada — AC2). O da
    // fechada (match_result) só aparece ao expandir; coberto pelo teste single abaixo.
    expect(markup).toContain('value="over_under"');
    // SEED do dropdown = o modelo que RODOU aquela análise (item.modelId, id CRU), não
    // view.model (display "claude-sonnet-4.6", inválido como AIModelId → cairia em
    // "default"). Trava a fiação modelId→<select> (AC de persistência #244/#239).
    expect(markup).toMatch(/value="claude-sonnet-4-6"[^>]*selected/);
  });

  it("seção analisável de mercado não-over_under carrega seu próprio marketKey + footer", () => {
    // Single (bare, aberto) → prova que QUALQUER mercado, não só over_under, ganha footer
    // com o SEU marketKey no hidden input (reanálise escopada por mercado, AC2).
    const markup = renderToStaticMarkup(
      <MarketAnalysisSections
        sections={[MR]}
        analyzable
        matchId="m"
        selectableModels={ADMIN_MODELS}
        defaultModelLabel="Opus 4.8"
      />,
    );
    expect(markup).toContain('value="match_result"');
    expect(markup).toContain('name="modelOverride"');
    expect(markup).toContain("Analisar de novo");
  });

  it("B3 por seção: a 1ª seção (aberta) renderiza seu racional UMA vez (sem duplicar state.view)", () => {
    const markup = renderToStaticMarkup(
      <MarketAnalysisSections
        sections={[OU, MR]}
        analyzable
        matchId="m"
        selectableModels={ADMIN_MODELS}
        defaultModelLabel="Opus 4.8"
      />,
    );
    expect(occurrences(markup, "RACIONAL_OU")).toBe(1);
  });
});

describe("seed do dropdown da seção = modelo que rodou (#244)", () => {
  it("initialModelOverride semeia o modelId da análise; id aposentado/fora-da-audiência → default", () => {
    // Seed = o modelo que rodou aquela análise (quando selecionável).
    expect(initialModelOverride("claude-sonnet-4-6", ADMIN_MODELS)).toBe(
      "claude-sonnet-4-6",
    );
    // modelVersion histórico/aposentado (não está na audiência) → sentinel "default"
    // (sem <option> órfã); guarda contra row antiga.
    expect(initialModelOverride("retired-model-xyz", ADMIN_MODELS)).toBe(
      "default",
    );
  });
});
