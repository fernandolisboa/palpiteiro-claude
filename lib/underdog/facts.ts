import { formatPct } from "@/lib/format-number";

import { SCENARIO_LEAD_MINUTE, SCENARIO_RED_MINUTE } from "./constants";
import {
  oneInN,
  scenarioLabel,
  signalLabel,
  type UnderdogNames,
} from "./labels";
import type { FormResult, UnderdogFacts } from "./types";

// Bloco de fatos do advogado da zebra e do revisor (#671, ADR 0072 §5.1). Vai SÓ na
// mensagem do usuário (ADR 0071: nada que varie por pedido no system). Cada linha tem
// um id (P#, S#, C#, F#, M#) que a frase da IA cita; `allowed` são os números que o
// texto pode usar (as guardas comparam com tolerância).

export type FactsAllowed = {
  // Percentuais como o bloco os mostra (inteiro, ou 1 casa nos placares, mais o inteiro
  // arredondado desses): a guarda compara sem tolerância.
  percents: number[];
  // Placares em ORDEM mandante-visitante ("0-1" = mandante 0 × 1 visitante), como o
  // bloco escreve. A guarda orienta o placar da frase pelos nomes dos times.
  scorelines: string[];
  minutes: number[];
  // O N de "1 jogo em cada N".
  ratios: number[];
  // Números soltos que o bloco sustenta: contagens dos sinais (confronto, forma,
  // desfalques), gols dos placares, minutos, o N e dígitos dos nomes. Fora disso, a
  // frase é cortada.
  numbers: number[];
  // "N dos últimos M": o par, de quem ("underdog", "favorite" ou "any") e o resultado
  // contado (vitória, empate, derrota).
  pairs: {
    who: "underdog" | "favorite" | "any";
    result: FormResult;
    n: number;
    of: number;
  }[];
  // Nomes de exibição (orientam placares e pares).
  teams: { home: string; away: string; underdog: string; favorite: string };
};

export type FactsBlock = {
  text: string;
  ids: Set<string>;
  allowed: FactsAllowed;
};

export type FactsContext = {
  // Nomes de EXIBIÇÃO dos dois lados do jogo.
  teams: { home: string; away: string };
  competition: string;
  kickoffLabel: string;
};

/** Placar na ordem mandante-visitante. */
export const scorelineKey = (home: number, away: number) => `${home}-${away}`;

const int = (n: number) => `${Math.round(n)}%`;
const dec = (n: number) => formatPct(n, { decimals: 1 });

export function underdogNames(
  facts: Pick<UnderdogFacts, "side">,
  teams: { home: string; away: string }
): UnderdogNames {
  return facts.side === "home"
    ? { underdog: teams.home, favorite: teams.away }
    : { underdog: teams.away, favorite: teams.home };
}

/**
 * O complemento "empate ou favorito" como a tela o mostra: a soma dos dois inteiros
 * exibidos (25% + 54% = 79%), nunca o arredondamento da soma crua.
 */
export function complementPct(facts: Pick<UnderdogFacts, "chances">): number {
  return Math.round(facts.chances.draw) + Math.round(facts.chances.favorite);
}

const countOf = <T>(xs: T[], x: T) => xs.filter((y) => y === x).length;
const round1 = (n: number) => Math.round(n * 10) / 10;

export function buildFactsBlock(
  facts: UnderdogFacts,
  ctx: FactsContext
): FactsBlock {
  const n = underdogNames(facts, ctx.teams);
  const { chances } = facts;
  const ids = new Set<string>();
  const lines: string[] = [];
  const add = (id: string, line: string) => {
    ids.add(id);
    lines.push(`[${id}] ${line}`);
  };
  const percents: number[] = [];
  // Inteiro na tela → só o inteiro; 1 casa → a casa e o inteiro arredondado.
  const pushInt = (...xs: number[]) => {
    for (const x of xs) if (Number.isFinite(x)) percents.push(Math.round(x));
  };
  const pushDec = (x: number) => {
    if (Number.isFinite(x)) percents.push(round1(x), Math.round(x));
  };
  const numbers = new Set<number>();
  const pairs: FactsAllowed["pairs"] = [];
  const ratio = oneInN(chances.underdog);
  const complement = complementPct(facts);

  add(
    "P1",
    `${n.underdog} vence em ${int(chances.underdog)} das simulações do modelo${ratio === null ? "" : ` (mais ou menos 1 jogo em cada ${ratio})`}.`
  );
  add("P2", `Empate em ${int(chances.draw)} das simulações.`);
  add(
    "P3",
    `${n.favorite} vence em ${int(chances.favorite)} das simulações. Somados, empate ou ${n.favorite}: ${complement}%.`
  );
  pushInt(chances.underdog, chances.draw, chances.favorite, complement);
  if (ratio !== null) numbers.add(1).add(ratio);

  const scorelines: string[] = [];
  facts.scorelines.forEach((s, i) => {
    add(
      `S${i + 1}`,
      `${i === 0 ? "Placar de zebra mais provável" : "Outro placar de zebra"}: ${ctx.teams.home} ${s.home} x ${s.away} ${ctx.teams.away} (${dec(s.pct)}).`
    );
    scorelines.push(scorelineKey(s.home, s.away));
    numbers.add(s.home).add(s.away);
    pushDec(s.pct);
  });

  const minutes: number[] = [];
  facts.scenarios.forEach((c, i) => {
    add(
      `C${i + 1}`,
      `${scenarioLabel(c.id, n, "x")}: a chance de ${n.underdog} vencer passa de ${int(c.beforePct)} para ${int(c.afterPct)}.`
    );
    pushInt(c.beforePct, c.afterPct);
    if (c.id === "lead_30") {
      minutes.push(SCENARIO_LEAD_MINUTE);
      // O azarão vencendo por 1 × 0, na ordem mandante-visitante.
      scorelines.push(
        facts.side === "home" ? scorelineKey(1, 0) : scorelineKey(0, 1)
      );
      numbers.add(1).add(0).add(SCENARIO_LEAD_MINUTE);
    }
    if (c.id === "red_60") {
      minutes.push(SCENARIO_RED_MINUTE);
      numbers.add(SCENARIO_RED_MINUTE);
    }
  });

  facts.signals.forEach((s, i) => {
    allowSignal(s, numbers, pairs);
    const base = signalLabel(s, n);
    const extra =
      s.kind === "h2h"
        ? `; ${n.favorite} venceu ${s.favoriteWins}`
        : s.kind === "form"
          ? " (V vitória, E empate, D derrota, do mais recente ao mais antigo)"
          : s.kind === "jev"
            ? " (esse fator já está na chance do modelo acima)"
            : "";
    add(`F${i + 1}`, `${base}${extra}.`);
  });

  const source =
    facts.model.source === "dixon_coles"
      ? "Dixon-Coles (gols esperados de cada time, ajustado todo dia com os jogos da liga)"
      : "modelo simplificado, a partir da tabela";
  add(
    "M1",
    `Modelo: ${source}; ${facts.model.jevApplied ? "ajustado pelo JEV (desfalques, rodízio e peso do jogo)" : "sem ajuste do JEV"}.`
  );

  const header = `Jogo: ${ctx.teams.home} (mandante) x ${ctx.teams.away} (visitante), ${ctx.competition}, ${ctx.kickoffLabel}.
Azarão (o lado menos provável pelo modelo): ${n.underdog}. Favorito: ${n.favorite}.`;
  // Dígitos dos nomes (time ou liga com número no nome não reprova a frase).
  for (const name of [ctx.teams.home, ctx.teams.away, ctx.competition]) {
    for (const d of name.match(/\d+/g) ?? []) numbers.add(Number(d));
  }
  return {
    text: `${header}\n\n<<<FATOS>>>\n${lines.join("\n")}\n<<<FIM_FATOS>>>`,
    ids,
    allowed: {
      percents,
      scorelines,
      minutes,
      ratios: ratio === null ? [] : [ratio],
      numbers: [...numbers],
      pairs,
      teams: { ...ctx.teams, ...n },
    },
  };
}

/** As contagens de um sinal: números soltos e os pares "N dos últimos M". */
function allowSignal(
  s: UnderdogFacts["signals"][number],
  numbers: Set<number>,
  pairs: FactsAllowed["pairs"]
): void {
  switch (s.kind) {
    case "h2h": {
      const draws = Math.max(0, s.games - s.underdogWins - s.favoriteWins);
      for (const x of [s.games, s.underdogWins, s.favoriteWins, draws]) {
        numbers.add(x);
      }
      const of = s.games;
      pairs.push(
        { who: "underdog", result: "W", n: s.underdogWins, of },
        { who: "underdog", result: "L", n: s.favoriteWins, of },
        { who: "favorite", result: "W", n: s.favoriteWins, of },
        { who: "favorite", result: "L", n: s.underdogWins, of },
        { who: "any", result: "D", n: draws, of }
      );
      return;
    }
    case "form": {
      for (const who of ["underdog", "favorite"] as const) {
        const results = s[who];
        numbers.add(results.length);
        for (const r of ["W", "D", "L"] as const) {
          const c = countOf(results, r);
          numbers.add(c);
          pairs.push({ who, result: r, n: c, of: results.length });
        }
      }
      return;
    }
    case "absences":
      numbers.add(s.favorite).add(s.underdog);
      return;
    case "jev":
      return;
  }
}
