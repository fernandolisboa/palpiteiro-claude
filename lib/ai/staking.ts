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

// Quarter-Kelly (ADR 0039 D3, #503) — substitui as bandas QUANDO o gate do Kelly
// está pronto (o caller decide; aqui é só a fórmula, pura). f* = (p·o − 1)/(o − 1)
// sobre uma banca nominal de 100u; stake = ¼·f*·100 arredondado a 0.5u, clamp
// [0.5, 3] (o teto de 3u do ADR 0019 continua). `pModel` em [0,1], `odd` decimal > 1.
// Entrada inválida → null (o caller cai nas bandas; nunca stake NaN).
export const KELLY_FRACTION = 0.25;
export const KELLY_MIN_UNITS = 0.5;
export const KELLY_MAX_UNITS = 3;

export function computeKellyStakeUnits(
  pModel: number,
  odd: number,
): number | null {
  if (
    !Number.isFinite(pModel) ||
    !Number.isFinite(odd) ||
    pModel <= 0 ||
    pModel >= 1 ||
    odd <= 1
  ) {
    return null;
  }
  const fStar = (pModel * odd - 1) / (odd - 1);
  const units = Math.round(KELLY_FRACTION * fStar * 100 * 2) / 2;
  return Math.min(KELLY_MAX_UNITS, Math.max(KELLY_MIN_UNITS, units));
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
