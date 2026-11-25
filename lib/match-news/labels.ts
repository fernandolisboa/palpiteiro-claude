import type { JudgmentFactor, JudgmentQuestionId, TeamSide } from "@/lib/ai/judgments/types";
import { BOOKMAKER_NAME_RE } from "@/lib/ai/language-guards";
import { containsNewsValueLanguage } from "@/lib/ai/palpites/value-language-guard";

// Frases das notícias do jogo montadas SÓ pelo código (#672, PLAN-672 §8): o fator que a
// notícia moveu, em PT-BR, sem número, sem nome de jogador e sem a frase da matéria.
// PURO e seguro no cliente: o passo "Ver raciocínio" e o painel do azarão usam os MESMOS
// textos. Sem artigo antes do nome do time ("do Flamengo" é o padrão do app).

type Teams = { home: string; away: string };

const FACTOR_PHRASE: Record<JudgmentFactor, (team: string) => string> = {
  attack_weakened: (team) => `Desfalque no ataque do ${team}`,
  defense_weakened: (team) => `Desfalque na defesa do ${team}`,
  rotation_risk: (team) => `Time poupado ou rodízio no ${team}`,
  high_stakes: (team) => `Jogo de peso para o ${team}`,
};

export function splitQuestionId(id: JudgmentQuestionId): {
  factor: JudgmentFactor;
  side: TeamSide;
} {
  const side: TeamSide = id.endsWith("_home") ? "home" : "away";
  return { factor: id.slice(0, -`_${side}`.length) as JudgmentFactor, side };
}

/** "Desfalque na defesa do Flamengo": o fator, com o time dado. */
export function newsFactorPhraseFor(factor: JudgmentFactor, team: string): string {
  return FACTOR_PHRASE[factor](team);
}

/** "Desfalque na defesa do Flamengo": o fator movido, com o time do lado da pergunta. */
export function newsFactorPhrase(id: JudgmentQuestionId, teams: Teams): string {
  const { factor, side } = splitQuestionId(id);
  return FACTOR_PHRASE[factor](teams[side]);
}

/**
 * Título de matéria que não pode ir a prompt nem à tela (#672, ajuste 12): nome de casa
 * de aposta (inclusive "Brasileirão Betano") ou linguagem de valor. Quem mostra o título
 * cai na frase do código.
 */
export function isUnsafeNewsTitle(title: string): boolean {
  return BOOKMAKER_NAME_RE.test(title) || containsNewsValueLanguage(title);
}

// Link de matéria só do ge (subdomínio de globo.com), em https: a mesma regra na
// gravação do sinal e na tela, pra um link de fora nunca virar "a matéria do ge".
export function safeGeArticleUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:") return null;
    return u.hostname.toLowerCase().endsWith(".globo.com") ? u.href : null;
  } catch {
    return null;
  }
}
