import { describe, expect, it } from "vitest";

import { resolvePregamePick, type PalpitePick } from "@/lib/ai/palpites/pick";
import { containsValueLanguage } from "@/lib/ai/palpites/value-language-guard";
import { NEWS_NOUL } from "@/lib/match-news/apply";
import { USER_NOUL } from "@/lib/user-palpite/evidence";
import {
  CONFIRMED_NOUL,
  alsoReadLine,
  barGeometry,
  factorText,
  laneDots,
  movesOf,
  originLine,
  startLine,
  summaryOf,
  toWeighedView,
  type PalpiteWeighedView,
  type WeighedTeams,
} from "@/lib/view/palpite-weighed";

import {
  NAO_VIRA,
  VIRA,
  codeJev,
  mr,
  ou,
  type Scenario,
} from "@/lib/ai/palpites/__tests__/weighed-fixtures";

const TEAMS: WeighedTeams = {
  home: { name: "Atlético-MG", short: "CAM" },
  away: { name: "Boca Juniors", short: "BOC" },
};

function scenarioPick(s: Scenario): PalpitePick {
  const j = codeJev({ base: { home: 1, away: 1 }, jev: s.jev, user: s.user });
  return resolvePregamePick([mr(s.odds, j), ou(...s.ou)])!;
}

const viraPick = scenarioPick(VIRA);
const naoViraPick = scenarioPick(NAO_VIRA);

function allText(v: PalpiteWeighedView): string[] {
  return [
    v.start.prefix,
    v.start.text,
    ...v.rows.flatMap((r) => [
      r.short,
      r.long,
      r.originLine,
      ...r.lanes.map((l) => l.sr),
    ]),
    ...v.summary.short,
    v.summary.long,
    v.alsoRead?.label ?? "",
    v.alsoRead?.text ?? "",
    v.sr,
  ];
}

describe("movesOf", () => {
  it("um perdedor e dois ganhadores: duas raias, a mais perto primeiro", () => {
    expect(movesOf({ home: -2, draw: 1, away: 1 })).toEqual([
      { from: "home", to: "draw", pts: 1 },
      { from: "home", to: "away", pts: 1 },
    ]);
    expect(movesOf({ home: 1, draw: 1, away: -2 })).toEqual([
      { from: "away", to: "draw", pts: 1 },
      { from: "away", to: "home", pts: 1 },
    ]);
  });

  it("dois perdedores e um ganhador", () => {
    expect(movesOf({ home: -1, draw: -1, away: 2 })).toEqual([
      { from: "draw", to: "away", pts: 1 },
      { from: "home", to: "away", pts: 1 },
    ]);
  });

  it("empate perde pros dois times: o mandante antes (R18)", () => {
    expect(movesOf({ home: 1, draw: -2, away: 1 })).toEqual([
      { from: "draw", to: "home", pts: 1 },
      { from: "draw", to: "away", pts: 1 },
    ]);
  });

  it("tudo zero: nenhuma raia", () => {
    expect(movesOf({ home: 0, draw: 0, away: 0 })).toEqual([]);
  });
});

describe("raias: bolinhas e vagas", () => {
  it("no máximo 4 bolinhas, posições e atrasos do mock", () => {
    expect(laneDots(2)).toEqual([
      { to: 18, delay: 0 },
      { to: 12.5, delay: 0.09 },
    ]);
    expect(laneDots(9)).toHaveLength(4);
  });

  it("vagas numeradas de cima pra baixo, presas em 7; os arcos continuam a numeração", () => {
    const factors = [
      "attack_weakened",
      "defense_weakened",
      "rotation_risk",
      "high_stakes",
    ].flatMap((f) =>
      (["home", "away"] as const).map((side) => ({
        key: `${f}_${side}`,
        origin: "jev",
        value: 0.9,
        multiplier: 1.01,
        pts: { home: -1, draw: 0, away: 1 },
      }))
    );
    const pick = {
      outcome: "away",
      source: "market",
      weighed: {
        version: "palpite_weighed_v1",
        baseOutcome: "home",
        basePts: { home: 50, draw: 25, away: 25 },
        finalPts: { home: 42, draw: 25, away: 33 },
        factors,
      },
    };
    const v = toWeighedView(pick, TEAMS)!;
    expect(v.rows.flatMap((r) => r.lanes.map((l) => l.slot))).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(v.bar.flows[0].dests[0].slot).toBe(7);
  });
});

describe("barGeometry — os dois cenários", () => {
  it("vira (37/30/33 → 34/30/36): uma tira de saída do CAM e uma de chegada do BOC", () => {
    const w = viraPick.weighed!;
    const g = barGeometry(w.basePts, w.finalPts, 4);
    expect(g.hatches).toEqual([
      { left: 34, width: 3, tint: "away", dir: 1 },
      { left: 64, width: 3, tint: "away", dir: 1 },
    ]);
    expect(g.flows).toEqual([
      { x0: 35.5, dests: [{ x: 65.5, pts: 3, key: "away", slot: 4 }] },
    ]);
    expect(g.arcsHeight).toBe(22);
  });

  it("não vira (52/27/21 → 51/28/21): o ponto do CAM vai pro meio do empate, sem listra no empate", () => {
    const w = naoViraPick.weighed!;
    const g = barGeometry(w.basePts, w.finalPts, 3);
    expect(g.hatches).toEqual([{ left: 51, width: 1, tint: "draw", dir: 1 }]);
    expect(g.flows).toEqual([
      { x0: 51.5, dests: [{ x: 65, pts: 1, key: "draw", slot: 3 }] },
    ]);
    expect(g.arcsHeight).toBe(22);
  });

  it("dois destinos do mesmo lado: leque, 32 px, o de dentro primeiro (mock v6)", () => {
    const g = barGeometry(
      { home: 52, draw: 27, away: 21 },
      { home: 50, draw: 28, away: 22 },
      4
    );
    expect(g.hatches).toEqual([
      { left: 50, width: 1, tint: "draw", dir: 1 },
      { left: 51, width: 1, tint: "away", dir: 1 },
      { left: 78, width: 1, tint: "away", dir: 1 },
    ]);
    expect(g.flows).toEqual([
      {
        x0: 51,
        dests: [
          { x: 64, pts: 1, key: "draw", slot: 4 },
          { x: 78.5, pts: 1, key: "away", slot: 5 },
        ],
      },
    ]);
    expect(g.arcsHeight).toBe(32);
  });

  it("sem mudança na barra: nenhum arco, altura 0", () => {
    const b = { home: 40, draw: 30, away: 30 };
    expect(barGeometry(b, b, 0)).toEqual({
      hatches: [],
      flows: [],
      arcsHeight: 0,
    });
  });
});

describe("textos", () => {
  it("startLine nos limiares", () => {
    const at = (home: number, draw: number, away: number) =>
      startLine(
        { home, draw, away },
        home >= away ? "home" : "away",
        "market",
        TEAMS
      ).text;
    expect(at(36, 30, 34)).toBe("jogo parelho");
    expect(at(37, 30, 33)).toBe("Atlético-MG um pouco à frente");
    expect(at(45, 22, 33)).toBe("Atlético-MG um pouco à frente");
    expect(at(46, 21, 33)).toBe("Atlético-MG bem à frente");
    expect(
      startLine({ home: 30, draw: 36, away: 34 }, "draw", "dc_jev", TEAMS)
    ).toEqual({
      prefix: "Ponto de partida, o modelo de força dos times:",
      text: "jogo parelho",
    });
    expect(
      startLine({ home: 30, draw: 40, away: 30 }, "draw", "market", TEAMS).text
    ).toBe("empate um pouco à frente");
  });

  it("frases dos fatores, curtas e longas; chave desconhecida → null", () => {
    expect(factorText("attack_weakened_home", TEAMS, "short")).toBe(
      "Atlético-MG sem peça no ataque"
    );
    expect(factorText("high_stakes_away", TEAMS, "short")).toBe(
      "Jogo de peso pro Boca Juniors"
    );
    expect(factorText("defense_weakened_away", TEAMS, "long")).toBe(
      "Desfalques ou titulares poupados atingem a defesa do Boca Juniors"
    );
    expect(factorText("lineup_change_home", TEAMS, "short")).toBeNull();
  });

  it("linha de origem: escala de 2 níveis do narrador e as palavras da C2 do #672", () => {
    expect(originLine("jev", 0.9)).toBe("contexto do jogo (JEV) · sinal forte");
    expect(originLine("jev", 0.7)).toBe(
      "contexto do jogo (JEV) · sinal moderado"
    );
    expect(originLine("news", 0.7)).toBe(
      "segundo o ge (não conferido com os nossos dados)"
    );
    expect(originLine("news", 0.85)).toBe(
      "segundo o ge (confirmado pelos nossos dados)"
    );
    expect(originLine("user", 0.7)).toBe("você contou (não conferido)");
    expect(originLine("user", 0.85)).toBe("você contou (conferido)");
    expect(originLine("lineup", 0.9)).toBe("ajuste do modelo");
  });

  it("CONFIRMED_NOUL é o noul de confirmada do usuário e da notícia", () => {
    expect(CONFIRMED_NOUL).toBe(USER_NOUL.confirmed);
    expect(CONFIRMED_NOUL).toBe(NEWS_NOUL.confirmed);
  });

  it("alsoRead conta as notícias citadas (R21)", () => {
    expect(alsoReadLine("market", 0, false).text).toBe(
      "forma recente, confrontos e tabela (já estão nos preços)."
    );
    expect(alsoReadLine("dc_jev", 3, false).text).toBe(
      "forma recente, confrontos e tabela (já estão no modelo) e 3 notícias do ge citadas (entram só no texto)."
    );
    expect(alsoReadLine("market", 1, true).text).toBe(
      "forma recente, confrontos e tabela (já estão nos preços) e 1 notícia do ge citada."
    );
  });
});

describe("summaryOf — os casos", () => {
  const base = { home: 37, draw: 30, away: 33 };
  const args = {
    basePts: base,
    baseOutcome: "home" as const,
    source: "market" as const,
    teams: TEAMS,
  };

  it("virou, por pouco", () => {
    const s = summaryOf({
      ...args,
      finalPts: { home: 34, draw: 30, away: 36 },
      outcome: "away",
      factorPts: [{ home: -3, draw: 0, away: 3 }],
    });
    expect(s).toEqual({
      kind: "flip",
      icon: "flip",
      short: ["Virou pro Boca Juniors, por pouco"],
      long: "Os preços viam o Atlético-MG um pouco à frente. Os ajustes viraram pro Boca Juniors, por pouco.",
    });
  });

  it("virou com folga e virou pro empate", () => {
    expect(
      summaryOf({
        ...args,
        finalPts: { home: 30, draw: 25, away: 45 },
        outcome: "away",
        factorPts: [{ home: -7, draw: -5, away: 12 }],
      }).short
    ).toEqual(["Virou pro Boca Juniors"]);
    expect(
      summaryOf({
        ...args,
        finalPts: { home: 33, draw: 36, away: 31 },
        outcome: "draw",
        factorPts: [{ home: -4, draw: 6, away: -2 }],
      }).short
    ).toEqual(["Virou pro empate, por pouco"]);
  });

  it("continua: quase se anulam (ajustes pros dois lados)", () => {
    const s = summaryOf({
      ...args,
      basePts: { home: 52, draw: 27, away: 21 },
      finalPts: { home: 51, draw: 28, away: 21 },
      outcome: "home",
      factorPts: [
        { home: -2, draw: 1, away: 1 },
        { home: 1, draw: 0, away: -1 },
      ],
    });
    expect(s.short).toEqual([
      "Continua Atlético-MG:",
      "os ajustes quase se anulam",
    ]);
    expect(s.long).toBe(
      "Os preços já viam o Atlético-MG bem à frente. Os ajustes quase se anulam e o palpite fica com ele."
    );
  });

  it("continua: mexeram pouco (um lado só, |Δ| ≤ 2)", () => {
    const s = summaryOf({
      ...args,
      basePts: { home: 52, draw: 27, away: 21 },
      finalPts: { home: 50, draw: 28, away: 22 },
      outcome: "home",
      factorPts: [{ home: -2, draw: 1, away: 1 }],
    });
    expect(s.short).toEqual([
      "Continua Atlético-MG:",
      "os ajustes mexeram pouco",
    ]);
  });

  it("continua: reforçaram / com menos folga", () => {
    expect(
      summaryOf({
        ...args,
        finalPts: { home: 41, draw: 29, away: 30 },
        outcome: "home",
        factorPts: [{ home: 4, draw: -1, away: -3 }],
      }).short
    ).toEqual(["Continua Atlético-MG:", "os ajustes reforçaram"]);
    const less = summaryOf({
      ...args,
      basePts: { home: 52, draw: 27, away: 21 },
      finalPts: { home: 47, draw: 29, away: 24 },
      outcome: "home",
      factorPts: [{ home: -5, draw: 2, away: 3 }],
    });
    expect(less.short).toEqual(["Continua Atlético-MG,", "com menos folga"]);
    expect(less.long).toBe(
      "Os preços já viam o Atlético-MG bem à frente. Os ajustes tiraram folga, mas o palpite fica com ele."
    );
  });

  it("nenhum fator: vale a base", () => {
    const s = summaryOf({
      ...args,
      finalPts: base,
      outcome: "home",
      factorPts: [],
    });
    expect(s).toMatchObject({
      kind: "none",
      short: ["Nenhum ajuste mexeu: vale os preços"],
    });
    expect(
      summaryOf({
        ...args,
        source: "dc_jev",
        finalPts: base,
        outcome: "home",
        factorPts: [],
      }).short
    ).toEqual(["Nenhum ajuste mexeu: vale o modelo"]);
  });

  it("todo fator abaixo de 1 pt (R12)", () => {
    const s = summaryOf({
      ...args,
      finalPts: base,
      outcome: "home",
      factorPts: [{ home: 0, draw: 0, away: 0 }],
    });
    expect(s.short).toEqual([
      "Os ajustes mexeram menos de 1 pt: vale os preços",
    ]);
  });
});

describe("toWeighedView", () => {
  it("vira: linhas, raias, etiqueta do usuário, barra e resumo", () => {
    const v = toWeighedView(viraPick, TEAMS, { newsCount: 3 })!;
    expect(v.winner).toBe("away");
    expect(v.start).toEqual({
      prefix: "Ponto de partida, os preços do jogo:",
      text: "Atlético-MG um pouco à frente",
    });
    expect(
      v.rows.map((r) => [
        r.short,
        r.tag,
        r.lanes.map((l) => `${l.from}>${l.to}:${l.pts}@${l.slot}`),
      ])
    ).toEqual([
      [
        "Atlético-MG sem peça no ataque",
        null,
        ["home>draw:1@0", "home>away:1@1"],
      ],
      ["Defesa do Atlético-MG desfalcada", null, ["home>away:1@2"]],
      ["Atlético-MG vai poupar titulares", "user", ["draw>away:1@3"]],
    ]);
    expect(v.rows[0].lanes[1].sr).toBe(
      "1 ponto do Atlético-MG para o Boca Juniors"
    );
    expect(v.rows[2].originLine).toBe("você contou (não conferido)");
    expect(v.hasDrawLane).toBe(true);
    expect(v.bar.slices).toEqual([
      { key: "home", pts: 34, before: 37, strong: false },
      { key: "draw", pts: 30, before: null, strong: false },
      { key: "away", pts: 36, before: 33, strong: true },
    ]);
    expect(v.summary.short).toEqual(["Virou pro Boca Juniors, por pouco"]);
    expect(v.sr).toBe(
      "Chances do palpite, em pontos de 100: Atlético-MG de 37 para 34, empate 30, Boca Juniors de 33 para 36."
    );
    expect(v.alsoRead?.text).toContain(
      "3 notícias do ge citadas (entram só no texto)"
    );
  });

  it("não vira: fator abaixo de 1 pt fica na lista, sem raia (tinyRow)", () => {
    const v = toWeighedView(naoViraPick, TEAMS)!;
    expect(v.winner).toBe("home");
    const tiny = v.rows.find((r) => r.key === "high_stakes_away")!;
    expect(tiny.tiny).toBe(true);
    expect(tiny.lanes).toEqual([]);
    expect(v.summary.short).toEqual([
      "Continua Atlético-MG:",
      "os ajustes quase se anulam",
    ]);
  });

  it("chave desconhecida: a linha some e os pontos vão pra 'Outro ajuste do modelo'", () => {
    const w = viraPick.weighed!;
    const pick = {
      ...viraPick,
      weighed: {
        ...w,
        factors: w.factors.map((f, i) =>
          i === 1 ? { ...f, key: "lineup_change_home" } : f
        ),
      },
    };
    const v = toWeighedView(pick, TEAMS)!;
    expect(v.rows.map((r) => r.short)).toEqual([
      "Atlético-MG sem peça no ataque",
      "Atlético-MG vai poupar titulares",
      "Outro ajuste do modelo",
    ]);
    expect(v.rows[2].lanes.map((l) => l.pts)).toEqual([1]);
  });

  it("origem desconhecida: sem etiqueta, linha 'ajuste do modelo'", () => {
    const w = viraPick.weighed!;
    const pick = {
      ...viraPick,
      weighed: {
        ...w,
        factors: w.factors.map((f) => ({ ...f, origin: "lineup" })),
      },
    };
    const v = toWeighedView(pick, TEAMS)!;
    expect(
      v.rows.every((r) => r.tag === null && r.originLine === "ajuste do modelo")
    ).toBe(true);
  });

  it("set antigo, weighed null, versão desconhecida, jsonb malformado → null", () => {
    const { weighed: _w, ...old } = viraPick;
    void _w;
    expect(toWeighedView(old, TEAMS)).toBeNull();
    expect(toWeighedView({ ...viraPick, weighed: null }, TEAMS)).toBeNull();
    expect(
      toWeighedView(
        { ...viraPick, weighed: { ...viraPick.weighed!, version: "v2" } },
        TEAMS
      )
    ).toBeNull();
    expect(toWeighedView(null, TEAMS)).toBeNull();
    expect(toWeighedView("x", TEAMS)).toBeNull();
    expect(toWeighedView({ ...viraPick, outcome: "x" }, TEAMS)).toBeNull();
  });

  it("conta que não fecha ou inteiro fora da faixa → null (R11)", () => {
    const w = viraPick.weighed!;
    const bad = (weighed: unknown) =>
      toWeighedView({ ...viraPick, weighed }, TEAMS);
    expect(
      bad({ ...w, basePts: { ...w.basePts, home: w.basePts.home + 1 } })
    ).toBeNull();
    expect(
      bad({
        ...w,
        factors: w.factors.map((f, i) =>
          i === 0 ? { ...f, pts: { ...f.pts, draw: f.pts.draw + 1 } } : f
        ),
      })
    ).toBeNull();
    expect(
      bad({
        ...w,
        factors: w.factors.map((f, i) =>
          i === 0 ? { ...f, pts: { home: -2, draw: 0, away: 2 } } : f
        ),
      })
    ).toBeNull();
    expect(
      bad({ ...w, finalPts: { home: 101, draw: -1, away: 0 } })
    ).toBeNull();
    expect(
      bad({ ...w, factors: w.factors.map((f) => ({ ...f, value: 2 })) })
    ).toBeNull();
    expect(
      bad({
        ...w,
        factors: w.factors.map((f) => ({
          ...f,
          pts: { home: 0.5, draw: 0, away: -0.5 },
        })),
      })
    ).toBeNull();
  });

  it("nenhum texto com linguagem de valor; o leitor de tela sem %", () => {
    for (const pick of [viraPick, naoViraPick]) {
      for (const newsCount of [0, 2]) {
        const v = toWeighedView(pick, TEAMS, { newsCount })!;
        for (const t of allText(v)) {
          expect(containsValueLanguage(t)).toBe(false);
          expect(t).not.toMatch(/%/);
        }
      }
    }
  });
});
