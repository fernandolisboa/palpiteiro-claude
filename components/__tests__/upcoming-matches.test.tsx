import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  INITIAL_BATCH,
  UpcomingMatchesMobile,
} from "@/components/upcoming-matches-mobile";
import { MatchModelLine } from "@/components/match-model-line";
import { UpcomingMatchesDesktop } from "@/components/upcoming-matches-desktop";
import type { MatchListRowView } from "@/lib/view/types";

function fakeMatch(i: number): MatchListRowView {
  return {
    id: `m${i}`,
    home: { name: `Casa ${i}`, short: "CAS", hue: 120 },
    away: { name: `Fora ${i}`, short: "FOR", hue: 210 },
    league: "wc",
    kickoff: "10 jun, 16:00",
    when: "amanhã",
    odds: {
      // Chips densos da match-list usam o label CURTO ("Over"/"Under") — espelha
      // toMatchRowOdds. Forma N-vias (#173): outcomes na ordem canônica.
      outcomes: [
        { label: "Over", odd: "1.90" },
        { label: "Under", odd: "1.95" },
      ],
    },
    hasPrediction: false,
    status: "scheduled",
    isInProgress: false,
    homeScore: null,
    awayScore: null,
    day: { key: "2026-06-10", label: "Hoje" },
    time: "16:00",
  };
}

function fakeMatches(n: number): MatchListRowView[] {
  return Array.from({ length: n }, (_, i) => fakeMatch(i));
}

// Conta linhas pelo marcador estável que cada MatchRow / linha desktop emite:
// o href `/match/<id>`. useState renderiza seu valor INICIAL sob
// renderToStaticMarkup, então o lote inicial é testável sem DOM.
function countRows(html: string): number {
  return html.split('href="/match/').length - 1;
}

describe("UpcomingMatchesMobile reveal (#134)", () => {
  it("renderiza só o lote inicial e mostra 'Carregar mais' quando há mais", () => {
    const html = renderToStaticMarkup(
      <UpcomingMatchesMobile matches={fakeMatches(16)} />,
    );
    expect(countRows(html)).toBe(INITIAL_BATCH);
    expect(html).toContain("Carregar mais");
  });

  it("renderiza todas as linhas e oculta 'Carregar mais' quando cabem no lote", () => {
    const html = renderToStaticMarkup(
      <UpcomingMatchesMobile matches={fakeMatches(10)} />,
    );
    expect(countRows(html)).toBe(10);
    expect(html).not.toContain("Carregar mais");
  });
});

describe("UpcomingMatchesDesktop reveal (#134)", () => {
  it("aplica o mesmo reveal de lote inicial na grade desktop", () => {
    const html = renderToStaticMarkup(
      <UpcomingMatchesDesktop matches={fakeMatches(16)} />,
    );
    expect(countRows(html)).toBe(INITIAL_BATCH);
    expect(html).toContain("Carregar mais");
  });
});

describe("aviso no fim da lista cortada no teto", () => {
  const note = "Pra ver além, use Escolher datas.";

  it("aparece só depois de revelar tudo, nas duas árvores", () => {
    for (const List of [UpcomingMatchesMobile, UpcomingMatchesDesktop]) {
      expect(renderToStaticMarkup(<List matches={fakeMatches(10)} endNote={note} />)).toContain(
        note,
      );
      // Ainda há "Carregar mais": o aviso espera.
      expect(
        renderToStaticMarkup(<List matches={fakeMatches(16)} endNote={note} />),
      ).not.toContain(note);
    }
  });
});

describe("UpcomingMatchesDesktop chip N-vias (1X2) — #173 PR-2", () => {
  it("renderiza os 3 outcomes 1X2 no chip desktop (bloco byte-distinto do mobile)", () => {
    const m: MatchListRowView = {
      ...fakeMatch(0),
      odds: {
        outcomes: [
          { label: "Casa", odd: "2.10" },
          { label: "Empate", odd: "3.40" },
          { label: "Fora", odd: "3.90" },
        ],
      },
    };
    const html = renderToStaticMarkup(<UpcomingMatchesDesktop matches={[m]} />);
    expect(html).toContain("Casa");
    expect(html).toContain("Empate");
    expect(html).toContain("Fora");
    expect(html).toContain("2.10");
    expect(html).toContain("3.90");
  });
});

describe("lista agrupada por dia, odds numa linha (#577)", () => {
  const oneX2 = {
    outcomes: [
      { label: "CAS", odd: "2,10" },
      { label: "Empate", odd: "3,40" },
      { label: "FOR", odd: "3,90" },
    ],
  };
  function dayRows(): MatchListRowView[] {
    return [
      { ...fakeMatch(0), time: "19:00" },
      { ...fakeMatch(1), time: "21:30", startsIn: "em 2h 15min" },
      { ...fakeMatch(2), day: { key: "2026-06-11", label: "Amanhã" }, time: "16:00" },
      { ...fakeMatch(3), day: { key: "2026-06-13", label: "Sábado 13/06" }, time: "11:00" },
    ];
  }
  const both = (matches: MatchListRowView[]) => [
    renderToStaticMarkup(<UpcomingMatchesMobile matches={matches} />),
    renderToStaticMarkup(<UpcomingMatchesDesktop matches={matches} />),
  ];

  it("um cabeçalho por dia, na ordem, e todas as linhas", () => {
    for (const html of both(dayRows())) {
      const headings = [...html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((x) => x[1]);
      expect(headings).toEqual(["Hoje", "Amanhã", "Sábado 13/06"]);
      expect(countRows(html)).toBe(4);
    }
  });

  it("a hora simples na linha, a contagem só quando existe, sem a data", () => {
    for (const html of both(dayRows())) {
      expect(html).toContain(">19:00<");
      expect(html).toContain(">em 2h 15min<");
      expect(html).not.toContain(">21:30<");
      // O `kickoff` com data ("10 jun, 16:00") é do /time; aqui não aparece.
      expect(html).not.toContain("10 jun, 16:00");
    }
  });

  it("odds lado a lado: um grid de 3 células no 1X2 e de 2 no total de gols", () => {
    for (const html of both([{ ...fakeMatch(0), odds: oneX2 }])) {
      const grid = html.match(/<div class="grid gap-x-3 text-right grid-cols-3">(.*?)<\/div>/)?.[1];
      expect(grid).toBeDefined();
      expect(grid?.match(/flex min-w-10 flex-col/g)).toHaveLength(3);
      expect(grid).toContain(">Empate<");
      expect(grid).toContain(">3,40<");
    }
    for (const html of both([fakeMatch(0)])) {
      expect(html).toContain('class="grid gap-x-3 text-right grid-cols-2"');
    }
  });

  it("o alvo do tour é o primeiro analisável da lista plana, mesmo em outro dia", () => {
    const rows = dayRows().map((m, i) => ({ ...m, analyzable: i === 2 }));
    for (const html of both(rows)) {
      expect(html.match(/data-tour="match-row"/g)).toHaveLength(1);
      expect(html).toMatch(/data-tour="match-row"[^>]*href="\/match\/m2"|href="\/match\/m2"[^>]*data-tour="match-row"/);
    }
  });

  it("'analisado' como selo, com a palavra, nas duas árvores", () => {
    for (const html of both([{ ...fakeMatch(0), hasPrediction: true }])) {
      expect(html).toContain("border-accent-border bg-accent-soft text-accent-fg");
      expect(html).toContain("analisado");
    }
  });

  it("desktop sem coluna de status nem cabeçalho de grade", () => {
    const html = renderToStaticMarkup(<UpcomingMatchesDesktop matches={dayRows()} />);
    expect(html).not.toContain("liga · kickoff");
    expect(html).not.toContain(">status<");
    expect(html).toContain("grid-cols-[132px_1fr_auto_24px]");
  });
});

describe("linha da base do modelo (#555)", () => {
  const model = {
    favorite: { label: "Casa", pct: "52%" },
    goals25: { label: "Under 2.5", pct: "55%" },
  };
  // Texto visível (sem tags/atributos), pra checar a linguagem da linha.
  const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  it("aparece no mobile e no desktop só quando há `model`", () => {
    const withModel: MatchListRowView = { ...fakeMatch(0), model };
    for (const html of [
      renderToStaticMarkup(<UpcomingMatchesMobile matches={[withModel]} />),
      renderToStaticMarkup(<UpcomingMatchesDesktop matches={[withModel]} />),
    ]) {
      expect(text(html)).toContain("Modelo: Casa 52% · Under 2.5 55%");
    }
    for (const html of [
      renderToStaticMarkup(<UpcomingMatchesMobile matches={[fakeMatch(0)]} />),
      renderToStaticMarkup(<UpcomingMatchesDesktop matches={[fakeMatch(0)]} />),
    ]) {
      expect(html).not.toContain("Modelo:");
    }
  });

  it("MatchModelLine em 12px, rótulo sans e mono só nos números (#577)", () => {
    const html = renderToStaticMarkup(<MatchModelLine model={model} className="mt-1" />);
    expect(html).toContain('class="text-body-sm text-muted-foreground mt-1"');
    expect(html).not.toContain("text-meta");
    // Mono só nas porcentagens; o rótulo "Modelo:" e os nomes ficam fora do mono.
    expect(html.match(/<span class="font-mono tabular-nums">[^<]*<\/span>/g)).toEqual([
      '<span class="font-mono tabular-nums">52%</span>',
      '<span class="font-mono tabular-nums">55%</span>',
    ]);
    expect(renderToStaticMarkup(<MatchModelLine model={model} />)).toContain(
      'class="text-body-sm text-muted-foreground"',
    );
  });

  it("só probabilidade: sem edge, valor ou odd na linha", () => {
    const html = renderToStaticMarkup(
      <UpcomingMatchesMobile
        matches={[{ ...fakeMatch(0), odds: null, model }]}
      />,
    );
    const line = text(html).match(/Modelo:[^]*?55%/)?.[0] ?? "";
    expect(line).not.toBe("");
    expect(line).not.toMatch(/edge|valor|odd/i);
  });
});
