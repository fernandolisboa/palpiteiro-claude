import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ModelOverrideSelect } from "@/components/model-override-select";

describe("ModelOverrideSelect — opção de padrão global rotulada (#112)", () => {
  it("mostra o label do default global entre parênteses na opção 'default'", () => {
    const markup = renderToStaticMarkup(
      <ModelOverrideSelect
        value="default"
        onChange={() => {}}
        models={[{ id: "claude-opus-4-8", label: "Opus 4.8" }]}
        defaultModelLabel="Opus 4.8"
      />,
    );
    expect(markup).toContain("Usar padrão global (Opus 4.8)");
  });

  it("reflete um default global diferente verbatim", () => {
    const markup = renderToStaticMarkup(
      <ModelOverrideSelect
        value="default"
        onChange={() => {}}
        models={[{ id: "claude-sonnet-4-6", label: "Sonnet 4.6" }]}
        defaultModelLabel="Sonnet 4.6"
      />,
    );
    expect(markup).toContain("Usar padrão global (Sonnet 4.6)");
  });

  it("renderiza os modelos da audiência na ordem recebida", () => {
    const markup = renderToStaticMarkup(
      <ModelOverrideSelect
        value="default"
        onChange={() => {}}
        models={[
          { id: "claude-opus-4-8", label: "Opus 4.8" },
          { id: "claude-haiku-4-5", label: "Haiku 4.5 (econômico)" },
        ]}
        defaultModelLabel="Opus 4.8"
      />,
    );
    expect(markup.indexOf("Opus 4.8")).toBeLessThan(
      markup.indexOf("Haiku 4.5"),
    );
  });
});
