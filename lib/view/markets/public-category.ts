// Normalizador DENY-BY-DEFAULT de `citedMarkets` pro boundary público /p/[id] (ADR 0035
// §5 / #384). `citedMarkets` é texto LIVRE do LLM (cartridge.ts PalpitesOutputSchema:
// z.array(z.string().min(1)).max(10), exemplos "Resultado"/"Mais de 2.5"), então uma
// LINHA crua ("Mais de 2.5 gols", "3.5", "12") pode entrar. No /p o palpite vira PNG/HTML
// público permanente — um número de linha vazado é irrecuperável. A regra:
//   - bate EXATAMENTE numa das 7 categorias canônicas (do REGISTRY) → verbatim;
//   - bate numa FAMÍLIA de rótulo de linha/seleção (regex/tabela) → mapeia pra canônica;
//   - QUALQUER OUTRA COISA → DROP (nunca passa-verbatim-on-miss).
// TRIPWIRE DE ALLOWLIST: toda string emitida DEVE ser membro do conjunto canônico (a
// allowlist confiável do REGISTRY) — é a propriedade de segurança real. Uma linha crua
// ("Mais de 3.5", "2.5", "12") NUNCA está na allowlist, então nunca sai. Obs.: a categoria
// "Resultado (1X2)" carrega dígitos no IDIOMA do nome do mercado ("1X2") — NÃO é número de
// linha; por isso o gate é membership-na-allowlist, não um regex de dígito ingênuo (que
// dropparia "1X2" por engano). Dedupe. Aplicado SÓ no /p (o HERO mantém labels verbatim).

import { MARKET_CATEGORY_LABELS } from "@/lib/view/markets/presentation";

const OVER_UNDER = "Over/Under gols";
const MATCH_RESULT = "Resultado (1X2)";
const BTTS = "Ambas marcam";
const DOUBLE_CHANCE = "Dupla chance";
const CORRECT_SCORE = "Placar exato";
const SCORER = "Artilheiro";
const ASSIST = "Assistência";

// Conjunto canônico EXATO (fonte: REGISTRY via presentation.ts). Comparação case-sensitive
// byte-a-byte — um rótulo já-canônico ("Over/Under gols") passa direto.
const CANONICAL_SET: ReadonlySet<string> = new Set(MARKET_CATEGORY_LABELS);

// Família over/under COM linha: só o prefixo PT-BR canônico do cartucho "Mais de <linha>" /
// "Menos de <linha>" mapeia (mais/menos seguido de "de" e um dígito). É o rótulo que a
// betSummary do registry produz ("Mais de 2.5 gols"). Frases NÃO-canônicas com linha —
// "Acima de 2.5", "Over 2.5 goals" — DROPAM (deny-by-default; só o idioma do cartucho mapeia,
// nada de adivinhar variações inglesas com número), assim como "2.5"/"3.5"/"12" soltos.
const OVER_UNDER_FAMILY = /^(mais|menos)\s+de\s+.*\d/i;
// "Over"/"Under"/"Over/Under gols" SEM linha (selectionLabel cru) também são over/under —
// não carregam número, então são seguros pra mapear.
const OVER_UNDER_BARE = /^(over|under|over\/under)(\s+gols)?$/i;

// 1X2 — o marketLabel canônico OU os rótulos de seleção (Casa/Empate/Fora). Comparação
// normalizada (trim + lower + sem acento) pra casar variações de casing.
const MATCH_RESULT_SELECTIONS = new Set([
  "resultado",
  "casa",
  "empate",
  "fora",
]);

// btts — seleções/frases (Sim/Não + as frases leigas do registry).
const BTTS_SELECTIONS = new Set([
  "sim",
  "nao",
  "ambos os times marcam",
  "ambas marcam",
  "pelo menos um time nao marca",
]);

// dupla chance — os 3 rótulos de seleção do seed.
const DOUBLE_CHANCE_SELECTIONS = new Set([
  "casa ou empate",
  "empate ou fora",
  "casa ou fora",
]);

// Placar exato: "H-A" (um dígito de cada lado). A categoria canônica "Placar exato" não
// tem dígito, mas o RÓTULO de seleção sim — mapeia pra categoria (que então passa o tripwire).
const EXACT_SCORE_SELECTION = /^\d+-\d+$/;

// Normaliza pra comparação de família de seleção (não pra exibição): trim, lower, sem acento.
function norm(s: string): string {
  return s
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// Mapeia UM rótulo cru (canônico OU família) → categoria canônica, ou null (drop).
function toCategory(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  // (a) exact-match contra uma das 7 canônicas → verbatim.
  if (CANONICAL_SET.has(trimmed)) return trimmed;

  // (b) tabela/regex de família → canônica.
  const n = norm(trimmed);

  if (OVER_UNDER_FAMILY.test(trimmed) || OVER_UNDER_BARE.test(trimmed)) {
    return OVER_UNDER;
  }
  if (MATCH_RESULT_SELECTIONS.has(n)) return MATCH_RESULT;
  if (BTTS_SELECTIONS.has(n)) return BTTS;
  if (DOUBLE_CHANCE_SELECTIONS.has(n)) return DOUBLE_CHANCE;
  if (EXACT_SCORE_SELECTION.test(trimmed)) return CORRECT_SCORE;
  // scorer/assist: as seleções são nomes de jogador (dinâmicos, droppados por deny-default),
  // mas o rótulo de mercado que o LLM pode citar é "Artilheiro"/"Assistência" — já cobertos
  // pelo CANONICAL_SET. Frases leigas equivalentes (sem acento) mapeiam aqui.
  if (n === "artilheiro" || n === "marcador") return SCORER;
  if (n === "assistencia") return ASSIST;

  // (c) qualquer outra coisa → DROP (deny-by-default).
  return null;
}

/**
 * Normaliza `citedMarkets` (texto livre do LLM) pra lista de CATEGORIAS canônicas pro
 * boundary público /p (ADR 0035 §5). Deny-by-default + tripwire de allowlist: toda string
 * emitida é membro do conjunto canônico do REGISTRY (uma linha crua nunca está na allowlist),
 * e qualquer rótulo não-mapeável é descartado (drop > vazar). Dedupe preservando a ordem de
 * 1ª aparição.
 */
export function toPublicMarketCategories(citedMarkets: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of citedMarkets) {
    const cat = toCategory(raw);
    if (cat === null) continue;
    // TRIPWIRE: defense-in-depth — toda saída tem que ser uma das 7 canônicas (allowlist).
    // Uma linha crua nunca está na allowlist; um cat fora dela seria bug do mapeamento.
    if (!CANONICAL_SET.has(cat)) continue;
    if (seen.has(cat)) continue;
    seen.add(cat);
    out.push(cat);
  }
  return out;
}
