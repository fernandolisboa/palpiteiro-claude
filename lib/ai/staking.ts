// Mapeamento determinístico edge/confiança → unidades de aposta (ADR 0019). A
// decisão de stake é tomada EM CÓDIGO, nunca pelo LLM (que só emite
// recommendation/confidence_pct; o edge sai das odds): dimensionar dinheiro não
// é calibrável/reprodutível pelo modelo (ADR 0019, decisão 1).
//
// Bandas (ADR 0019, decisão 2) — a mais alta cujos DOIS pisos (edge E confiança)
// qualificam; cascateia pra baixo; teto 3u. Edge alto com confiança baixa NÃO
// sobe (guarda contra longshots de alta variância). `edgePct` null (pass / sem
// implícita) → 1u: não se dimensiona aposta sem edge (e o stake do pass é
// irrelevante — excluído do Yield).
export function computeStakeUnits(
  edgePct: number | null,
  confidencePct: number,
): 1 | 2 | 3 {
  if (edgePct === null) return 1;
  if (edgePct >= 12 && confidencePct >= 55) return 3;
  if (edgePct >= 8 && confidencePct >= 50) return 2;
  return 1;
}
