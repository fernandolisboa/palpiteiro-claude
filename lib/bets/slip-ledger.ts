// Contas do histórico "Suas apostas" (#577): status do slip, recorte Em aberto /
// Encerradas e saldo em unidades. PURO (sem `lib/db`): a query entrega `matchOver`
// já calculado (status do jogo + tempo desde o apito) e as colunas numeric como string.

// ── Status do slip (#473, ADR 0036) ─────────────────────────────────────────
// DERIVADO EM LEITURA (nunca coluna denormalizada). PRECEDÊNCIA PINADA (Decisão 5,
// lost domina): (1) alguma perna com outcome `lost` → errou; (2) senão alguma perna
// `settleable=false` → nao_conferida; (3) senão TODA perna com outcome `won` →
// acertou; (4) senão pendente. Perna pendente/não-liquidada tem outcome=null → não
// conta como `won` → nunca falso-acertou (a armadilha do `bool_and` sobre o NULL do
// LEFT JOIN).
export type SlipStatus = "acertou" | "errou" | "pendente" | "nao_conferida";

export function deriveSlipStatus(
  legs: ReadonlyArray<{ settleable: boolean; outcome: { result: string } | null }>,
): SlipStatus {
  if (legs.some((l) => l.outcome?.result === "lost")) return "errou";
  if (legs.some((l) => !l.settleable)) return "nao_conferida";
  if (legs.length > 0 && legs.every((l) => l.outcome?.result === "won"))
    return "acertou";
  return "pendente";
}

export type LedgerMatchStatus = "scheduled" | "live" | "finished" | "postponed" | "cancelled";

export type SlipLedgerLeg = {
  settleable: boolean;
  userOdd: string | null;
  stakeUnits: string | null;
  outcome: { result: "won" | "lost" | "void" | "push" } | null;
};

export type SlipLedgerRow = {
  id: string;
  mode: "simples" | "combinada" | null;
  stakeUnits: string | null;
  comboUserOdd: string | null;
  matchStatus: LedgerMatchStatus;
  // Jogo encerrado (finished/cancelled) OU apitado há mais que a janela de liquidação:
  // cobre o jogo cujo status o cron ainda não virou (ou nunca vira). Adiado nunca
  // acaba por tempo.
  matchOver: boolean;
  // Registrada com o jogo rolando (#580): fora do resumo de pré-jogo (PLAN-580 §11).
  isLive: boolean;
  legs: SlipLedgerLeg[];
};

export type SlipBucket = "open" | "closed";

/**
 * Em aberto × Encerradas. Acertou/errou → encerrada. Pendente → em aberto, exceto
 * jogo cancelado (nunca liquida). Adiado continua em aberto (ainda pode ser jogado);
 * pendente de jogo já acabado fica em aberto até o cron liquidar. Não conferida
 * (perna de cartões etc.) fica em aberto até o jogo acabar.
 */
export function slipBucket(
  slip: Pick<SlipLedgerRow, "legs" | "matchStatus" | "matchOver">,
): SlipBucket {
  const status = deriveSlipStatus(slip.legs);
  if (status === "acertou" || status === "errou") return "closed";
  if (status === "pendente") return slip.matchStatus === "cancelled" ? "closed" : "open";
  return slip.matchOver ? "closed" : "open";
}

function positive(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Lucro do slip em unidades, só de acertou/errou. Simples: stake e odd da perna (é
 * onde o cupom grava). Combinada: stake e odd do slip. Ganhou: stake × (odd − 1);
 * errou: −stake. Sem stake ou sem odd (aposta em texto anterior ao cupom) → null:
 * fica fora do saldo.
 */
export function slipProfitUnits(
  slip: Pick<SlipLedgerRow, "mode" | "stakeUnits" | "comboUserOdd" | "legs">,
): number | null {
  const status = deriveSlipStatus(slip.legs);
  if (status !== "acertou" && status !== "errou") return null;
  const single = slip.mode === "simples" || slip.legs.length === 1;
  const stake = positive(single ? (slip.legs[0]?.stakeUnits ?? null) : slip.stakeUnits);
  const odd = positive(single ? (slip.legs[0]?.userOdd ?? null) : slip.comboUserOdd);
  if (stake === null || odd === null) return null;
  return status === "acertou" ? stake * (odd - 1) : -stake;
}

// Filtro de /apostas (`?status=`): valores curtos em português.
export type SlipFilter = "abertas" | "encerradas";

/** Sem valor (ou inválido): "abertas" quando há alguma em aberto, senão "encerradas". */
export function resolveSlipFilter(raw: string | undefined, hasOpen: boolean): SlipFilter {
  if (raw === "abertas" || raw === "encerradas") return raw;
  return hasOpen ? "abertas" : "encerradas";
}

// Acertos e saldo de um recorte (pré-jogo ou ao vivo).
export type SlipReturnSummary = {
  won: number;
  lost: number;
  settledWithStake: number;
  settledWithoutStake: number;
  balanceUnits: number;
};

export type SlipLedgerSummary = SlipReturnSummary & {
  // Em aberto / Encerradas contam TODAS (as listas mostram as ao vivo com selo).
  open: number;
  closed: number;
  openIds: string[];
  closedIds: string[];
  // Retorno das ao vivo, em linha SEPARADA (#580, PLAN-580 §11): os números de cima
  // (acertos, saldo) são só de pré-jogo. null sem nenhuma aposta ao vivo.
  live: (SlipReturnSummary & { total: number }) | null;
};

type ReturnAcc = {
  won: number;
  lost: number;
  settledWithStake: number;
  settledWithoutStake: number;
  balance: number;
};

const emptyAcc = (): ReturnAcc => ({
  won: 0,
  lost: 0,
  settledWithStake: 0,
  settledWithoutStake: 0,
  balance: 0,
});

function addReturn(acc: ReturnAcc, row: SlipLedgerRow): void {
  const status = deriveSlipStatus(row.legs);
  if (status !== "acertou" && status !== "errou") return;
  if (status === "acertou") acc.won += 1;
  else acc.lost += 1;
  const profit = slipProfitUnits(row);
  if (profit === null) {
    acc.settledWithoutStake += 1;
  } else {
    acc.settledWithStake += 1;
    acc.balance += profit;
  }
}

function toReturn(acc: ReturnAcc): SlipReturnSummary {
  return {
    won: acc.won,
    lost: acc.lost,
    settledWithStake: acc.settledWithStake,
    settledWithoutStake: acc.settledWithoutStake,
    // Arredonda a soma no fim, não por slip (o `+ 0` tira o -0 de um saldo ~zero).
    balanceUnits: Math.round(acc.balance * 100) / 100 + 0,
  };
}

export function summarizeSlipLedger(rows: readonly SlipLedgerRow[]): SlipLedgerSummary {
  const openIds: string[] = [];
  const closedIds: string[] = [];
  const pre = emptyAcc();
  const live = emptyAcc();
  let liveTotal = 0;
  for (const row of rows) {
    (slipBucket(row) === "open" ? openIds : closedIds).push(row.id);
    if (row.isLive) liveTotal += 1;
    addReturn(row.isLive ? live : pre, row);
  }
  return {
    open: openIds.length,
    closed: closedIds.length,
    ...toReturn(pre),
    openIds,
    closedIds,
    live: liveTotal === 0 ? null : { total: liveTotal, ...toReturn(live) },
  };
}
