import { describe, expect, it } from "vitest";

import { canSubmit } from "../can-submit";

// Teste load-bearing do gate de maioridade (#282): a regra "desabilitado sem o
// check / habilitado com o check" que governa os três métodos do /signin. O repo
// não tem harness de evento de DOM (Testing Library/user-event), então a regra é
// coberta pelo predicado puro em vez de simulação de clique.
describe("canSubmit — gate do checkbox 18+ do /signin", () => {
  it("desabilita (false) quando o checkbox NÃO está marcado", () => {
    expect(canSubmit(false)).toBe(false);
  });

  it("habilita (true) quando o checkbox está marcado", () => {
    expect(canSubmit(true)).toBe(true);
  });
});
