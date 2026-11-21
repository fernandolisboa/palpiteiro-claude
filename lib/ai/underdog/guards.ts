import {
  BET_LANGUAGE_RE,
  BOOKMAKER_NAME_RE,
  HOUSE_RE,
  IMPERATIVE_RE,
  PROMISE_RE,
  URL_RE,
} from "@/lib/ai/language-guards";
import { PERCENT_RE } from "@/lib/ai/markets/_narrator/fidelity";
import { containsValueLanguage } from "@/lib/ai/palpites/value-language-guard";
import {
  scorelineKey,
  type FactsAllowed,
  type FactsBlock,
} from "@/lib/underdog/facts";

// Guardas do painel do azarão (#671, ADR 0073 §5.4). Puras, nunca lançam. Rodam POR
// FRASE do advogado (reprovou → a frase é cortada, o resto segue) e no contraponto do
// revisor (reprovou → contraponto padrão). Números só do bloco de fatos; linguagem: as
// guardas compartilhadas (lib/ai/language-guards.ts), linguagem de valor (ADR 0030 §3),
// promessa e "bet" (o mesmo regex do voice-firewall, ADR 0070).

export type GuardCheck = { ok: true } | { ok: false; reason: string };

const OK: GuardCheck = { ok: true };
const fail = (reason: string): GuardCheck => ({ ok: false, reason });

// ─── Números ───────────────────────────────────────────────────────────────────────

// Placar: "N x N", "N × N", "N-N" e "N a N" (este só passa se o par for um placar do
// bloco: "de 2 a 3 jogos" é cortado, e tudo bem). Nunca colado em % ou outro número.
const SCORE_RE =
  /(?<!\d)(?<!\d[.,])(\d{1,2})(?:\s*[x×–-]\s*|\s+a\s+)(\d{1,2})(?!\d|[.,]\d|\s*%|['’])/giu;
// Minuto: "30'", "30’", "30 min", "30 minutos", "minuto 30" e "aos 30" sem unidade.
const MINUTE_RE = /(?<![\d.,])(\d{1,3})\s*(?:'|’|min(?:utos?)?(?![\p{L}]))/giu;
const MINUTE_WORD_RE = /(?<![\p{L}\d])minutos?\s+(\d{1,3})(?!\d|[.,]\d)/giu;
const AOS_RE =
  /(?<![\p{L}\d])aos\s+(\d{1,3})(?!\d|[.,]\d|['’]|\s*(?:%|[x×]\s*\d|p\.|pp|pontos|min|jogos?|gols?|vit|confronto|anos?))/giu;
// "1 jogo em cada N".
const RATIO_RE = /(?<![\d.,])1\s+(?:jogo\s+)?em\s+cada\s+(\d+)/giu;
// "N dos últimos M" (também por extenso: "quatro dos últimos cinco").
const NUM_WORD: Record<string, number> = {
  zero: 0,
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  três: 3,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
};
const NUM_TOKEN = `\\d{1,2}|${Object.keys(NUM_WORD).join("|")}`;
const PAIR_RE = new RegExp(
  `(?<![\\p{L}\\d.,])(${NUM_TOKEN})\\s+(?:d[oa]s|de)\\s+(?:(?:os|as|seus|suas)\\s+)?(?:[úu]ltim[oa]s\\s+)?(${NUM_TOKEN})(?![\\p{L}\\d%'’]|[.,]\\d)`,
  "giu"
);
// Qualquer outro número solto (inteiro ou decimal).
const BARE_NUMBER_RE = /(?<![\p{L}\d.,])(\d+(?:[.,]\d+)?)(?![\d])/gu;

const parse = (s: string) => Number(s.replace(",", "."));
const parseToken = (s: string) =>
  NUM_WORD[s.toLocaleLowerCase("pt-BR")] ?? Number(s);
const EPS = 1e-6;

type Side = "home" | "away";

const lower = (s: string) => s.toLocaleLowerCase("pt-BR");

/** O time citado por último em `before` (frase inteira): lado e o texto depois dele. */
function lastTeam(
  before: string,
  teams: FactsAllowed["teams"]
): { side: Side; between: string } | null {
  const sentence = before.slice(
    Math.max(
      ...[".", "!", "?", ";", ":", "\n"].map((c) => before.lastIndexOf(c))
    ) + 1
  );
  const hay = lower(sentence);
  let best: { side: Side; at: number; len: number } | null = null;
  for (const side of ["home", "away"] as const) {
    const name = lower(teams[side]);
    const at = name ? hay.lastIndexOf(name) : -1;
    if (at >= 0 && (!best || at > best.at))
      best = { side, at, len: name.length };
  }
  return best
    ? { side: best.side, between: sentence.slice(best.at + best.len) }
    : null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// "Flamengo vence por 2 x 1", "Flamengo estiver vencendo por 1 x 0", "vitória do
// Flamengo por 1 x 0": o placar é do ponto de vista do time citado (vencedor).
const WINNER_BETWEEN_RE =
  /^\s*(?:\p{L}+\s+){0,2}?(?:(?:venc|ganh)\p{L}*(?:\s+(?:por|de))?|por)\s*$/iu;
const LOSER_BETWEEN_RE =
  /^\s*(?:\p{L}+\s+){0,2}?perd\p{L}*\s*(?:por|de)?\s*$/iu;

/**
 * O placar da frase na ordem mandante-visitante. "Palmeiras 0 x 1 Flamengo" (o número
 * colado ao nome é dele), "Flamengo vence por 1 x 0" e "1 x 0 pro Flamengo" (o maior é
 * do time citado). Sem time por perto: lido como mandante × visitante, igual ao bloco.
 */
function orientScore(
  text: string,
  index: number,
  length: number,
  a: number,
  b: number,
  teams: FactsAllowed["teams"]
): { home: number; away: number } {
  const team = lastTeam(text.slice(0, index), teams);
  if (team) {
    if (/^\s*$/.test(team.between)) {
      return team.side === "home" ? { home: a, away: b } : { home: b, away: a };
    }
    const hi = Math.max(a, b);
    const lo = Math.min(a, b);
    if (LOSER_BETWEEN_RE.test(team.between)) {
      return team.side === "home"
        ? { home: lo, away: hi }
        : { home: hi, away: lo };
    }
    if (WINNER_BETWEEN_RE.test(team.between)) {
      return team.side === "home"
        ? { home: hi, away: lo }
        : { home: lo, away: hi };
    }
  }
  const after = lower(text.slice(index + length));
  for (const side of ["home", "away"] as const) {
    const name = lower(teams[side]);
    const re = new RegExp(
      `^\\s*(?:pr[oa]|para(?:\\s+[oa])?|d[oa]|a\\s+favor\\s+d[oa])\\s+(?:[oa]\\s+)?${escapeRe(name)}(?![\\p{L}\\d])`,
      "u"
    );
    if (name && re.test(after)) {
      const hi = Math.max(a, b);
      const lo = Math.min(a, b);
      return side === "home" ? { home: hi, away: lo } : { home: lo, away: hi };
    }
  }
  return { home: a, away: b };
}

const RESULT_WORDS: [RegExp, "W" | "D" | "L"][] = [
  [/(?<![\p{L}\d])(?:perd\p{L}*|derrot\p{L}*)/iu, "L"],
  [/(?<![\p{L}\d])empat\p{L}*/iu, "D"],
  [/(?<![\p{L}\d])(?:venc\p{L}*|vit[óo]ri\p{L}*|ganh\p{L}*)/iu, "W"],
];

/**
 * De quem é o "N dos últimos M" (o time citado antes na frase) e qual resultado
 * (vitória, empate ou derrota, pelo verbo entre o time e o número). null = qualquer.
 */
function pairContext(
  text: string,
  index: number,
  teams: FactsAllowed["teams"]
): { owner: "underdog" | "favorite" | null; result: "W" | "D" | "L" | null } {
  const team = lastTeam(text.slice(0, index), teams);
  const owner = team
    ? lower(teams[team.side]) === lower(teams.underdog)
      ? "underdog"
      : "favorite"
    : null;
  const between = team ? team.between : text.slice(0, index);
  const result = RESULT_WORDS.find(([re]) => re.test(between))?.[1] ?? null;
  return { owner, result };
}

/**
 * Todo número da frase tem de vir do bloco: percentuais exatos como o bloco os mostra,
 * placares orientados (mandante-visitante), minutos, o N de "1 em cada N", os pares
 * "N dos últimos M" do time certo e, no resto, só números soltos que o bloco sustenta.
 */
export function checkUnderdogNumbers(
  text: string,
  allowed: FactsAllowed
): GuardCheck {
  let masked = text;
  const mask = (m: RegExpMatchArray) => {
    const i = m.index ?? 0;
    masked =
      masked.slice(0, i) +
      " ".repeat(m[0].length) +
      masked.slice(i + m[0].length);
  };

  for (const m of [...masked.matchAll(PERCENT_RE)]) {
    const n = parse(m[1]);
    if (!allowed.percents.some((a) => Math.abs(a - n) < EPS)) {
      return fail(`percentual ${m[0].trim()} fora do bloco`);
    }
    mask(m);
  }
  for (const m of [...masked.matchAll(RATIO_RE)]) {
    if (!allowed.ratios.includes(Number(m[1]))) {
      return fail(`"${m[0].trim()}" fora do bloco`);
    }
    mask(m);
  }
  for (const m of [...masked.matchAll(SCORE_RE)]) {
    const s = orientScore(
      text,
      m.index ?? 0,
      m[0].length,
      Number(m[1]),
      Number(m[2]),
      allowed.teams
    );
    if (!allowed.scorelines.includes(scorelineKey(s.home, s.away))) {
      return fail(`placar ${m[0].trim()} fora do bloco`);
    }
    mask(m);
  }
  for (const re of [MINUTE_RE, MINUTE_WORD_RE, AOS_RE]) {
    for (const m of [...masked.matchAll(re)]) {
      if (!allowed.minutes.includes(Number(m[1]))) {
        return fail(`minuto ${m[0].trim()} fora do bloco`);
      }
      mask(m);
    }
  }
  for (const m of [...masked.matchAll(PAIR_RE)]) {
    const n = parseToken(m[1]);
    const of = parseToken(m[2]);
    const { owner, result } = pairContext(text, m.index ?? 0, allowed.teams);
    const ok = allowed.pairs.some(
      (p) =>
        p.n === n &&
        p.of === of &&
        (owner === null || p.who === "any" || p.who === owner) &&
        (result === null || p.result === result)
    );
    if (!ok) return fail(`"${m[0].trim()}" fora do bloco`);
    mask(m);
  }
  for (const m of masked.matchAll(BARE_NUMBER_RE)) {
    const n = parse(m[1]);
    if (!allowed.numbers.some((a) => Math.abs(a - n) < EPS)) {
      return fail(`número ${m[0].trim()} fora do bloco`);
    }
  }
  return OK;
}

// ─── Linguagem ─────────────────────────────────────────────────────────────────────

// O mesmo regex de "bet" do __tests__/voice-firewall.test.ts (ADR 0070).
const BET_WORD_RE = /(?<![\p{L}\p{N}./-])bets?(?![\p{L}\p{N}/-])/iu;
const BARBADA_RE = /barbada/iu;

// Certeza dita sem rodeio: corta mesmo com "não"/"sem" em volta.
const HARD_PROMISE_RE =
  /(?<![\p{L}\d])(?:sem\s+(?:sombra\s+de\s+)?d[úu]vidas?|n[ãa]o\s+(?:h[áa]|tem|resta)\s+d[úu]vidas?|quase\s+cert[oa]s?|pode\s+escrever|escreve\s+a[íi]|anota\s+a[íi]|favas\s+contadas)(?![\p{L}\d])/iu;
// Termos de certeza: valem como promessa fora de uma negação COLADA ("não é garantido",
// "nada garantido", "não há certeza", "não dá pra cravar").
const CERTAINTY_TERMS: RegExp[] = [
  /(?<![\p{L}\d])garantid\p{L}*/giu,
  /(?<![\p{L}\d])certez\p{L}*/giu,
  /(?<![\p{L}\d])(?:[ée]|est[áa]|parece|fica|d[áa]\s+como|tido\s+como)\s+cert[oa]s?(?![\p{L}\d])/giu,
  /(?<![\p{L}\d])crav\p{L}*/giu,
];
// "vai vencer/ganhar" como fato. "pode vencer", "se ... vencer" e "talvez" passam.
const WILL_WIN_RE =
  /(?<![\p{L}\d])(?:vai|v[ãa]o|ir[áa]|ir[ãa]o)\s+(?:ganhar|vencer)(?![\p{L}\d])/giu;
// "se" condicional: no começo da oração ou depois de "sabe/dizer/ver" (o "se"
// reflexivo de "o Bahia se fecha" não conta).
const HEDGE_RE =
  /^\s*(?:e\s+|mas\s+|s[óo]\s+)?se\s|(?<![\p{L}\d])(?:(?:sabe|saber|dizer|ver)\s+se|caso|talvez|quem\s+sabe|ser[áa]\s+que|pode|poderia)(?![\p{L}\d])/iu;

const NEG = "n[ãa]o|nada|nenhum\\p{L}*|ningu[ée]m|nunca|jamais|sem";
// Palavras de ligação que podem ficar entre a negação e o termo.
const FILLER =
  "[ée]|est[áa]|est[ãa]o|era|foi|ser[áa]|seria|s[ãa]o|h[áa]|tem|t[êe]m|existe|existem|ser|estar|d[áa]|pra|para|de|dar|o|a|os|as|um|uma|t[ãa]o|tanto|muito|bem|assim|isso|vit[óo]ria|vantagem|resultado|zebra|coisa|nada|ningu[ée]m|consegue|d[áa]\\s+pra";
const NEGATED_BEFORE_RE = new RegExp(
  `(?:^|[^\\p{L}\\d])(?:${NEG})\\s+(?:(?:${FILLER})\\s+){0,3}$`,
  "iu"
);
const CLAUSE_BREAKS = [".", "!", "?", ";", ",", ":", "—", "–", "\n"];

function clauseBefore(text: string, index: number): string {
  const before = text.slice(0, index);
  return before.slice(
    Math.max(...CLAUSE_BREAKS.map((c) => before.lastIndexOf(c))) + 1
  );
}

/** O termo aparece fora de uma negação colada nele ("é certeza" sim; "não há certeza" não). */
function affirmed(text: string, re: RegExp): boolean {
  for (const m of text.matchAll(re)) {
    if (!NEGATED_BEFORE_RE.test(clauseBefore(text, m.index ?? 0))) return true;
  }
  return false;
}

/** "vai vencer" afirmado: sem negação colada e sem condição/dúvida antes na oração. */
function willWinStated(text: string): boolean {
  for (const m of text.matchAll(WILL_WIN_RE)) {
    const clause = clauseBefore(text, m.index ?? 0);
    if (NEGATED_BEFORE_RE.test(clause) || HEDGE_RE.test(clause)) continue;
    return true;
  }
  return false;
}

// "Tem valor no Bahia", "o azarão tem valor": linguagem de valor no painel do azarão
// (a lista global deixa "tem valor" passar de propósito em outras telas).
const UNDERDOG_VALUE_RE =
  /(?<![\p{L}\d])(?:tem|t[êe]m|h[áa]|com)\s+(?:muito\s+|bom\s+|algum\s+|um\s+)?valor(?![\p{L}\d])|(?<![\p{L}\d])valor\s+(?:no|na|em|pr[oa])(?![\p{L}\d])/iu;

/** Promessa ou certeza (exportada pros testes). */
export function promisesOutcome(text: string): boolean {
  if (PROMISE_RE.test(text) || BARBADA_RE.test(text)) return true;
  if (HARD_PROMISE_RE.test(text)) return true;
  if (CERTAINTY_TERMS.some((re) => affirmed(text, re))) return true;
  return willWinStated(text);
}

export function checkUnderdogLanguage(text: string): GuardCheck {
  if (containsValueLanguage(text) || UNDERDOG_VALUE_RE.test(text)) {
    return fail("linguagem de valor");
  }
  if (BET_LANGUAGE_RE.test(text)) return fail("aposta");
  if (IMPERATIVE_RE.test(text)) return fail("imperativo");
  if (promisesOutcome(text)) return fail("promessa");
  if (BOOKMAKER_NAME_RE.test(text) || HOUSE_RE.test(text)) {
    return fail("casa de apostas");
  }
  if (URL_RE.test(text)) return fail("link");
  if (BET_WORD_RE.test(text)) return fail("bet");
  return OK;
}

/** Uma frase do advogado: ids que existem no bloco, números do bloco e linguagem. */
export function checkAdvocateSentence(
  sentence: { texto: string; fatos: string[] },
  block: FactsBlock
): GuardCheck {
  const missing = sentence.fatos.find((id) => !block.ids.has(id));
  if (missing) return fail(`fato ${missing} não existe no bloco`);
  const numbers = checkUnderdogNumbers(sentence.texto, block.allowed);
  if (!numbers.ok) return numbers;
  return checkUnderdogLanguage(sentence.texto);
}

const words = (s: string) =>
  s
    .toLocaleLowerCase("pt-BR")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

function ngrams(s: string, n: number): Set<string> {
  const w = words(s);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

export const COUNTERPOINT_ECHO_WORDS = 6;

/**
 * O contraponto: números do bloco, linguagem e nenhuma sequência de 6+ palavras de uma
 * frase cortada (o revisor não pode reabilitar o que foi cortado).
 */
export function checkCounterpoint(
  text: string,
  block: FactsBlock,
  cutTexts: string[]
): GuardCheck {
  const numbers = checkUnderdogNumbers(text, block.allowed);
  if (!numbers.ok) return numbers;
  const language = checkUnderdogLanguage(text);
  if (!language.ok) return language;
  const mine = ngrams(text, COUNTERPOINT_ECHO_WORDS);
  for (const cut of cutTexts) {
    for (const g of ngrams(cut, COUNTERPOINT_ECHO_WORDS)) {
      if (mine.has(g)) return fail("contraponto repete frase cortada");
    }
  }
  return OK;
}
