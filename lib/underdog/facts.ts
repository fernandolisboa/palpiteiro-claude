import { formatPct } from "@/lib/format-number";

import { SCENARIO_LEAD_MINUTE, SCENARIO_RED_MINUTE } from "./constants";
import {
  oneInN,
  scenarioLabel,
  signalLabel,
  type UnderdogNames,
} from "./labels";
import type { UnderdogFacts } from "./types";

// Bloco de fatos do advogado da zebra e do revisor (#671, ADR 0072 §5.1). Vai SÓ na
// mensagem do usuário (ADR 0071: nada que varie por pedido no system). Cada linha tem
// um id (P#, S#, C#, F#, M#) que a frase da IA cita; `allowed` são os números que o
// texto pode usar (as guardas comparam com tolerância).

export type FactsAllowed = {
  percents: number[];
  // Placares sem ordem ("0-1" serve pra "1 x 0" do azarão e "0 x 1" do mandante).
  scorelines: string[];
  minutes: number[];
  // O N de "1 jogo em cada N".
  ratios: number[];
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

export const scorelineKey = (a: number, b: number) =>
  a <= b ? `${a}-${b}` : `${b}-${a}`;

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

/** O complemento "empate ou favorito", arredondado como na tela. */
export function complementPct(facts: Pick<UnderdogFacts, "chances">): number {
  return Math.round(facts.chances.draw + facts.chances.favorite);
}

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
  const pushPct = (...xs: number[]) => {
    for (const x of xs) {
      if (Number.isFinite(x)) percents.push(x, Math.round(x));
    }
  };
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
  pushPct(chances.underdog, chances.draw, chances.favorite, complement);

  const scorelines: string[] = [];
  facts.scorelines.forEach((s, i) => {
    add(
      `S${i + 1}`,
      `${i === 0 ? "Placar de zebra mais provável" : "Outro placar de zebra"}: ${ctx.teams.home} ${s.home} x ${s.away} ${ctx.teams.away} (${dec(s.pct)}).`
    );
    scorelines.push(scorelineKey(s.home, s.away));
    pushPct(s.pct);
  });

  const minutes: number[] = [];
  facts.scenarios.forEach((c, i) => {
    add(
      `C${i + 1}`,
      `${scenarioLabel(c.id, n, "x")}: a chance de ${n.underdog} vencer passa de ${int(c.beforePct)} para ${int(c.afterPct)}.`
    );
    pushPct(c.beforePct, c.afterPct);
    if (c.id === "lead_30") {
      minutes.push(SCENARIO_LEAD_MINUTE);
      scorelines.push(scorelineKey(1, 0));
    }
    if (c.id === "red_60") minutes.push(SCENARIO_RED_MINUTE);
  });

  facts.signals.forEach((s, i) => {
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
  return {
    text: `${header}\n\n<<<FATOS>>>\n${lines.join("\n")}\n<<<FIM_FATOS>>>`,
    ids,
    allowed: {
      percents,
      scorelines,
      minutes,
      ratios: ratio === null ? [] : [ratio],
    },
  };
}
