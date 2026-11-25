// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import {
  __clearFeedCacheForTesting,
  canonicalUrl,
  fetchFeed,
  filterFeedItems,
  geFeedUrl,
  getNewsViaTeamFeeds,
} from "../ge-rss";
import { parseRssItems } from "../rss-parse";
import type { NewsMatchContext } from "../types";

// Feed real do ge (Flamengo, 21/11/2026), aparado. Itens (na ordem do feed):
//   escalação (21/11 18:30) · onde assistir (21/11 06:00) · "final" (21/11 13:00) ·
//   três desfalques (20/11 20:02) · Palmeiras só no corpo · gato-mestre · basquete ·
//   contas do título (18/11 09:00, fora da janela) · escalação repetida com ?utm#frag
const FLAMENGO_XML = readFileSync(
  path.join(__dirname, "fixtures/ge-flamengo.xml"),
  "utf8"
);
const FLAMENGO_URL = geFeedUrl("flamengo");
const PALMEIRAS_URL = geFeedUrl("palmeiras");

const NOW = Date.parse("2026-11-21T19:00:00.000Z");
const KICKOFF = "2026-11-21T19:30:00.000Z";

const CTX: NewsMatchContext = {
  league: "brasileirao_a",
  homeTeam: "SE Palmeiras",
  awayTeam: "CR Flamengo",
  kickoffAt: KICKOFF,
};

function item(args: {
  title: string;
  link: string;
  date: string;
  subtitle?: string;
}): string {
  return `<item><title>${args.title}</title>${
    args.subtitle ? `<atom:subtitle>${args.subtitle}</atom:subtitle>` : ""
  }<link>${args.link}</link><description><![CDATA[<img src="x.jpg" />]]> Corpo.</description><pubDate>${args.date}</pubDate></item>`;
}

function feed(items: string[]): string {
  return `<?xml version="1.0"?><rss xmlns:atom="http://www.w3.org/2005/Atom" version="2.0"><channel><title>ge</title>${items.join("")}</channel></rss>`;
}

// Feed do Palmeiras: uma matéria própria e a MESMA "onde assistir" do feed do Flamengo.
const PALMEIRAS_XML = feed([
  item({
    title:
      "Palmeiras e Flamengo têm 13 jogadores pendurados antes de confronto decisivo",
    link: "https://ge.globo.com/futebol/times/palmeiras/noticia/2026/11/21/pendurados.ghtml",
    date: "Sat, 21 Nov 2026 12:00:00 -0000",
  }),
  item({
    title: "Palmeiras x Flamengo: onde assistir ao vivo, horário e escalações",
    link: "https://ge.globo.com/futebol/brasileirao-serie-a/noticia/2026/11/21/palmeiras-x-flamengo-onde-assistir-ao-vivo-horario-e-escalacoes.ghtml",
    date: "Sat, 21 Nov 2026 06:00:00 -0000",
  }),
]);

function xmlResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/rss+xml" },
    ...init,
  });
}

const fetchMock = vi.fn();

function serve(routes: Record<string, () => Promise<Response> | Response>) {
  fetchMock.mockImplementation(async (url: string) => {
    const route = routes[url];
    if (!route) throw new Error(`unexpected fetch ${url}`);
    return route();
  });
}

let errSpy: MockInstance<typeof console.error>;

beforeEach(() => {
  __clearFeedCacheForTesting();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("filterFeedItems — feed real do ge", () => {
  const items = parseRssItems(FLAMENGO_XML);

  it("janela, caminho, menção ao adversário só no título/linha fina, dedupe e ranking", () => {
    const out = filterFeedItems(items, {
      anchorMs: NOW,
      opponent: "SE Palmeiras",
    });
    expect(out.map((r) => r.title)).toEqual([
      // escalação/desfalque sobem antes da data
      "Com Carrascal no banco, veja a escalação do Flamengo para enfrentar o Palmeiras",
      "Palmeiras x Flamengo: onde assistir ao vivo, horário e escalações",
      "Escalação do Flamengo: Jardim tem três desfalques e terá que mudar time para decisão contra Palmeiras",
      // depois, por data
      'Flamengo e Palmeiras fazem "final" em Brasileirão de domínio sobre concorrentes',
    ]);
    // Fora: Palmeiras só no corpo, gato-mestre, basquete, fora da janela, duplicata.
  });

  it("cada item leva fonte, data ISO e o trecho da linha fina", () => {
    const [first] = filterFeedItems(items, {
      anchorMs: NOW,
      opponent: "SE Palmeiras",
    });
    expect(first).toMatchObject({
      url: "https://ge.globo.com/futebol/times/flamengo/noticia/2026/11/21/veja-a-escalacao-do-flamengo-para-enfrentar-o-palmeiras.ghtml",
      source: "ge",
      publishedAt: "2026-11-21T18:30:25.000Z",
      snippet:
        "Time de Leonardo Jardim pode garantir o título do Brasileirão neste sábado",
    });
  });

  it("nada publicado depois da âncora entra; a janela de 72h anda com ela", () => {
    const anchorMs = Date.parse("2026-11-21T07:00:00.000Z");
    const out = filterFeedItems(items, { anchorMs, opponent: "SE Palmeiras" });
    expect(out.map((r) => r.publishedAt)).toEqual([
      "2026-11-21T06:00:00.000Z",
      "2026-11-20T20:02:01.000Z",
      // 18/11 09:00 cabe em 21/11 07:00 − 72h
      "2026-11-18T09:00:01.000Z",
    ]);
  });

  it("adversário que o feed não cita → nada", () => {
    expect(
      filterFeedItems(items, { anchorMs: NOW, opponent: "SC Internacional" })
    ).toEqual([]);
  });

  it("corta em 5 por time", () => {
    const many = parseRssItems(
      feed(
        Array.from({ length: 8 }, (_, i) =>
          item({
            title: `Flamengo encara o Palmeiras, parte ${i}`,
            link: `https://ge.globo.com/futebol/times/flamengo/noticia/${i}.ghtml`,
            date: new Date(NOW - (i + 1) * 3_600_000).toUTCString(),
          })
        )
      )
    );
    const out = filterFeedItems(many, {
      anchorMs: NOW,
      opponent: "SE Palmeiras",
    });
    expect(out).toHaveLength(5);
    expect(out[0].title).toBe("Flamengo encara o Palmeiras, parte 0");
  });

  it("ranking: desfalque/amarelo sobem; técnico sozinho e 'fora de casa' não", () => {
    const xml = feed([
      item({
        title:
          'Jardim cutuca Abel Ferreira antes de Palmeiras x Flamengo: "Os adversários se vitimizam"',
        subtitle:
          'Treinador rubro-negro minimizou declaração do compatriota, que disse que o "título brasileiro está entregue"',
        link: "https://ge.globo.com/futebol/times/flamengo/noticia/2026/11/21/jardim-cutuca-abel-ferreira-antes-de-palmeiras-x-flamengo-os-adversarios-se-vitimizam.ghtml",
        date: "Sat, 21 Nov 2026 18:43:20 -0000",
      }),
      item({
        title: "Flamengo vence fora de casa e mira o Palmeiras",
        link: "https://ge.globo.com/futebol/times/flamengo/noticia/fora.ghtml",
        date: "Sat, 21 Nov 2026 17:00:00 -0000",
      }),
      item({
        title: "Técnico do Flamengo elogia o Palmeiras",
        link: "https://ge.globo.com/futebol/times/flamengo/noticia/tecnico.ghtml",
        date: "Sat, 21 Nov 2026 16:00:00 -0000",
      }),
      item({
        title: "Torcida do Flamengo lota aeroporto antes do Palmeiras",
        link: "https://ge.globo.com/futebol/times/flamengo/noticia/torcida.ghtml",
        date: "Sat, 21 Nov 2026 15:00:00 -0000",
      }),
      item({
        title: "Flamengo e Palmeiras fazem final",
        link: "https://ge.globo.com/futebol/times/flamengo/noticia/final.ghtml",
        date: "Sat, 21 Nov 2026 14:00:00 -0000",
      }),
      item({
        title:
          "Pulgar e Léo Pereira recebem o terceiro amarelo e desfalcam o Flamengo contra o Palmeiras",
        link: "https://ge.globo.com/futebol/times/flamengo/noticia/2026/11/19/pulgar-e-leo-pereira-desfalcam.ghtml",
        date: "Thu, 19 Nov 2026 03:00:00 -0000",
      }),
    ]);
    const out = filterFeedItems(parseRssItems(xml), {
      anchorMs: Math.min(NOW, Date.parse(KICKOFF)),
      opponent: "SE Palmeiras",
      team: "CR Flamengo",
    });
    expect(out.map((r) => r.title)).toEqual([
      // a mais velha, mas é desfalque: sobe e fica dentro do corte de 5
      "Pulgar e Léo Pereira recebem o terceiro amarelo e desfalcam o Flamengo contra o Palmeiras",
      'Jardim cutuca Abel Ferreira antes de Palmeiras x Flamengo: "Os adversários se vitimizam"',
      "Flamengo vence fora de casa e mira o Palmeiras",
      "Técnico do Flamengo elogia o Palmeiras",
      "Torcida do Flamengo lota aeroporto antes do Palmeiras",
    ]);
  });

  it("confronto no link conta como menção (nome ambíguo fora de forma de clube)", () => {
    const at = new Date(NOW - 3_600_000).toUTCString();
    const xml = feed([
      item({
        title: "Dorival define o time para o clássico",
        link: "https://ge.globo.com/futebol/times/corinthians/noticia/2026/11/21/corinthians-x-sao-paulo-escalacao.ghtml",
        date: at,
      }),
      item({
        title: "Dorival define o time para o treino",
        link: "https://ge.globo.com/futebol/times/corinthians/noticia/2026/11/21/treino.ghtml",
        date: at,
      }),
      item({
        title: "Corinthians recebe São Paulo em Itaquera",
        link: "https://ge.globo.com/futebol/times/corinthians/noticia/2026/11/21/recebe.ghtml",
        date: at,
      }),
    ]);
    const out = filterFeedItems(parseRssItems(xml), {
      anchorMs: NOW,
      opponent: "São Paulo FC",
      team: "SC Corinthians Paulista",
    });
    expect(out.map((r) => r.title).sort()).toEqual([
      "Corinthians recebe São Paulo em Itaquera",
      "Dorival define o time para o clássico",
    ]);
  });

  it("allowlist de caminho: /<uf>/futebol/ entra; blog, cartola e http não", () => {
    const xml = feed(
      [
        "https://ge.globo.com/pr/futebol/brasileirao-serie-a/noticia/a.ghtml",
        "https://ge.globo.com/blogs/meia-encarnada/post/b.ghtml",
        "https://ge.globo.com/rs/blogs/vida-real/post/c.ghtml",
        "https://ge.globo.com/cartola/noticia/d.ghtml",
        "https://ge.globo.com/futebol/futebol-internacional/noticia/e.ghtml",
        "http://ge.globo.com/futebol/times/flamengo/noticia/f.ghtml",
        "https://ge.globo.com.evil.com/futebol/g.ghtml",
      ].map((link, i) =>
        item({
          title: `Flamengo x Palmeiras ${i}`,
          link,
          date: new Date(NOW - 3_600_000).toUTCString(),
        })
      )
    );
    const out = filterFeedItems(parseRssItems(xml), {
      anchorMs: NOW,
      opponent: "SE Palmeiras",
    });
    expect(out.map((r) => r.url)).toEqual([
      "https://ge.globo.com/pr/futebol/brasileirao-serie-a/noticia/a.ghtml",
    ]);
  });
});

describe("getNewsViaTeamFeeds", () => {
  it("lê os dois feeds, junta, tira a duplicata entre feeds e ordena", async () => {
    serve({
      [FLAMENGO_URL]: () => xmlResponse(FLAMENGO_XML),
      [PALMEIRAS_URL]: () => xmlResponse(PALMEIRAS_XML),
    });
    const out = await getNewsViaTeamFeeds(CTX);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.partial).toBe(false);
    expect(out.results.map((r) => r.title)).toEqual([
      "Com Carrascal no banco, veja a escalação do Flamengo para enfrentar o Palmeiras",
      "Palmeiras e Flamengo têm 13 jogadores pendurados antes de confronto decisivo",
      "Palmeiras x Flamengo: onde assistir ao vivo, horário e escalações",
      "Escalação do Flamengo: Jardim tem três desfalques e terá que mudar time para decisão contra Palmeiras",
      'Flamengo e Palmeiras fazem "final" em Brasileirão de domínio sobre concorrentes',
    ]);
    expect(out.results.every((r) => r.source === "ge")).toBe(true);
    // Cada resultado sabe de qual feed veio (#672); nenhum feed falhou.
    expect(out.failedSides).toEqual([]);
    expect(Object.keys(out.sideByUrl).sort()).toEqual(
      out.results.map((r) => canonicalUrl(r.url)).sort()
    );
    // O resultado não carrega campo interno do ranking.
    expect(Object.keys(out.results[0]).sort()).toEqual([
      "publishedAt",
      "snippet",
      "source",
      "title",
      "url",
    ]);
    // User-Agent explícito.
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(
      /Palpiteiro/
    );
  });

  it("corte total em 10", async () => {
    const big = (team: string) =>
      feed(
        Array.from({ length: 8 }, (_, i) =>
          item({
            title: `Palmeiras x Flamengo ${team} ${i}`,
            link: `https://ge.globo.com/futebol/times/${team}/noticia/${i}.ghtml`,
            date: new Date(NOW - (i + 1) * 3_600_000).toUTCString(),
          })
        )
      );
    serve({
      [FLAMENGO_URL]: () => xmlResponse(big("flamengo")),
      [PALMEIRAS_URL]: () => xmlResponse(big("palmeiras")),
    });
    const out = await getNewsViaTeamFeeds(CTX);
    expect(out.kind === "ok" && out.results.length).toBe(10);
  });

  it("um feed com timeout não derruba o outro (meia falha)", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === FLAMENGO_URL)
        return Promise.resolve(xmlResponse(FLAMENGO_XML));
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted"))
        );
      });
    });
    // Prazo apertado: timeout = restante − 1s = 100ms.
    const out = await getNewsViaTeamFeeds(CTX, {
      deadlineAt: NOW + 1_100,
      matchId: "m-1",
    });
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.partial).toBe(true);
    expect(out.results.length).toBeGreaterThan(0);
    // O feed do Palmeiras (mandante) caiu; o que veio é do feed do Flamengo.
    expect(out.failedSides).toEqual(["home"]);
    expect(
      out.results.every((r) => out.sideByUrl[canonicalUrl(r.url)] === "away")
    ).toBe(true);
    const logged = errSpy.mock.calls.map((c) => String(c[0]));
    expect(
      logged.some(
        (l) => l.includes("news_feed_failed") && l.includes("timeout")
      )
    ).toBe(true);
  });

  it("todos os feeds falham → all_failed", async () => {
    serve({
      [FLAMENGO_URL]: () => xmlResponse("erro", { status: 503 }),
      [PALMEIRAS_URL]: () => Promise.reject(new Error("ECONNRESET")),
    });
    expect(await getNewsViaTeamFeeds(CTX)).toEqual({ kind: "all_failed" });
  });

  it("nenhum time com feed → no_sources, sem rede", async () => {
    const out = await getNewsViaTeamFeeds({
      league: "premier_league",
      homeTeam: "Arsenal FC",
      awayTeam: "Chelsea FC",
      kickoffAt: KICKOFF,
    });
    expect(out).toEqual({ kind: "no_sources" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("só um time com feed (Libertadores contra estrangeiro) → lê só esse", async () => {
    serve({ [FLAMENGO_URL]: () => xmlResponse(FLAMENGO_XML) });
    const out = await getNewsViaTeamFeeds({
      league: "copa_libertadores",
      homeTeam: "Flamengo",
      awayTeam: "Estudiantes de La Plata",
      kickoffAt: KICKOFF,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Adversário fora da tabela: o vazio não prova "nada novo" (combined decide).
    expect(out).toEqual({
      kind: "ok",
      results: [],
      partial: false,
      unknownOpponent: true,
      sideByUrl: {},
      failedSides: [],
    });
  });

  it("estrangeiro casa por token: 'Flamengo x Estudiantes', 'a LDU', 'x River'", async () => {
    const at = new Date(NOW - 3_600_000).toUTCString();
    serve({
      [FLAMENGO_URL]: () =>
        xmlResponse(
          feed([
            item({
              title: "Flamengo x Estudiantes: onde assistir ao vivo",
              link: "https://ge.globo.com/futebol/libertadores/noticia/a.ghtml",
              date: at,
            }),
            item({
              title: "Flamengo encara a LDU na altitude",
              link: "https://ge.globo.com/futebol/libertadores/noticia/b.ghtml",
              date: at,
            }),
            item({
              title: "Flamengo x River: escalações",
              link: "https://ge.globo.com/futebol/libertadores/noticia/c.ghtml",
              date: at,
            }),
          ])
        ),
    });
    const titles = async (awayTeam: string) => {
      __clearFeedCacheForTesting();
      const out = await getNewsViaTeamFeeds({
        league: "copa_libertadores",
        homeTeam: "Flamengo",
        awayTeam,
        kickoffAt: KICKOFF,
      });
      return out.kind === "ok" ? out.results.map((r) => r.title) : [];
    };
    expect(await titles("Estudiantes de La Plata")).toEqual([
      "Flamengo x Estudiantes: onde assistir ao vivo",
    ]);
    expect(await titles("LDU de Quito")).toEqual([
      "Flamengo encara a LDU na altitude",
    ]);
    expect(await titles("River Plate")).toEqual([
      "Flamengo x River: escalações",
    ]);
  });

  it("tira a duplicata entre feeds ANTES do corte por time", async () => {
    const shared = Array.from({ length: 5 }, (_, i) =>
      item({
        title: `Palmeiras x Flamengo: bastidores ${i}`,
        link: `https://ge.globo.com/futebol/brasileirao-serie-a/noticia/shared-${i}.ghtml`,
        date: new Date(NOW - (i + 1) * 3_600_000).toUTCString(),
      })
    );
    const own = (team: string) =>
      item({
        title: `Matéria só do ${team} sobre o jogo contra o ${team === "Flamengo" ? "Palmeiras" : "Flamengo"}`,
        link: `https://ge.globo.com/futebol/times/${team.toLowerCase()}/noticia/own.ghtml`,
        date: new Date(NOW - 10 * 3_600_000).toUTCString(),
      });
    serve({
      [PALMEIRAS_URL]: () => xmlResponse(feed([...shared, own("Palmeiras")])),
      [FLAMENGO_URL]: () => xmlResponse(feed([...shared, own("Flamengo")])),
    });
    const out = await getNewsViaTeamFeeds(CTX);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    const urls = out.results.map((r) => r.url);
    expect(new Set(urls).size).toBe(urls.length);
    // As 5 compartilhadas vieram pelo feed do Palmeiras; não comem a vaga da matéria
    // própria do Flamengo.
    expect(urls).toContain(
      "https://ge.globo.com/futebol/times/flamengo/noticia/own.ghtml"
    );
    expect(out.results).toHaveLength(6);
  });
});

describe("fetchFeed — saúde do feed e cache", () => {
  it("200 que não é feed (página HTML) → falha", async () => {
    serve({
      [FLAMENGO_URL]: () => xmlResponse("<!doctype html><html>ops</html>"),
    });
    expect(await fetchFeed(FLAMENGO_URL, undefined)).toEqual({
      ok: false,
      reason: "not_a_feed",
    });
  });

  it("feed sem item → falha", async () => {
    serve({ [FLAMENGO_URL]: () => xmlResponse(feed([])) });
    expect(await fetchFeed(FLAMENGO_URL, undefined)).toEqual({
      ok: false,
      reason: "no_items",
    });
  });

  it("item mais novo com mais de 7 dias → feed parado = falha", async () => {
    serve({
      [FLAMENGO_URL]: () =>
        xmlResponse(
          feed([
            item({
              title: "Velho",
              link: "https://ge.globo.com/futebol/a",
              date: new Date(NOW - 8 * 86_400_000).toUTCString(),
            }),
          ])
        ),
    });
    expect(await fetchFeed(FLAMENGO_URL, undefined)).toEqual({
      ok: false,
      reason: "stale_feed",
    });
  });

  it("content-length acima de 2 MB → falha sem ler o corpo", async () => {
    serve({
      [FLAMENGO_URL]: () =>
        xmlResponse(FLAMENGO_XML, {
          headers: { "content-length": String(3 * 1024 * 1024) },
        }),
    });
    expect(await fetchFeed(FLAMENGO_URL, undefined)).toEqual({
      ok: false,
      reason: "too_large",
    });
  });

  it("corpo acima de 2 MB sem content-length → corta e falha", async () => {
    serve({
      [FLAMENGO_URL]: () =>
        xmlResponse(`<rss><channel>${"x".repeat(2 * 1024 * 1024)}`),
    });
    expect(await fetchFeed(FLAMENGO_URL, undefined)).toEqual({
      ok: false,
      reason: "too_large",
    });
  });

  it("sem tempo (prazo a menos de 1s) → falha sem rede", async () => {
    expect(await fetchFeed(FLAMENGO_URL, NOW + 500)).toEqual({
      ok: false,
      reason: "no_time",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cacheia só sucesso, por 10 minutos", async () => {
    serve({ [FLAMENGO_URL]: () => xmlResponse("erro", { status: 500 }) });
    expect((await fetchFeed(FLAMENGO_URL, undefined)).ok).toBe(false);
    serve({ [FLAMENGO_URL]: () => xmlResponse(FLAMENGO_XML) });
    expect((await fetchFeed(FLAMENGO_URL, undefined)).ok).toBe(true);
    expect((await fetchFeed(FLAMENGO_URL, undefined)).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.spyOn(Date, "now").mockReturnValue(NOW + 11 * 60_000);
    expect((await fetchFeed(FLAMENGO_URL, undefined)).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
