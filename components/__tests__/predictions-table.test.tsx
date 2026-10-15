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
  rec: "OVER",
  market: "Over/Under gols 2,5",
  odd: "1,92",
  edge: "+7,3",
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
