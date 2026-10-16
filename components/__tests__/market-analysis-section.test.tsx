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
import { ANALYSIS_RISK_DISCLAIMER } from "@/lib/view/analysis";
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
    engine: "LLM",
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
  modelId: "claude-sonnet-5-5",
  view: mkView({
    marketKey: "over_under",
    marketLabel: "Over/Under gols",
    selectionLabel: "Over",
    line: 2.5,
    oddAtRec: "1.92",
    rationale: "RACIONAL_OU",
    model: "claude-sonnet-4.5",
  }),
});
const MR = mkItem({
  marketKey: "match_result",
  marketLabel: "Resultado (1X2)",
  modelId: "claude-haiku-5-5",
  view: mkView({
    marketKey: "match_result",
    marketLabel: "Resultado (1X2)",
    selectionLabel: "Casa",
    line: null,
    oddAtRec: "2.10",
    rationale: "RACIONAL_MR",
  }),
});

// Fixture de modelos selecionáveis da seção (subconjunto do registry; a seção só
// renderiza o que recebe).
const ADMIN_MODELS = [
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5 (econômico)" },
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
    expect(markup).not.toContain("Over 2,5 · 1.92");
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
        defaultModelLabel="Sonnet 5.5"
      />,
    );
    // Footer presente: label do modelo que rodou + botão refresh + hidden inputs.
    expect(markup).toContain("análise feita com modelo claude-sonnet-4.5");
    expect(markup).toContain("Analisar de novo");
    expect(markup).toContain('name="matchId"');
    expect(markup).toContain('name="marketKey"');
    expect(markup).toContain('value="over_under"'); // marketKey hidden = mercado da seção
    // Sem modelos selecionáveis (usuário regular) → sem dropdown de modelo.
    expect(markup).not.toContain('name="modelOverride"');
  });

  it("admin (≥2 mercados): seção colapsável por mercado, TODAS colapsadas por padrão (#366)", () => {
    const markup = renderToStaticMarkup(
      <MarketAnalysisSections
        sections={[OU, MR]}
        analyzable
        matchId="m"
        selectableModels={ADMIN_MODELS}
        defaultModelLabel="Sonnet 5.5"
      />,
    );
    // Uma seção colapsável por mercado (meta no trigger de CADA — sempre renderizado).
    expect(markup).toContain("Over 2,5 · 1.92");
    expect(markup).toContain("Casa · 2.10");
    // Refino #366: NENHUMA seção aberta por padrão. O Radix Collapsible fechado não emite
    // os filhos → sem footer/racional de NENHUM mercado no markup estático (abrem só no
    // clique). Antes a 1ª (índice 0) vinha aberta; agora o usuário escolhe qual abrir.
    expect(occurrences(markup, 'name="modelOverride"')).toBe(0);
    expect(occurrences(markup, "Analisar de novo")).toBe(0);
    expect(markup).not.toContain("RACIONAL_OU");
    expect(markup).not.toContain("RACIONAL_MR");
  });

  it("seção ABERTA (defaultOpen): footer escopado + dropdown semeado pelo modelId + racional UMA vez", () => {
    // Cobre o caminho de seção expandida (o usuário clicou): footer isolado da seção, com
    // o marketKey DELA (reanálise escopada — AC2) e o dropdown semeado pelo modelo que
    // RODOU (item.modelId, id CRU), não view.model (display "claude-sonnet-4.5", inválido
    // como AIModelId → cairia em "default"). Trava a fiação modelId→<select> (#244/#239).
    const markup = renderToStaticMarkup(
      <MarketAnalysisSection
        item={OU}
        defaultOpen
        dispatch={{
          analyzable: true,
          matchId: "m",
          selectableModels: ADMIN_MODELS,
          defaultModelLabel: "Sonnet 5.5",
        }}
      />,
    );
    expect(markup).toContain('value="over_under"');
    expect(markup).toContain('name="modelOverride"');
    expect(markup).toContain("Analisar de novo");
    expect(markup).toMatch(/value="claude-sonnet-5-5"[^>]*selected/);
    // B3: racional da seção aberta renderizado UMA vez (sem duplicar state.view).
    expect(occurrences(markup, "RACIONAL_OU")).toBe(1);
  });

  it("análise antiga (modelId claude-sonnet-4-5-20250929, ADR 0061) → dropdown semeado no Sonnet 5.5", () => {
    const markup = renderToStaticMarkup(
      <MarketAnalysisSection
        item={{ ...OU, modelId: "claude-sonnet-4-5-20250929" }}
        defaultOpen
        dispatch={{
          analyzable: true,
          matchId: "m",
          selectableModels: ADMIN_MODELS,
          defaultModelLabel: "Sonnet 5.5",
        }}
      />,
    );
    expect(markup).toMatch(/value="claude-sonnet-5-5"[^>]*selected/);
    expect(markup).not.toContain('value="claude-sonnet-4-5-20250929"');
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
        defaultModelLabel="Sonnet 5.5"
      />,
    );
    expect(markup).toContain('value="match_result"');
    expect(markup).toContain('name="modelOverride"');
    expect(markup).toContain("Analisar de novo");
  });

});

describe("seed do dropdown da seção = modelo que rodou (#244)", () => {
  it("initialModelOverride semeia o modelId da análise; id antigo → 5.5 da família; desconhecido/fora-da-audiência → default", () => {
    // Seed = o modelo que rodou aquela análise (quando selecionável).
    expect(initialModelOverride("claude-sonnet-5-5", ADMIN_MODELS)).toBe(
      "claude-sonnet-5-5",
    );
    // modelVersion de versão antiga (ADR 0061) → o 5.5 da mesma família.
    expect(
      initialModelOverride("claude-sonnet-4-5-20250929", ADMIN_MODELS),
    ).toBe("claude-sonnet-5-5");
    expect(initialModelOverride("claude-sonnet-4-6", ADMIN_MODELS)).toBe(
      "claude-sonnet-5-5",
    );
    expect(initialModelOverride("claude-haiku-4-5", ADMIN_MODELS)).toBe(
      "claude-haiku-5-5",
    );
    // Id desconhecido → sentinel "default" (sem <option> órfã).
    expect(initialModelOverride("retired-model-xyz", ADMIN_MODELS)).toBe(
      "default",
    );
    // Resolve pra um modelo fora da lista recebida (Opus não está aqui) → default.
    expect(initialModelOverride("claude-opus-4-8", ADMIN_MODELS)).toBe(
      "default",
    );
  });
});

describe("MarketAnalysisSections — layout flat (#576, Ler análise completa)", () => {
  it("todo mercado aberto num nível só: h3 + meta, sem acordeão", () => {
    const markup = renderToStaticMarkup(
      <MarketAnalysisSections sections={[OU, MR]} layout="flat" />,
    );
    // Nenhum MatchCollapsible (acordeão) dentro da análise aberta.
    expect(markup).not.toContain('data-slot="collapsible');
    expect(occurrences(markup, "<h3")).toBe(2);
    expect(markup).toContain("Over/Under gols");
    expect(markup).toContain("Casa · 2.10");
    // Os dois racionais à vista (aberto), não colapsados.
    expect(markup).toContain("RACIONAL_OU");
    expect(markup).toContain("RACIONAL_MR");
  });

  it("um mercado só também ganha o cabeçalho", () => {
    const markup = renderToStaticMarkup(
      <MarketAnalysisSections sections={[MR]} layout="flat" />,
    );
    expect(occurrences(markup, "<h3")).toBe(1);
    expect(markup).toContain("Resultado (1X2)");
  });

  it("repassa showRiskDisclaimer a cada resultado", () => {
    const withLine = renderToStaticMarkup(
      <MarketAnalysisSections sections={[OU, MR]} layout="flat" />,
    );
    const without = renderToStaticMarkup(
      <MarketAnalysisSections sections={[OU, MR]} layout="flat" showRiskDisclaimer={false} />,
    );
    expect(occurrences(withLine, ANALYSIS_RISK_DISCLAIMER)).toBe(2);
    expect(occurrences(without, ANALYSIS_RISK_DISCLAIMER)).toBe(0);
  });
});
