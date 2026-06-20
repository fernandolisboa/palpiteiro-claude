import type { palpites } from "@/db/schema";
import type { PalpiteSynthesisOutput } from "./cartridges/cartridge";
import { deriveSettleable, type PalpiteType } from "./settleable";

// Linha a inserir em `palpites` (shape de escrita). `palpiteSetId` é preenchido pelo
// caller (id do set recém-inserido). `params` carrega a union LARGA por tipo (#354).
type SettleableRowInsert = typeof palpites.$inferInsert;

const TEXT_MAX = 280;

// ─── Templates de texto FIXOS (auditáveis, firewall-safe) ─────────────────────
//
// MANDATÓRIO (PLAN §3.13 [P]): o `text` de TODA row settleable vem deste conjunto
// PINADO de templates fixos — determinístico sobre os campos inteiros estruturados
// (probableScore/firstHalfScore/firstToScore/minMargin), NUNCA texto livre do LLM.
// Sem número de VALOR (placar/proposição ≠ odd/edge); o containsValueLanguage guard
// roda sobre eles em geração (index.ts). O golden test pina as strings EXATAS.
const SIDE_LABEL: Record<"home" | "away", string> = {
  home: "Mandante",
  away: "Visitante",
};

function exactScoreText(home: number, away: number): string {
  return `Placar provável: ${home}–${away}`;
}

function marginText(side: "home" | "away", minMargin: number): string {
  return `${SIDE_LABEL[side]} ganha por ${minMargin}+`;
}

function cleanSheetText(side: "home" | "away"): string {
  return `${SIDE_LABEL[side]} não sofre gol`;
}

function firstHalfScoreText(home: number, away: number): string {
  return `1º tempo: ${home}–${away}`;
}

function firstToScoreText(side: "home" | "away"): string {
  return `${SIDE_LABEL[side]} marca primeiro`;
}

// #419 — A LINHA é do PROJETO, não do LLM (mata a precisão-fingida): a rung qualitativa
// do modelo (cardsTemperature) vira uma linha FIXA de total de AMARELOS. O #394 liquida
// `total yellows >= line`. O input não tem dado de cartão/árbitro/faltas → um inteiro
// livre seria precisão fingida; o mapa coarse 4/6 é a credibilidade.
const CARDS_LINE: Record<"pegado" | "muito_pegado", number> = {
  pegado: 4,
  muito_pegado: 6,
};
function cardsText(t: "pegado" | "muito_pegado"): string {
  // Honesto com a CHAVE de liquidação (amarelos, ADR 0033) — NÃO "Jogo pegado" (tempo,
  // que incluiria vermelhos/brigas). O #394 confere total de AMARELOS >= line.
  return `${CARDS_LINE[t]}+ cartões amarelos`;
}

// O param `type` é PalpiteType (enum completo) — largo o bastante pro caso fun-only
// `cards` (#419), que está FORA de SettleablePalpiteType. deriveSettleable já recebe
// PalpiteType, então o widening é seguro: settleable continua DERIVADO do tipo.
function row(
  type: PalpiteType,
  text: string,
  params: SettleableRowInsert["params"],
): Omit<SettleableRowInsert, "palpiteSetId"> {
  return {
    type,
    text: text.length > TEXT_MAX ? text.slice(0, TEXT_MAX) : text,
    params,
    // settleable DERIVADO da constante de tipo — NUNCA do LLM (ADR 0028 §3).
    settleable: deriveSettleable(type),
  };
}

/**
 * Constrói as linhas settleable de UMA síntese (#354). Sempre emite a linha
 * `exact_score` (a manchete/placar central); as outras 4 dimensões são EMITIDAS SÓ
 * QUANDO COERENTES com `probableScore` (gate de emissão, PLAN §2.4/§3.13) — uma
 * dimensão incoerente é PULADA (uma a menos, honesto), nunca barrada com null. Logo
 * um set rende exact_score + 0..4 dimensões.
 *
 * Coerência ancorada em `probableScore` (o campo ESTRUTURADO contratado coerente com o
 * veredito), NÃO no `verdict` em texto livre:
 *   - margin: só se |home-away| >= 2 (floor — "ganha por 2+" é ortogonal ao 1X2,
 *     nunca colapsa pra "home vence"). Empate/vitória-por-1 não emitem.
 *   - clean_sheet: só se UM lado leva 0 no placar provável (e não 0-0); emite pro lado
 *     que não sofre. Ambos marcam → não emite.
 *   - first_half_score: só se <= probableScore em CADA lado (gols só acumulam).
 *   - first_to_score: só se ∈{home,away} E concorda com o vencedor implícito de
 *     probableScore. "none" NUNCA emite row (fica só como caso interno de settlement).
 *
 * #419 — `cards` (fun-only, settleable=false derivado): uma linha A MAIS, ORTOGONAL ao
 * placar (cartões não derivam de probableScore) → SEM gate de coerência, só presença-
 * gated (o modelo OMITE cardsTemperature em jogo morno). A LINHA de amarelos é do
 * PROJETO (CARDS_LINE), não do LLM. Não entra no cron (#394 a promove a settleable).
 */
export function buildSettleablePalpiteRows(
  palpiteSetId: string,
  output: PalpiteSynthesisOutput,
): SettleableRowInsert[] {
  const { probableScore, firstHalfScore, firstToScore } = output;
  const rows: Omit<SettleableRowInsert, "palpiteSetId">[] = [];

  // exact_score — sempre. O placar provável é o ponto central conferido.
  rows.push(
    row("exact_score", exactScoreText(probableScore.home, probableScore.away), {
      home: probableScore.home,
      away: probableScore.away,
    }),
  );

  // margin — floor >= 2 (ortogonal ao 1X2). Lado = quem tem mais gols.
  const diff = Math.abs(probableScore.home - probableScore.away);
  if (diff >= 2) {
    const side: "home" | "away" =
      probableScore.home > probableScore.away ? "home" : "away";
    rows.push(
      row("margin", marginText(side, diff), { side, minMargin: diff }),
    );
  }

  // clean_sheet — só quando UM lado leva 0 (e não 0-0). Emite pro lado que não sofre.
  const homeCleanSheet = probableScore.away === 0 && probableScore.home > 0;
  const awayCleanSheet = probableScore.home === 0 && probableScore.away > 0;
  if (homeCleanSheet) {
    rows.push(row("clean_sheet", cleanSheetText("home"), { side: "home" }));
  } else if (awayCleanSheet) {
    rows.push(row("clean_sheet", cleanSheetText("away"), { side: "away" }));
  }

  // first_half_score — só quando <= probableScore em CADA lado.
  if (
    firstHalfScore.home <= probableScore.home &&
    firstHalfScore.away <= probableScore.away
  ) {
    rows.push(
      row(
        "first_half_score",
        firstHalfScoreText(firstHalfScore.home, firstHalfScore.away),
        { home: firstHalfScore.home, away: firstHalfScore.away },
      ),
    );
  }

  // first_to_score — só home/away E concordando com o vencedor implícito do placar
  // provável. "none" nunca emite (caso interno de settlement só).
  const winnerAgrees =
    (firstToScore === "home" && probableScore.home > probableScore.away) ||
    (firstToScore === "away" && probableScore.away > probableScore.home);
  if (winnerAgrees && (firstToScore === "home" || firstToScore === "away")) {
    rows.push(
      row("first_to_score", firstToScoreText(firstToScore), { firstToScore }),
    );
  }

  // cards — fun-only (settleable=false derivado de "cards" estar FORA da tupla settleable).
  // ORTOGONAL ao placar: SEM gate de coerência (cartões não derivam de probableScore).
  // Presença-gated (cardsTemperature é OPCIONAL — o modelo OMITE em jogo morno).
  if (output.cardsTemperature) {
    const t = output.cardsTemperature;
    rows.push(row("cards", cardsText(t), { line: CARDS_LINE[t], scope: "total" }));
  }

  return rows.map((r) => ({ ...r, palpiteSetId }));
}
