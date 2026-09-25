import { enrichDashboardRowsWithClosing } from "@/lib/dashboard/clv-enrich";
import { clvNoVigDeltas, keepLatestPerMatch } from "@/lib/dashboard/kpis";
import { getEnableKellyStaking } from "@/lib/db/queries/ai-config";
import { getOverUnderCalibrationRows } from "@/lib/db/queries/calibration";
import { getAllDashboardRows } from "@/lib/db/queries/dashboard";

import { evaluateKellyGate, type KellyGate } from "./phase-c-gate";

// Leitura AO VIVO do gate do Kelly (ADR 0039 D3/D4, #503). Um só caminho de dados pra
// /admin/calibration (exibe) e pro predict (decide o staking) — os dois nunca
// divergem sobre "pronto".

/** CLV de TODAS as recomendações (mede o modelo) + calibração → gate. */
export async function loadKellyGate(): Promise<KellyGate> {
  const [dashboardRows, calibrationRows] = await Promise.all([
    getAllDashboardRows(),
    getOverUnderCalibrationRows(),
  ]);
  // Dedup por (jogo, mercado) como o dashboard (ADR 0020).
  const withClosing = keepLatestPerMatch(
    await enrichDashboardRowsWithClosing(dashboardRows),
  );
  return evaluateKellyGate({
    clvNoVigDeltasPp: clvNoVigDeltas(withClosing),
    calibrationRows,
  });
}

// Memo por instância: o gate muda devagar (precisa de dezenas de jogos novos), então
// reavaliar a cada predict seria custo de DB sem ganho. 1h de TTL.
const TTL_MS = 60 * 60 * 1000;
let memo: { at: number; active: boolean } | null = null;

/**
 * O predict deve usar quarter-Kelly? true só com o kill-switch ON **e** o gate
 * pronto. FAIL-CLOSED: qualquer erro de leitura → false (bandas do ADR 0019) —
 * staking nunca depende de uma query que falhou.
 */
export async function isKellyStakingActive(now = Date.now()): Promise<boolean> {
  if (memo && now - memo.at < TTL_MS) return memo.active;
  let active = false;
  try {
    active = (await getEnableKellyStaking()) && (await loadKellyGate()).ready;
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "kelly-gate",
        error: "gate_read_failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    active = false;
  }
  memo = { at: now, active };
  return active;
}

/** Só pra testes: zera o memo entre casos. */
export function resetKellyGateMemo(): void {
  memo = null;
}
