import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ModelOverrideSelect } from "@/components/model-override-select";

describe("ModelOverrideSelect — opção de padrão global rotulada (#112)", () => {
  it("mostra o label do default global entre parênteses na opção 'default'", () => {
    const markup = renderToStaticMarkup(
      <ModelOverrideSelect
        value="default"
        onChange={() => {}}
        models={[{ id: "claude-sonnet-5-5", label: "Sonnet 5.5" }]}
        defaultModelLabel="Sonnet 5.5"
      />,
    );
    expect(markup).toContain("Usar padrão global (Sonnet 5.5)");
  });

  it("reflete um default global diferente verbatim", () => {
    const markup = renderToStaticMarkup(
      <ModelOverrideSelect
        value="default"
        onChange={() => {}}
        models={[{ id: "claude-haiku-5-5", label: "Haiku 5.5 (econômico)" }]}
        defaultModelLabel="Haiku 5.5 (econômico)"
      />,
    );
    expect(markup).toContain("Usar padrão global (Haiku 5.5 (econômico))");
  });

  it("renderiza os modelos da audiência na ordem recebida", () => {
    const markup = renderToStaticMarkup(
      <ModelOverrideSelect
        value="default"
        onChange={() => {}}
        models={[
          { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
          { id: "claude-haiku-5-5", label: "Haiku 5.5 (econômico)" },
        ]}
        defaultModelLabel="Sonnet 5.5"
      />,
    );
    expect(markup.indexOf("Sonnet 5.5")).toBeLessThan(
      markup.indexOf("Haiku 5.5"),
    );
  });

  // Contrato de FormData: a action analyzeMatch lê `modelOverride` do FormData
  // (predictions.ts) e o teste de action o fixa. A migração pro primitivo
  // ModelSelect tem que repassar o `name` ao <select> nativo via ...selectProps.
  it("preserva name=\"modelOverride\" no <select> nativo (contrato de FormData)", () => {
    const markup = renderToStaticMarkup(
      <ModelOverrideSelect
        value="default"
        onChange={() => {}}
        models={[{ id: "claude-sonnet-5-5", label: "Sonnet 5.5" }]}
        defaultModelLabel="Sonnet 5.5"
      />,
    );
    expect(markup).toContain('name="modelOverride"');
  });
});
