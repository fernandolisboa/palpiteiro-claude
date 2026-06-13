import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// A action é "use server" e importa next-auth (não resolve sob vitest); o form só
// a usa como referência pro useActionState. Mock pra isolar a UI renderizada.
vi.mock("@/app/actions/settlement", () => ({
  overridePredictionOutcome: vi.fn(),
}));

import { OverrideForm } from "@/app/admin/predictions/[id]/override-form";

// renderToStaticMarkup é o padrão do repo p/ testar componentes "use client" (ver
// components/__tests__/model-override-select.test.tsx). useActionState renderiza no
// estado inicial sob markup estático (React 19 SSR-safe).
describe("OverrideForm — opções de resultado incl. push (#168)", () => {
  it("oferece push (value + label) além de won/lost/void e os inputs do placar 90'", () => {
    const markup = renderToStaticMarkup(
      <OverrideForm predictionId="p1" defaultResult="void" />,
    );
    // push agora é selecionável (delta do #168)
    expect(markup).toContain('value="push"');
    expect(markup).toContain("Push (devolve stake)");
    // os 3 resultados pré-existentes seguem presentes
    expect(markup).toContain('value="won"');
    expect(markup).toContain('value="lost"');
    expect(markup).toContain('value="void"');
    // o contrato de result_data do MVP = placar 90' (home/away)
    expect(markup).toContain('name="homeScore"');
    expect(markup).toContain('name="awayScore"');
  });

  it("seleciona o defaultResult recebido (push)", () => {
    const markup = renderToStaticMarkup(
      <OverrideForm predictionId="p1" defaultResult="push" />,
    );
    // o <select> renderiza o default escolhido como selecionado
    expect(markup).toMatch(/<option[^>]*value="push"[^>]*selected/);
  });
});
