import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AnalysisUserContext } from "@/components/analysis-user-context";
import type { AnalysisUserContextView } from "@/lib/view/analysis-user-context";

const VIEW: AnalysisUserContextView = {
  createdAgo: "há 5 min",
  showUnverifiedNote: true,
  claims: [
    {
      index: 0,
      text: "desfalque no ataque do Flamengo",
      topicLabel: "desfalque",
      status: "unverifiable",
      statusLabel: "não verificável",
      evidence: "Não conseguimos conferir qual jogador; entrou com peso menor.",
      effect: "efeito no modelo: ataque do Flamengo ajustado para baixo",
    },
  ],
};

describe("<AnalysisUserContext/>", () => {
  it("cabeçalho, afirmação com status/evidência/efeito e as notas", () => {
    const html = renderToStaticMarkup(<AnalysisUserContext view={VIEW} />);
    expect(html).toContain("o que você acrescentou · há 5 min");
    expect(html).toContain("não verificável");
    expect(html).toContain("desfalque no ataque do Flamengo");
    expect(html).toContain("ajustado para baixo");
    expect(html).toContain("Não verificável: não temos esse dado; entrou com peso menor.");
    expect(html).toContain("O texto que você escreveu não fica salvo");
  });

  it("sem afirmação não verificável que moveu → sem a nota", () => {
    const html = renderToStaticMarkup(
      <AnalysisUserContext view={{ ...VIEW, showUnverifiedNote: false }} />,
    );
    expect(html).not.toContain("entrou com peso menor.</p>");
  });
});
