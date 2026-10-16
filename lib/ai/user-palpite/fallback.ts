import { truncate } from "@/lib/ai/ai-call-logging";
import { STATUS_LABEL } from "@/lib/user-palpite/labels";
import { ptPct, rankPhrase } from "@/lib/user-palpite/reading";
import type { PalpiteNarration, PalpiteReading } from "@/lib/user-palpite/types";

import type { NarrationInput } from "./narrate-cartridge";

// Narração TEMPLATADA do "Seu palpite" (#564): usada quando o LLM falha, não cabe no
// prazo, reprova nas guardas ou a extração falhou. Só texto do código (status +
// evidência + números da leitura), nunca a paráfrase do usuário.

const MAX_POINTS = 4;

function sameReading(a: PalpiteReading, b: PalpiteReading): boolean {
  return (
    a.palpitePct === b.palpitePct &&
    a.resultPct === b.resultPct &&
    a.oneXTwo.home === b.oneXTwo.home &&
    a.oneXTwo.away === b.oneXTwo.away
  );
}

function headline(i: NarrationInput, r: PalpiteReading): string {
  if (i.palpite.kind === "result") {
    return `${i.palpiteLabel} tem ${ptPct(r.palpitePct)}`;
  }
  if (r.scoreRank !== null && r.scoreRank <= 3 && i.codeVerdict === "concordo") {
    return `${i.palpiteLabel} está entre os 3 placares mais prováveis, com ${ptPct(r.palpitePct)}`;
  }
  return r.scoreRank === null
    ? `${i.palpiteLabel} tem ${ptPct(r.palpitePct)}`
    : `${i.palpiteLabel} tem ${ptPct(r.palpitePct)} (${rankPhrase(r.scoreRank)})`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function templatedPalpiteNarration(i: NarrationInput): PalpiteNarration {
  const changed = !sameReading(i.without, i.with);
  const context = changed
    ? ` Com o seu contexto: ${ptPct(i.with.palpitePct)}.`
    : i.claims.length > 0
      ? " O seu contexto não mudou a leitura do modelo."
      : "";
  // Ao vivo (#594): o momento e o placar abrem o texto, como na narração por IA.
  const lead = `pelo modelo (${i.modelLabel}), ${headline(i, i.without)}`;
  const opening = i.live
    ? `${capitalize(i.live.moment)}, com ${i.live.score.home} × ${i.live.score.away}, ${lead}`
    : capitalize(lead);
  const resumo = truncate(`${opening}.${context}`, 400);
  const pontos = i.claims
    .slice(0, MAX_POINTS)
    .map((c) =>
      truncate(`Afirmação ${c.index + 1}: ${STATUS_LABEL[c.status]}. ${c.evidence}`, 160),
    );
  const discordancias = i.claims
    .filter((c) => c.status === "contradicted")
    .map((c) => ({ claimIndex: c.index, texto: truncate(c.evidence, 200) }));
  return { veredito: i.codeVerdict, resumo, pontos, discordancias };
}
