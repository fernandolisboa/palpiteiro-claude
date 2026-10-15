import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SlipsSummary } from "@/components/bets/slips-summary";
import type { SlipLedgerSummary } from "@/lib/bets/slip-ledger";

function summary(over: Partial<SlipLedgerSummary> = {}): SlipLedgerSummary {
  return {
    open: 3,
    closed: 7,
    won: 4,
    lost: 3,
    settledWithStake: 7,
    settledWithoutStake: 0,
    balanceUnits: 2.35,
    openIds: [],
    closedIds: [],
    live: null,
    ...over,
  };
}

const render = (s: SlipLedgerSummary) => renderToStaticMarkup(<SlipsSummary summary={s} />);

// A <dd> do saldo (a última do resumo).
function balanceCell(html: string): string {
  const all = html.match(/<dd[^>]*>[^<]*<\/dd>/g) ?? [];
  return all.at(-1) ?? "";
}

describe("SlipsSummary (/apostas, #577)", () => {
  it("em aberto, acertos 'N de M' e saldo com sinal", () => {
    const html = render(summary());
    expect(html).toContain("em aberto");
    expect(html).toContain("acertos");
    expect(html).toContain("saldo");
    expect(html).toMatch(/>4<\/span><span[^>]*> de <\/span><span[^>]*>7</);
    expect(html).not.toContain("%");
  });

  it("saldo positivo verde, negativo vermelho, zero neutro", () => {
    const pos = balanceCell(render(summary()));
    expect(pos).toContain("+2,35 u");
    expect(pos).toContain("text-edge-fg");

    const neg = balanceCell(render(summary({ balanceUnits: -1 })));
    expect(neg).toContain("-1,00 u");
    expect(neg).toContain("text-destructive");

    const zero = balanceCell(render(summary({ balanceUnits: 0 })));
    expect(zero).not.toContain("text-edge-fg");
    expect(zero).not.toContain("text-destructive");
  });

  it("sem liquidadas: '—' em acertos e saldo", () => {
    const html = render(
      summary({ won: 0, lost: 0, settledWithStake: 0, balanceUnits: 0, closed: 0 }),
    );
    expect(html.match(/—/g)?.length).toBe(2);
    expect(html).not.toContain("+0,00 u");
  });

  it("a linha 'sem stake' só aparece quando há liquidada sem stake", () => {
    expect(render(summary())).not.toContain("sem stake");
    expect(render(summary({ settledWithoutStake: 2 }))).toContain(
      "apostas sem stake não entram no saldo",
    );
  });

  it("sem ao vivo: nenhuma linha ao vivo", () => {
    expect(render(summary())).not.toContain("ao vivo");
  });

  it("ao vivo (#580): linha separada, com acertos e saldo próprios", () => {
    const live = {
      total: 3,
      won: 1,
      lost: 1,
      settledWithStake: 2,
      settledWithoutStake: 0,
      balanceUnits: -0.4,
    };
    const html = render(summary({ live }));
    expect(html).toContain("ao vivo, fora dos números acima:");
    expect(html).toMatch(/>1<\/span> de <span[^>]*>2<\/span> acertos/);
    expect(html).toContain("-0,40 u");
    // O saldo de cima continua o de pré-jogo.
    expect(balanceCell(html)).toContain("+2,35 u");
  });

  it("ao vivo sem liquidadas: só a contagem", () => {
    const live = {
      total: 1,
      won: 0,
      lost: 0,
      settledWithStake: 0,
      settledWithoutStake: 0,
      balanceUnits: 0,
    };
    const html = render(summary({ live }));
    expect(html).toMatch(/>1<\/span> aposta, sem resultado ainda/);
    expect(html).not.toContain("+0,00 u");
  });
});
