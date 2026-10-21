import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  allowedNumbers,
  BET_SLIP_EXPLAIN_VERSION,
  buildExplainUserMessage,
  EXPLAIN_SYSTEM_PROMPT,
  EXPLAIN_TOOL_NAME,
  explainTool,
} from "@/lib/ai/bet-slip-explain/cartridge";
import { BOOKMAKER_NAME_RE } from "@/lib/ai/bet-slip-explain/fidelity";

import { comboInput, simplesInput } from "./fixtures";

const HOUSE_COPY = /(odds?|margem) da (sua )?casa|na casa\b|das casas/i;

describe("cartucho bet_slip_explain (#562)", () => {
  it("versão e ferramenta", () => {
    expect(BET_SLIP_EXPLAIN_VERSION).toBe("bet_slip_explain_v1");
    expect(explainTool.name).toBe(EXPLAIN_TOOL_NAME);
  });

  it("prompt pinado: mudou o texto → bump da versão e commit `prompt:`", () => {
    const sha = createHash("sha256")
      .update(EXPLAIN_SYSTEM_PROMPT)
      .digest("hex")
      .slice(0, 16);
    expect(`${BET_SLIP_EXPLAIN_VERSION}:${sha}`).toMatchInlineSnapshot(
      `"bet_slip_explain_v1:48a8ddf0430d78f4"`
    );
  });

  it("regras: números fixos, veredito do código, break-even ≠ probabilidade do mercado, sem mandar apostar", () => {
    expect(EXPLAIN_SYSTEM_PROMPT).toContain("Números são fixos");
    expect(EXPLAIN_SYSTEM_PROMPT).toContain("nunca o contradiga");
    expect(EXPLAIN_SYSTEM_PROMPT).toContain("NÃO é a probabilidade do mercado");
    expect(EXPLAIN_SYSTEM_PROMPT).toContain("Nunca mande apostar");
    expect(EXPLAIN_SYSTEM_PROMPT).toContain("não é a multiplicação");
  });

  it("nenhuma casa de apostas no prompt nem na mensagem", () => {
    for (const text of [
      EXPLAIN_SYSTEM_PROMPT,
      buildExplainUserMessage(simplesInput()),
      buildExplainUserMessage(comboInput()),
    ]) {
      expect(text).not.toMatch(BOOKMAKER_NAME_RE);
      expect(text).not.toMatch(HOUSE_COPY);
    }
  });

  it("mensagem da simples: números em PT-BR, edge em pontos, veredito, JEV e regra do stake", () => {
    const msg = buildExplainUserMessage(simplesInput());
    expect(msg).toContain("[0] Mais de 2,5 gols");
    expect(msg).toContain("chance pelo modelo: 56,2%");
    expect(msg).toContain(
      "sua odd: 1,95; chance mínima pra ela se pagar: 51,3%; retorno esperado: +9,6%"
    );
    expect(msg).toContain(
      "mercado sem a margem: 50,1% (odd de mercado 1,90); vantagem do modelo: +6,1 pontos"
    );
    expect(msg).toContain("veredito do código: com valor");
    expect(msg).toContain("veredito do código: sem valor");
    expect(msg).toContain("ataque do Palmeiras ajustado para baixo");
    expect(msg).toContain("de 1 a 3u");
    // Vantagem negativa não ganha a nota do piso.
    expect(msg).not.toContain("abaixo do piso");
    expect(msg).not.toContain("Combinada:");
  });

  it("mensagem da combinada: pernas sem odd própria, bloco da combinada, base ausente dita", () => {
    const msg = buildExplainUserMessage(comboInput());
    expect(msg).toContain("(seleção da combinada)");
    expect(msg).not.toContain("sua odd:");
    expect(msg).toContain("chance conjunta pelo modelo de placar: 31,5%");
    expect(msg).toContain("odd da combinada: 3,40");
    expect(msg).toContain("sem a base do jogo no registro");
    expect(msg).not.toContain("Regra do stake");
  });

  it("allowedNumbers: percentuais (com |EV|), pontos, odds, linhas e stakes", () => {
    const a = allowedNumbers(simplesInput());
    expect(a.percents).toEqual(expect.arrayContaining([56.2, 48, 52.3, 50.1]));
    expect(a.percents.some((n) => Math.abs(n - 13.6) < 0.05)).toBe(true);
    expect(a.points.some((n) => Math.abs(n - 4.3) < 0.01)).toBe(true);
    expect(a.decimals).toEqual(
      expect.arrayContaining([1.95, 1.8, 1.9, 1.85, 2.5])
    );
    expect(a.units).toEqual(expect.arrayContaining([1, 2, 3]));
  });
});
