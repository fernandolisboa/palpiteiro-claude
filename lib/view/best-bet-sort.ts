import type { BestBetRank } from "@/lib/view/types";

export type BestBetSortMode = "edge" | "ev" | "edgeConf";

// Ordenação das N análises do best bet (#178). PURA e client-safe: o painel ordena
// no cliente e o best bet code_jev (#512) usa a MESMA regra no servidor pra escolher
// o mercado narrado (= o card do topo no modo default "edge").
// Regras (§ranking): passes (sem aposta) afundam por ÚLTIMO em TODO modo; entre os
// não-pass o primário é a chave ativa (desc); o tiebreak é uma ORDEM TOTAL estável
// (EV/unidade desc, depois marketKey alfabético) pra o #1 não pular conforme o
// histórico do toggle. Só o EDGE é normalizado por impliedSumTarget (o edgePct vive na
// escala Σ=impliedSumTarget do mercado; ÷target o põe numa base Σ=1 por outcome coberto,
// cross-comparável — ADR 0018). A CONFIANÇA NÃO é normalizada: é a prob do modelo pra a
// seleção recomendada, já um [0,100] plano e diretamente comparável entre mercados
// (dividir por impliedSumTarget penalizaria dupla chance em DOBRO — impliedSumTarget²).
// EV/unidade já é overround-free e cross-comparável. Um não-pass com chave null cai
// entre os não-pass (acima dos passes), nunca afundado junto deles.
export function sortBestBetEntries<
  T extends { marketKey: string; rank: BestBetRank },
>(entries: T[], mode: BestBetSortMode): T[] {
  const primary = (e: T): number => {
    const r = e.rank;
    if (mode === "ev") return r.evPerUnit ?? Number.NEGATIVE_INFINITY;
    const edge = r.edgePct !== null ? r.edgePct / r.impliedSumTarget : null;
    if (edge === null) return Number.NEGATIVE_INFINITY;
    if (mode === "edge") return edge;
    return edge * r.confidencePct; // edgeConf: edge já normalizado × confiança plana
  };
  return [...entries].sort((a, b) => {
    if (a.rank.isPass !== b.rank.isPass) return a.rank.isPass ? 1 : -1;
    const pa = primary(a);
    const pb = primary(b);
    if (pb !== pa) return pb - pa;
    const ea = a.rank.evPerUnit ?? Number.NEGATIVE_INFINITY;
    const eb = b.rank.evPerUnit ?? Number.NEGATIVE_INFINITY;
    if (eb !== ea) return eb - ea;
    return a.marketKey.localeCompare(b.marketKey);
  });
}
