import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// A action real é server-only; aqui só o render importa.
vi.mock("@/app/actions/ai-config", () => ({
  updateDefaultModel: vi.fn(async () => ({ ok: true })),
}));

import { DefaultModelForm } from "@/app/(app)/admin/settings/default-model-form";

// O padrão global grava a conferida, mas roda a versão em uso da família (ADR 0062):
// o preço mostrado é o dela, com "estimado" até o admin confirmar.
describe("DefaultModelForm — preço da versão em uso", () => {
  it("sem versão adotada: preço da conferida", () => {
    const html = renderToStaticMarkup(<DefaultModelForm current="claude-sonnet-5-5" />);
    expect(html).toContain("Sonnet — $2/$10 por 1M");
    expect(html).not.toContain("estimado");
  });

  it("com versão adotada: preço dela, com 'estimado' só quando não confirmado", () => {
    const html = renderToStaticMarkup(
      <DefaultModelForm
        current="claude-sonnet-5-5"
        inUsePrices={{
          "claude-sonnet-5-5": { inputPricePerMTok: 2.5, outputPricePerMTok: 12, estimated: true },
          "claude-opus-5-5": { inputPricePerMTok: 6, outputPricePerMTok: 30, estimated: false },
        }}
      />,
    );
    expect(html).toContain("Sonnet — $2.5/$12 por 1M (estimado)");
    expect(html).toMatch(/Opus — \$6\/\$30 por 1M(?! \(estimado\))/);
    // O value segue a conferida (chave da família).
    expect(html).toContain('value="claude-sonnet-5-5"');
  });
});
