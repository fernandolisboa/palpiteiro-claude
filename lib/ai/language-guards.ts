// Guardas de LINGUAGEM compartilhadas pelas portas de IA fora do predict (ADR 0063 e
// 0073): mandar apostar, prometer resultado, citar casa de apostas ou link, falar de
// aposta. Só regex e funções puras; quem usa decide o que fazer com o acerto. Movidas
// de lib/ai/bet-slip-explain/fidelity.ts e lib/ai/user-palpite/fidelity.ts (os dois
// módulos reexportam/importam daqui); BOOKMAKER_NAME_RE foi ampliado depois.

// Mandar apostar ou mexer na aposta. Lookarounds de letra: o \b do JS não enxerga
// letra acentuada.
// "Recomendação" e "recomendado pelas bandas" descrevem; só a forma ativa sem "não"
// antes é ordem.
export const IMPERATIVE_RE =
  /(?<![\p{L}\d])(?:aposte|apostem|apostaria|v[áa]\s+de|vai\s+de|vamos\s+de|entre\s+n[oa]s?|entre\s+nessa|coloque|aumente|diminua|reduza|dobre|troque|aproveite|jogue|pegue|sugiro|deveria\s+apostar|vale\s+apostar)(?![\p{L}\d])|(?<!n[ãa]o\s)(?<![\p{L}\d])(?:recomendo|recomendamos|recomenda-se|recomendaria|recomende|recomendem)(?![\p{L}\d])/iu;
// Promessa. "garantid*" só conta fora de negação: "isso não é uma vantagem garantida"
// é o aviso do backtest (a negação vale pra oração inteira).
export const PROMISE_RE =
  /(?<![\p{L}\d])(?:lucro\s+certo|dinheiro\s+f[áa]cil|imperd[íi]vel|aposta\s+certa|com\s+certeza|sem\s+risco)(?![\p{L}\d])/iu;
const GUARANTEE_RE = /(?<![\p{L}\d])garantid\p{L}*/giu;
const NEGATION_RE =
  /(?<![\p{L}\d])(?:n[ãa]o|nada|nenhum\p{L}*|nunca|sem)(?![\p{L}\d])/iu;

/** "garantid*" fora de uma oração negada. */
export function promisesGuarantee(text: string): boolean {
  for (const m of text.matchAll(GUARANTEE_RE)) {
    const before = text.slice(0, m.index);
    const clause = before.slice(
      Math.max(
        ...[".", "!", "?", ";", "\n"].map((c) => before.lastIndexOf(c))
      ) + 1
    );
    if (!NEGATION_RE.test(clause)) return true;
  }
  return false;
}

// Casas de apostas: as licenciadas mais citadas no Brasil e a forma genérica de marca
// "<algo>bet" (Pixbet, 1xbet, Estrelabet). "bet" sozinho não entra aqui (cada porta
// decide; o painel do azarão barra pelo regex do voice-firewall). Lookarounds de letra
// e dígito: o \b do JS não enxerga letra acentuada.
export const BOOKMAKER_NAME_RE =
  /(?<![\p{L}\d])(?:betano|bet365|bet\s?nacional|betfair|betsson|betway|betmgm|betboo|betwarrior|pinnacle|sportingbet|superbet|novibet|kto|pixbet|esportes\s+da\s+sorte|estrela\s*bet|galera\s*\.?\s*bet|rei\s+do\s+pitaco|parimatch|bwin|[\p{L}\d]+bet)(?![\p{L}\d])/iu;
export const HOUSE_RE =
  /casas?\s+de\s+apostas?|(?:odds?|margem)\s+da\s+(?:sua\s+)?casa/iu;
export const URL_RE = /https?:\/\/|www\.|\.com\b|\.bet\b/iu;

// Mandar apostar (ou falar de aposta) não cabe numa leitura de probabilidade. Lookarounds
// de letra: o \b do JS não enxerga letra acentuada.
export const BET_LANGUAGE_RE =
  /(?<![\p{L}\d])(?:apost\p{L}*|v[áa]\s+de|vai\s+de|vamos\s+de|entr[ae]\s+n[oa]s?\s+(?:over|under|mercado))(?![\p{L}\d])/iu;
