import { describe, expect, it } from "vitest";

import { initialModelOverride } from "@/lib/ai/model-override";

// Regra de seed do dropdown de override (#239): o `<select>` do AnalysisPanel é
// controlado por este valor e o sentinel "default" significa "usar a cascata
// server-side". O dropdown deve abrir refletindo a preferência do usuário (não
// "default") pra o modelo escolhido PERSISTIR entre reanálises — mas só quando a
// preferência é um modelo de fato selecionável pela audiência atual.
describe("initialModelOverride — seed do dropdown de modelo (#239)", () => {
  const selectable = [{ id: "claude-opus-4-8" }, { id: "claude-haiku-4-5" }];

  it("semeia com a preferência quando ela é um modelo selecionável", () => {
    expect(initialModelOverride("claude-haiku-4-5", selectable)).toBe(
      "claude-haiku-4-5",
    );
  });

  it("cai no sentinel 'default' quando não há preferência (null)", () => {
    expect(initialModelOverride(null, selectable)).toBe("default");
  });

  it("cai no sentinel quando a preferência não é um AIModelId válido", () => {
    expect(initialModelOverride("modelo-inexistente", selectable)).toBe(
      "default",
    );
  });

  it("cai no sentinel quando a preferência está fora da audiência (sem <option>)", () => {
    // claude-sonnet-4-6 é um AIModelId válido, mas não está na lista selecionável
    // desta audiência — semear com ele deixaria o <select> com um value órfão.
    expect(initialModelOverride("claude-sonnet-4-6", selectable)).toBe(
      "default",
    );
  });

  it("cai no sentinel quando a audiência não tem modelos selecionáveis", () => {
    expect(initialModelOverride("claude-opus-4-8", [])).toBe("default");
  });
});
