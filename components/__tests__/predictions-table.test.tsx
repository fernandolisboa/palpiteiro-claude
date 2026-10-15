import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PredictionsTable } from "@/components/dashboard/predictions-table";
import type { PredictionRowView } from "@/lib/view/dashboard";

const ROW: PredictionRowView = {
  id: "p-1",
  home: "Club Atlético Mineiro",
  away: "Esporte Clube Juventude",
  league: "bsa",
  when: "hoje, 16:00",
  rec: "Mais de 2,5",
  recKind: "over",
  market: "Total de gols",
  odd: "1,92",
  edge: "+7,3 pontos",
  confidence: "58%",
  status: "pending",
  profit: null,
};

describe("PredictionsTable — nome do jogo (#574 linha 8)", () => {
  it("o link do jogo trunca e leva o nome inteiro no title", () => {
    const html = renderToStaticMarkup(<PredictionsTable rows={[ROW]} />);
    const link = html.match(/<a [^>]*href="\/dashboard\/p-1"[^>]*>/)?.[0] ?? "";
    expect(link).toContain("truncate");
    expect(link).toContain("block");
    expect(link).toContain('title="Club Atlético Mineiro × Esporte Clube Juventude"');
  });
});

describe("PredictionsTable — selo de status (ADR 0056)", () => {
  it.each([
    ["pending", "Em aberto"],
    ["won", "Acertou"],
    ["lost", "Errou"],
  ] as const)("%s → ResultBadge com %s", (status, word) => {
    const html = renderToStaticMarkup(
      <PredictionsTable rows={[{ ...ROW, status, profit: status === "pending" ? null : "+0,92 u" }]} />,
    );
    expect(html).toContain(`data-result="${status}"`);
    expect(html).toContain(`>${word}</span>`);
  });
});

describe("PredictionsTable — linha sem aposta", () => {
  it.each(["void", "pending"] as const)("pass (%s) mostra traço neutro, sem selo de resultado", (status) => {
    const html = renderToStaticMarkup(
      <PredictionsTable rows={[{ ...ROW, rec: "Sem aposta", recKind: "pass", status, profit: null }]} />,
    );
    expect(html).not.toContain("data-result=");
    expect(html).not.toContain("Anulada");
    expect(html).toContain('<span class="text-meta text-muted-foreground">—</span>');
  });
});

describe("PredictionsTable — cor da recomendação pelo recKind (ADR 0056)", () => {
  it.each([
    ["over", "Mais de 2,5", "text-edge-fg"],
    ["under", "Menos de 2,5", "text-accent-fg"],
    ["pass", "Sem aposta", "text-muted-foreground"],
    ["other", "Casa", "text-foreground"],
  ] as const)("%s → %s com %s", (recKind, rec, cls) => {
    const html = renderToStaticMarkup(<PredictionsTable rows={[{ ...ROW, rec, recKind }]} />);
    expect(html).toMatch(new RegExp(`class="text-meta font-medium ${cls}">${rec}<`));
  });

  it("cabeçalho 'vantagem' alinhado à direita e a célula sem 'pp'", () => {
    const html = renderToStaticMarkup(<PredictionsTable rows={[ROW]} />);
    expect(html).toMatch(/<th[^>]*text-right[^>]*>vantagem<\/th>/);
    expect(html).toContain(">+7,3 pontos<");
    expect(html).not.toContain("pp<");
  });
});
