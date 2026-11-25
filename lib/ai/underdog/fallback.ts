import { complementPct, underdogNames } from "@/lib/underdog/facts";
import { newsSignalLabel, oneInN, signalLabel } from "@/lib/underdog/labels";
import type {
  UnderdogFacts,
  UnderdogNarrative,
  UnderdogScenario,
} from "@/lib/underdog/types";

// Texto PADRÃO do painel do azarão (#671, ADR 0073 §5.5): quando o rascunho da IA não
// passa na conferência ou o revisor falha. Só frases do código com os números do bloco;
// passa nas próprias guardas (teste). Tom de mesa de amigos, sem promessa.

type Teams = { home: string; away: string };

const int = (n: number) => `${Math.round(n)}%`;

function biggestScenario(facts: UnderdogFacts): {
  scenario: UnderdogScenario;
  index: number;
} | null {
  let best: { scenario: UnderdogScenario; index: number } | null = null;
  facts.scenarios.forEach((scenario, index) => {
    const delta = scenario.afterPct - scenario.beforePct;
    if (!best || delta > best.scenario.afterPct - best.scenario.beforePct) {
      best = { scenario, index };
    }
  });
  return best;
}

export function templateSentences(
  facts: UnderdogFacts,
  teams: Teams
): { text: string; facts: string[] }[] {
  const n = underdogNames(facts, teams);
  const out: { text: string; facts: string[] }[] = [];
  const ratio = oneInN(facts.chances.underdog);
  out.push({
    text: `${n.underdog} vence em ${int(facts.chances.underdog)} das simulações do modelo${ratio === null ? "" : `, mais ou menos 1 jogo em cada ${ratio} assim`}.`,
    facts: ["P1"],
  });
  const best = biggestScenario(facts);
  if (best) {
    const after = int(best.scenario.afterPct);
    const text =
      best.scenario.id === "lead_30"
        ? `Com ${n.underdog} vencendo por 1 × 0 aos 30', a chance vai a ${after}.`
        : best.scenario.id === "red_60"
          ? `Se ${n.favorite} ficar com um a menos desde os 60', a chance vai a ${after}.`
          : `Com ${n.favorite} desfalcado e com rodízio no máximo do modelo, a chance vai a ${after}.`;
    out.push({ text, facts: [`C${best.index + 1}`] });
  }
  const first = facts.signals[0];
  if (first) {
    out.push({
      text:
        first.kind === "news"
          ? `${newsSignalLabel(first, n, ["já está na chance"])}.`
          : `${signalLabel(first, n)}${first.kind === "jev" ? " (já está na chance)" : ""}.`,
      facts: ["F1"],
    });
  }
  const top = facts.scorelines[0];
  if (top) {
    out.push({
      text: `O placar de zebra mais provável é ${teams.home} ${top.home} × ${top.away} ${teams.away}.`,
      facts: ["S1"],
    });
  }
  return out;
}

export function templateCounterpoint(
  facts: UnderdogFacts,
  teams: Teams
): string {
  const n = underdogNames(facts, teams);
  return `Nos outros ${complementPct(facts)}% o jogo termina empatado (${int(facts.chances.draw)}) ou com vitória de ${n.favorite} (${int(facts.chances.favorite)}).`;
}

/** O texto padrão inteiro. `total` = frases do rascunho que não passou (0 sem rascunho). */
export function templatedNarrative(
  facts: UnderdogFacts,
  teams: Teams,
  total = 0
): UnderdogNarrative {
  return {
    sentences: templateSentences(facts, teams).map((s) => ({
      ...s,
      verdict: null,
    })),
    counterpoint: templateCounterpoint(facts, teams),
    counterpointSource: "template",
    cut: total,
    total,
    verdicts: null,
    advocateFamily: null,
  };
}
