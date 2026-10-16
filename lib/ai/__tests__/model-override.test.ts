import { describe, expect, it } from "vitest";

import {
  initialModelOverride,
  resyncModelOverride,
} from "@/lib/ai/model-override";
import { modelIdFromVersion } from "@/lib/format";

// Regra de seed do dropdown de override (#239): o `<select>` do AnalysisPanel é
// controlado por este valor e o sentinel "default" significa "usar a cascata
// server-side". O dropdown deve abrir refletindo a preferência do usuário (não
// "default") pra o modelo escolhido PERSISTIR entre reanálises — mas só quando a
// preferência é um modelo de fato selecionável pela audiência atual.
describe("initialModelOverride — seed do dropdown de modelo (#239)", () => {
  const selectable = [
    { id: "claude-opus-5-5" },
    { id: "claude-sonnet-5-5" },
    { id: "claude-haiku-5-5" },
  ];

  it("semeia com a preferência quando ela é um modelo selecionável", () => {
    expect(initialModelOverride("claude-haiku-5-5", selectable)).toBe(
      "claude-haiku-5-5",
    );
  });

  it("id de versão antiga (ADR 0061) semeia o 5.5 da mesma família quando ele está na lista", () => {
    expect(initialModelOverride("claude-haiku-4-5", selectable)).toBe(
      "claude-haiku-5-5",
    );
    expect(
      initialModelOverride("claude-sonnet-4-5-20250929", selectable),
    ).toBe("claude-sonnet-5-5");
    expect(initialModelOverride("claude-sonnet-5", selectable)).toBe(
      "claude-sonnet-5-5",
    );
    expect(initialModelOverride("claude-opus-4-8", selectable)).toBe(
      "claude-opus-5-5",
    );
    expect(initialModelOverride("claude-fable-5-1", selectable)).toBe(
      "claude-opus-5-5",
    );
  });

  it("id de versão adotada (ADR 0062), com ou sem tags do motor, semeia a conferida da família", () => {
    // lib/view/analysis.ts semeia o rodapé com modelIdFromVersion(modelVersion): o id
    // que serviu. A versão adotada não é opção do dropdown; a família é.
    for (const [served, pinned] of [
      ["claude-sonnet-5-6", "claude-sonnet-5-5"],
      ["claude-sonnet-6", "claude-sonnet-5-5"],
      ["claude-haiku-5-6-20261101", "claude-haiku-5-5"],
      ["claude-opus-6-20270101", "claude-opus-5-5"],
    ]) {
      expect(initialModelOverride(served, selectable)).toBe(pinned);
      expect(
        initialModelOverride(
          modelIdFromVersion(`${served};engine=code_jev;lambda=dixon_coles`),
          selectable,
        ),
      ).toBe(pinned);
    }
  });

  it("id antigo cai no sentinel quando o 5.5 da família NÃO está na lista", () => {
    const semHaiku = [{ id: "claude-sonnet-5-5" }];
    expect(initialModelOverride("claude-haiku-4-5", semHaiku)).toBe("default");
  });

  it("cai no sentinel 'default' quando não há preferência (null)", () => {
    expect(initialModelOverride(null, selectable)).toBe("default");
  });

  it("cai no sentinel quando a preferência não é um id Claude reconhecível", () => {
    expect(initialModelOverride("modelo-inexistente", selectable)).toBe(
      "default",
    );
    expect(initialModelOverride("gpt-5-mini", selectable)).toBe("default");
    expect(initialModelOverride("", selectable)).toBe("default");
  });

  it("cai no sentinel quando o id é válido mas fora da audiência", () => {
    // Lista resolvida no server sem o Opus: um value órfão sem <option> vira "default".
    const semOpus = [{ id: "claude-sonnet-5-5" }, { id: "claude-haiku-5-5" }];
    expect(initialModelOverride("claude-opus-5-5", semOpus)).toBe("default");
  });

  it("cai no sentinel quando a audiência não tem modelos selecionáveis", () => {
    expect(initialModelOverride("claude-haiku-5-5", [])).toBe("default");
  });
});

// Regressão decisiva do #239: o dropdown deve PERSISTIR o modelo escolhido depois
// que a reanálise conclui — não voltar pro "default". `AnalysisPanel` controla o
// `<select>` por `displayed` (estado) com um valor "vivo" `live` (a última
// escolha) e re-aplica `live` a cada conclusão de action via `resyncModelOverride`.
// Este driver espelha esse loop SEM React, pra a sequência render → escolha →
// conclusão ser determinística. A versão buggada (`useState("default")` fixo, que
// IGNORA `live` na conclusão) falharia o último expect — é isso que blinda contra
// um refactor futuro reintroduzir o reset.
function makePanelModel(seed: string) {
  let displayed = seed; // value atual do <select> (estado controlado)
  let live = seed; // seededOverride: a escolha viva a re-semear nas reanálises

  return {
    get value() {
      return displayed;
    },
    // Usuário escolhe um modelo no dropdown.
    choose(next: string) {
      live = next;
      displayed = next;
    },
    // A action de análise concluiu: o useActionState entrega um novo `state`
    // (identidade diferente) e o componente re-renderiza re-aplicando `live`.
    completeAnalysis() {
      const resynced = resyncModelOverride({
        displayed,
        live,
        actionCompleted: true,
      });
      if (resynced !== null) displayed = resynced;
    },
    // Re-render sem conclusão de action (ex.: pending, prop change): não mexe.
    rerenderWithoutCompletion() {
      const resynced = resyncModelOverride({
        displayed,
        live,
        actionCompleted: false,
      });
      if (resynced !== null) displayed = resynced;
    },
  };
}

describe("resyncModelOverride — persistência do dropdown entre reanálises (#239)", () => {
  it("MANTÉM o modelo escolhido depois que a reanálise conclui (o bug do #239)", () => {
    // Seed = "default" (sem preferência) — caminho do override one-off.
    const panel = makePanelModel("default");
    expect(panel.value).toBe("default");

    panel.choose("claude-haiku-5-5"); // usuário troca o modelo
    panel.completeAnalysis(); // dispara a reanálise e ela conclui

    // Antes da fix isto voltava pra "default"; a regressão é exatamente este expect.
    expect(panel.value).toBe("claude-haiku-5-5");
  });

  it("preserva a escolha através de MÚLTIPLAS reanálises seguidas", () => {
    const panel = makePanelModel("default");
    panel.choose("claude-haiku-5-5");

    panel.completeAnalysis();
    panel.completeAnalysis();
    panel.completeAnalysis();

    expect(panel.value).toBe("claude-haiku-5-5");
  });

  it("mantém a escolha viva mesmo num re-render sem conclusão de action", () => {
    const panel = makePanelModel("default");
    panel.choose("claude-haiku-5-5");

    panel.rerenderWithoutCompletion(); // ex.: render de pending
    expect(panel.value).toBe("claude-haiku-5-5");

    panel.completeAnalysis();
    expect(panel.value).toBe("claude-haiku-5-5");
  });

  it("uma nova escolha substitui a anterior e PERSISTE após a próxima reanálise", () => {
    const panel = makePanelModel("default");

    panel.choose("claude-haiku-5-5");
    panel.completeAnalysis();
    expect(panel.value).toBe("claude-haiku-5-5");

    panel.choose("claude-sonnet-5-5"); // troca de novo
    panel.completeAnalysis();
    expect(panel.value).toBe("claude-sonnet-5-5");
  });

  it("preserva a PREFERÊNCIA semeada (não-default) através da reanálise", () => {
    // Sem escolha one-off: o seed já é a preferência server-side e deve sobreviver.
    const panel = makePanelModel("claude-sonnet-5-5");

    panel.completeAnalysis();

    expect(panel.value).toBe("claude-sonnet-5-5");
  });

  it("não força mudança quando displayed já é igual a live (no-op estável)", () => {
    // Contrato de eficiência: sem divergência, resync não pede setState.
    expect(
      resyncModelOverride({
        displayed: "claude-haiku-5-5",
        live: "claude-haiku-5-5",
        actionCompleted: true,
      }),
    ).toBeNull();
  });
});
