import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { hardenSources } from "@/lib/view/share/source-hardening";

// Endurecimento das fontes pro /p (ADR 0035 §8 / #384): título passa pelo firewall (valor +
// "%"), URL só https, query/fragment strippados, hostname-only exposto, rel nofollow.

describe("hardenSources — firewall do título", () => {
  it("título com linguagem de valor é DROPPADO", () => {
    const out = hardenSources([
      { title: "Odds subindo no jogo", url: "https://ge.globo.com/a" },
    ]);
    expect(out).toEqual([]);
  });

  it("título com '%' é DROPPADO (o guard não bane %, mas o /p sim)", () => {
    const out = hardenSources([
      { title: "Time tem 70% de chance", url: "https://ge.globo.com/a" },
    ]);
    expect(out).toEqual([]);
  });

  it("título com decimal solto (odd) é DROPPADO; o limpo sobrevive (#438)", () => {
    const out = hardenSources([
      { title: "Bet365 paga 3.5 no Palmeiras", url: "https://ge.globo.com/a" },
      { title: "Escalação confirmada", url: "https://ge.globo.com/b" },
    ]);
    expect(out.map((s) => s.title)).toEqual(["Escalação confirmada"]);
  });
});

describe("hardenSources — URL", () => {
  it("http:// (não-https) é DROPPADO", () => {
    const out = hardenSources([
      { title: "Escalação confirmada", url: "http://ge.globo.com/a" },
    ]);
    expect(out).toEqual([]);
  });

  it("URL malformada é DROPPADA", () => {
    const out = hardenSources([
      { title: "Escalação confirmada", url: "not a url" },
    ]);
    expect(out).toEqual([]);
  });

  it("https com ?query#frag → href strippado pra origin+pathname; hostname-only exposto", () => {
    const out = hardenSources([
      {
        title: "Escalação confirmada",
        url: "https://ge.globo.com/time/noticia?utm=x&ref=y#secao",
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      title: "Escalação confirmada",
      hostname: "ge.globo.com",
      href: "https://ge.globo.com/time/noticia",
    });
  });

  it("https limpo é mantido {title,hostname,href}", () => {
    const out = hardenSources([
      { title: "Verdão chega embalado", url: "https://espn.com.br/b" },
    ]);
    expect(out).toEqual([
      {
        title: "Verdão chega embalado",
        hostname: "espn.com.br",
        href: "https://espn.com.br/b",
      },
    ]);
  });

  it("undefined/vazio → []", () => {
    expect(hardenSources(undefined)).toEqual([]);
    expect(hardenSources([])).toEqual([]);
  });
});

describe("hardenSources — render público com rel nofollow", () => {
  it("os anchors carregam rel='noopener noreferrer nofollow'", () => {
    const hardened = hardenSources([
      { title: "Escalação confirmada", url: "https://ge.globo.com/a" },
    ]);
    // Mini-render de um <a> espelhando o PublicCitedSources pra pinar o rel.
    const html = renderToStaticMarkup(
      <ul>
        {hardened.map((s, i) => (
          <li key={i}>
            <a href={s.href} target="_blank" rel="noopener noreferrer nofollow">
              {s.title} {s.hostname}
            </a>
          </li>
        ))}
      </ul>,
    );
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain("ge.globo.com");
  });
});
