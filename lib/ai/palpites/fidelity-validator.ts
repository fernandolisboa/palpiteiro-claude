import type {
  PalpiteSynthesisOutput,
  PalpitesInput,
} from "./cartridges/cartridge";

// ─── Validador de FIDELIDADE pós-síntese (#380) ───────────────────────────────
//
// FUNÇÃO PURA, DETERMINÍSTICA — sem DB, sem LLM. Roda DEPOIS do Zod + do firewall de
// value-language, ANTES do persist (em generatePalpites). Checa se uma CONTAGEM citada
// na manchete (verdict + narrative) CONTRADIZ um fato PRÉ-CONTADO que JÁ entregamos ao
// modelo no input (#379: h2hSummary.gamesConsidered, {home,away}RecentScores.goalsFor/
// goalsAgainst). Esses fatos são inteiros que NÓS contamos — "a prosa afirmou uma
// contagem que contradiz um inteiro que seguramos" é uma comparação numérica GRÁTIS.
//
// POR QUE REGRAS, NÃO UM JUIZ-LLM (a decisão load-bearing, ADR/issue #380): um juiz-LLM
// custaria +1 chamada PAGA em TODA execução (não só na divergência), adicionaria variância
// de modelo e uma 2ª superfície de alucinação pra guardar a verdade-base — estritamente
// pior contra o gotcha de tokens do CLAUDE.md, sem cumprir nenhum AC que as regras não
// cumpram. Logo: NÃO HÁ chamada de juiz; este validador é uma função pura. O upgrade pra
// um juiz-LLM fica como opção futura explícita se as regras provarem-se estreitas demais.
//
// POSTURA (inegociável):
//   - CONTRADIÇÃO-only: só reprova quando um número CITADO bate de frente com o fato.
//   - OMISSÃO-OK: manchete sem nenhuma contagem citada → {ok:true} (omissão ≠ contradição;
//     mantém a taxa de falso-positivo / regen desnecessário perto de zero).
//   - FATO-AUSENTE→ok: h2hSummary/recentScores são `.optional()` (input montado à mão em
//     testes) — ausente → {ok:true} (NUNCA fabricar uma falha sobre dado que não temos).
//   - NUNCA-throw: todo parseInt é NaN-guarded; um validador que lança quebraria o palpite
//     e violaria o graceful-degrade. checkFidelity é incapaz de lançar por conta própria.
//
// ESCOPO v1 (estreito de propósito): SÓ os inteiros brutos que o modelo de fato repete —
//   (1) contagem de confrontos H2H ("Em N confrontos") vs h2hSummary.gamesConsidered;
//   (2) totais de gols ("N gols marcados" / "N (gols) sofridos") vs
//       {home,away}RecentScores.goalsFor / goalsAgainst.
// EXCLUÍDO de v1 (deliberado, R1): a checagem de forma V/E/D em prosa livre. O
// `${wins}V ${draws}E ${losses}D` é a string de INPUT do prompt FORNECIDA ao modelo
// (cartridge.ts:527,540), não o que a narrativa de torcida em prosa LIVRE escreve de volta
// → o regex quase nunca casaria (dead code, ~0% cobertura) E carrega uma colisão de letra
// D (cartridge.ts:519-524: D=Draw→'E', L=Loss→'D'), fazendo o 3º grupo capturar DERROTAS,
// não empates → erraria. Uma checagem near-never-match-AND-wrong é EV-negativo; foi
// removida. Paráfrases que o regex não pega são falso-NEGATIVO (sem dano, só sem captura),
// não falso-positivo — aceitável pra v1.

export type FidelityCheck = { ok: true } | { ok: false; reason: string };

// parseInt NaN-guarded: captura de regex que não vira inteiro finito → null (NUNCA NaN
// vazando pra um compare que silenciosamente sempre passa OU sempre falha).
function toInt(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Checa fidelidade das CONTAGENS citadas na manchete contra os fatos pré-contados do
 * input (#379). Pura, determinística, NUNCA lança. Reprova SÓ em contradição direta.
 * O `reason` nomeia campo + claimed-vs-actual pro log de ai_calls/console.
 */
export function checkFidelity(
  output: PalpiteSynthesisOutput,
  input: PalpitesInput,
): FidelityCheck {
  // Concatena os DOIS campos de prosa livre que cruzam pra manchete. Os regexes são
  // case-insensitive (/i); os fatos são inteiros, então o caso não importa.
  const prose = `${output.verdict} ${output.narrative}`;

  // ── (1) Contagem de confrontos H2H ─────────────────────────────────────────
  // "Em N confronto(s)" vs h2hSummary.gamesConsidered. Fato ausente → pula (ok).
  const h2h = input.h2hSummary;
  if (h2h) {
    const m = prose.match(/em\s+(\d+)\s+confronto/i);
    const claimed = toInt(m?.[1]);
    if (claimed !== null && claimed !== h2h.gamesConsidered) {
      return {
        ok: false,
        reason: `h2h.gamesConsidered: manchete cita ${claimed} confronto(s), fato pré-contado = ${h2h.gamesConsidered}`,
      };
    }
  }

  // ── (2) Totais de gols (marcados / sofridos) ───────────────────────────────
  // A manchete cita um total de gols de UM lado; conferimos contra os totais
  // pré-contados de QUALQUER lado (a prosa raramente atribui o número a um time
  // específico de forma parseável). CONTRADIÇÃO = o número citado não bate com NENHUM
  // dos lados que temos — isso mantém a postura contradiction-only (se casa um lado, é
  // um fato verdadeiro restituído, não uma contradição). Lados ausentes são ignorados.
  const goalsFor = collectTotals(input, "goalsFor");
  const goalsAgainst = collectTotals(input, "goalsAgainst");

  const marcadosClaim = toInt(prose.match(/(\d+)\s+gols?\s+marcados/i)?.[1]);
  if (marcadosClaim !== null && goalsFor.length > 0 && !goalsFor.includes(marcadosClaim)) {
    return {
      ok: false,
      reason: `recentScores.goalsFor: manchete cita ${marcadosClaim} gol(s) marcados, totais pré-contados = [${goalsFor.join(", ")}]`,
    };
  }

  const sofridosClaim = toInt(
    prose.match(/(\d+)\s+(?:gols?\s+)?sofridos/i)?.[1],
  );
  if (
    sofridosClaim !== null &&
    goalsAgainst.length > 0 &&
    !goalsAgainst.includes(sofridosClaim)
  ) {
    return {
      ok: false,
      reason: `recentScores.goalsAgainst: manchete cita ${sofridosClaim} gol(s) sofridos, totais pré-contados = [${goalsAgainst.join(", ")}]`,
    };
  }

  return { ok: true };
}

// Junta os totais pré-contados de AMBOS os lados (home/away) que existem no input.
// Lados ausentes (recentScores `.optional()`) são simplesmente omitidos do array.
function collectTotals(
  input: PalpitesInput,
  field: "goalsFor" | "goalsAgainst",
): number[] {
  const totals: number[] = [];
  if (input.homeRecentScores) totals.push(input.homeRecentScores[field]);
  if (input.awayRecentScores) totals.push(input.awayRecentScores[field]);
  return totals;
}
