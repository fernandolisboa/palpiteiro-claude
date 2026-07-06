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

// Gate de edge determinístico (ADR 0038): a recomendação do LLM tem edge PERSISTIDO
// abaixo do piso do mercado? true → o predict rebaixa pra "pass" (a disciplina de
// `MIN_EDGE_PP` deixa de ser só compliance-de-prompt e vira invariante de código,
// fechando o achado 3 do Report 03). PURO/testável. Regras:
//  - só corta recomendação REAL (recommendation ≠ "pass");
//  - só corta edge MENSURÁVEL (`edgePctRounded` null = board degradado → NÃO rebaixa:
//    incerteza de medição ≠ abaixo do piso, senão mataria rec legítima sem board);
//  - fronteira ESTRITA (`< minEdgePp`): edge exatamente no piso PASSA, casando o
//    "≥ MIN_EDGE_PP" do prompt;
//  - usa o edge ARREDONDADO (o MESMO valor congelado que staking e a UI mostram) →
//    a decisão do gate nunca diverge do `edge_pct` visível.
export function isBelowEdgeFloor(
  recommendation: string,
  edgePctRounded: number | null,
  minEdgePp: number,
): boolean {
  return (
    recommendation !== "pass" &&
    edgePctRounded !== null &&
    edgePctRounded < minEdgePp
  );
}
