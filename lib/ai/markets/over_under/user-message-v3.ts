import type { OverUnderInputV3 } from "./schemas";
import {
  fmtNum,
  pushTemporalSection,
  renderContextSections,
  type UserMessageContext,
} from "./user-message";

// Mensagem do usuário pro cartucho MULTI-LINHA (over_under v3.0, #175). As seções
// de CONTEXTO (# Jogo, # Mandante/Visitante, # Confrontos diretos H2H, # Contexto
// temporal) são REUSADAS do v2 via renderContextSections/pushTemporalSection
// (byte-idênticas). O que diverge é o bloco de odds: lista CADA linha candidata
// (1.5/2.5/3.5) com over/under + implícita, e a tarefa pede pra escolher a MELHOR
// linha + lado (ou pass) pela mesma regra de edge >= 5%.
export function buildUserMessageV3(
  input: OverUnderInputV3,
  context: UserMessageContext,
): string {
  const lines = renderContextSections(input);

  lines.push("");
  lines.push("# Odds e probabilidades implícitas por linha");
  for (const ln of input.lines) {
    lines.push("");
    lines.push(
      `## Linha ${fmtNum(ln.line, 1)} — ${ln.bookmaker} (capturado em ${ln.captured_at})`,
    );
    lines.push(
      `- Over ${fmtNum(ln.line, 1)}: odd ${fmtNum(ln.over_decimal)} → implícita normalizada ${fmtNum(ln.over_pct)}%`,
    );
    lines.push(
      `- Under ${fmtNum(ln.line, 1)}: odd ${fmtNum(ln.under_decimal)} → implícita normalizada ${fmtNum(ln.under_pct)}%`,
    );
  }

  pushTemporalSection(lines, context);

  lines.push("");
  lines.push("# Sua tarefa");
  lines.push(
    'Avalie TODAS as linhas acima e escolha UMA recomendação: a melhor combinação de linha (1.5, 2.5 ou 3.5) e lado ("over" ou "under"), ou "pass". Aplique a regra de edge >= 5% por lado/linha. Reporte sempre a linha avaliada como mais próxima de apostável no campo line (mesmo em "pass"). Chame a ferramenta submit_prediction com os campos do schema.',
  );

  return lines.join("\n");
}
