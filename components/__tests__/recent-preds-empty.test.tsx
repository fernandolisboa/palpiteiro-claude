import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { RecentPredsEmpty } from "@/components/recent-preds-empty";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("RecentPredsEmpty — estado vazio das predições recentes (#446)", () => {
  it("explica a seção e leva ao próximo jogo analisável, preservando o filtro", () => {
    const html = renderToStaticMarkup(
      <RecentPredsEmpty nextMatchId="m1" listHref="/jogos?league=bsa" />,
    );
    expect(text(html)).toContain("Nenhuma predição ainda");
    expect(text(html)).toContain("Analisar com IA");
    expect(text(html)).toContain("Abrir o próximo jogo");
    expect(html).toContain('href="/match/m1?back=%2Fjogos%3Fleague%3Dbsa"');
    expect(html).not.toContain('href="/como-usar"');
  });

  it("sem jogo analisável na lista → atalho pro guia", () => {
    const html = renderToStaticMarkup(<RecentPredsEmpty nextMatchId={null} />);
    expect(text(html)).toContain("Ver como usar");
    expect(html).toContain('href="/como-usar"');
    expect(html).not.toContain("/match/");
  });
});
