// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  decodeEntities,
  htmlToText,
  looksLikeRssFeed,
  makeSnippet,
  parseRssItems,
} from "../rss-parse";

// Feed real do ge (Flamengo, 21/11/2026), aparado pra 9 itens e corpos curtos.
const GE_XML = readFileSync(
  path.join(__dirname, "fixtures/ge-flamengo.xml"),
  "utf8"
);

// Item no formato WordPress (feed oficial de clube): CDATA no título, entidade numérica
// e o corpo em content:encoded.
const WORDPRESS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel><title>Clube</title>
<item>
  <title><![CDATA[Treino &#8211; elenco se reapresenta]]></title>
  <link>https://clube.example.com/noticia/treino/</link>
  <pubDate>Fri, 20 Nov 2026 14:00:00 +0000</pubDate>
  <description><![CDATA[<p>Resumo curto&#8230;</p>]]></description>
  <content:encoded><![CDATA[<p>O elenco se reapresentou &#8220;com tudo&#8221; nesta sexta.</p><p>Segunda linha.</p>]]></content:encoded>
</item>
</channel></rss>`;

describe("parseRssItems — feed real do ge", () => {
  const items = parseRssItems(GE_XML);

  it("lê todos os itens, na ordem do feed", () => {
    expect(items).toHaveLength(9);
    expect(items[0].title).toBe(
      "Com Carrascal no banco, veja a escalação do Flamengo para enfrentar o Palmeiras"
    );
    expect(items[0].link).toBe(
      "https://ge.globo.com/futebol/times/flamengo/noticia/2026/11/21/veja-a-escalacao-do-flamengo-para-enfrentar-o-palmeiras.ghtml"
    );
  });

  it("pubDate com -0000 vira Date em UTC", () => {
    expect(items[0].pubDate?.toISOString()).toBe("2026-11-21T18:30:25.000Z");
  });

  it("linha fina vem do atom:subtitle", () => {
    expect(items[0].subtitle).toBe(
      "Time de Leonardo Jardim pode garantir o título do Brasileirão neste sábado"
    );
  });

  it("corpo: sem o <img> do CDATA, sem rodapé e numa linha só", () => {
    const text = items[0].text;
    expect(text).not.toContain("<img");
    expect(text).not.toContain("glbimg");
    expect(text).not.toContain("Leia mais");
    expect(text).not.toContain("Ouça o podcast");
    expect(text).not.toContain("siga os lances");
    expect(text).not.toContain("\n");
    expect(text).toContain(
      "O Flamengo está escalado para enfrentar o Palmeiras"
    );
  });

  it("entidade do XML no título do canal não vaza pro item", () => {
    for (const item of items) expect(item.title).not.toMatch(/&[a-z]+;/);
  });
});

describe("parseRssItems — WordPress, entidades e lixo", () => {
  it("CDATA no título, &#8211; e content:encoded no lugar do description", () => {
    const [item] = parseRssItems(WORDPRESS_XML);
    expect(item.title).toBe("Treino – elenco se reapresenta");
    expect(item.text).toBe(
      "O elenco se reapresentou “com tudo” nesta sexta. Segunda linha."
    );
    expect(item.subtitle).toBeNull();
    expect(item.pubDate?.toISOString()).toBe("2026-11-20T14:00:00.000Z");
  });

  it("data inválida → null; item sem título ou sem link é descartado", () => {
    const xml = `<rss><channel>
      <item><title>Sem data</title><link>https://ge.globo.com/futebol/a</link><pubDate>ontem</pubDate></item>
      <item><title></title><link>https://ge.globo.com/futebol/b</link></item>
      <item><title>Sem link</title></item>
    </channel></rss>`;
    const items = parseRssItems(xml);
    expect(items).toHaveLength(1);
    expect(items[0].pubDate).toBeNull();
    expect(items[0].text).toBe("");
  });

  it("entrada que não é XML não lança", () => {
    expect(parseRssItems("<html><body>erro 500</body></html>")).toEqual([]);
    expect(parseRssItems("")).toEqual([]);
    expect(parseRssItems("<item><title>sem fim")).toEqual([]);
  });
});

describe("looksLikeRssFeed", () => {
  it("rss + channel = feed; página HTML não", () => {
    expect(looksLikeRssFeed(GE_XML)).toBe(true);
    expect(
      looksLikeRssFeed("<!doctype html><html><title>ge</title></html>")
    ).toBe(false);
    expect(looksLikeRssFeed("<rss version='2.0'></rss>")).toBe(false);
  });
});

describe("decodeEntities / htmlToText", () => {
  it("nomeadas, decimais, hex; desconhecida fica como está; código inválido some", () => {
    expect(
      decodeEntities("a &amp; b &lt;c&gt; &#8211; &#x2014; &quot;x&quot; &foo;")
    ).toBe('a & b <c> – — "x" &foo;');
    expect(decodeEntities("&#0; &#x110000; &#55296;")).toBe("  ");
  });

  it("HTML escapado (description do WordPress) vira texto", () => {
    expect(htmlToText("&lt;p&gt;Olá &amp;amp; tchau&lt;/p&gt;")).toBe(
      "Olá & tchau"
    );
    expect(htmlToText("<p>um</p><p>dois</p><script>alert(1)</script>")).toBe(
      "um\ndois"
    );
  });
});

describe("makeSnippet", () => {
  it("prefere a linha fina; sem ela, o começo do texto", () => {
    expect(makeSnippet({ subtitle: "Linha fina", text: "Corpo" })).toBe(
      "Linha fina"
    );
    expect(makeSnippet({ subtitle: null, text: "Corpo da matéria" })).toBe(
      "Corpo da matéria"
    );
    expect(makeSnippet({ subtitle: null, text: "" })).toBeNull();
  });

  it("corta em palavra, com reticências, no máximo 280 chars", () => {
    const long = Array.from({ length: 80 }, (_, i) => `palavra${i}`).join(" ");
    const snippet = makeSnippet({ subtitle: null, text: long });
    expect(snippet).not.toBeNull();
    expect(snippet!.length).toBeLessThanOrEqual(280);
    expect(snippet!.endsWith("…")).toBe(true);
    expect(snippet!.slice(0, -1)).toMatch(/palavra\d+$/);
  });
});
