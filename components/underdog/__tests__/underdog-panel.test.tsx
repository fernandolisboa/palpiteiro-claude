import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/underdog", () => ({ openUnderdogView: vi.fn() }));

import { openUnderdogView } from "@/app/actions/underdog";
import {
  UNDERDOG_COST_NOTE,
  UNDERDOG_LOADING_COPY,
  UnderdogPanel,
  underdogReadyCopy,
} from "@/components/underdog/underdog-panel";
import { containsValueLanguage } from "@/lib/ai/palpites/value-language-guard";
import {
  UNDERDOG_STALE_CHANGED,
  UNDERDOG_STALE_REFRESH,
  UNDERDOG_TEMPLATE_NOTE,
  type UnderdogPanelView,
  type UnderdogSlotView,
} from "@/lib/view/underdog";

const MATCH_ID = "11111111-1111-1111-1111-111111111111";

const VIEW: UnderdogPanelView = {
  underdogName: "Flamengo",
  favoriteName: "Palmeiras",
  chances: { underdog: "24%", draw: "27%", favorite: "49%" },
  oneInN: 4,
  scorelines: [
    { label: "0 × 1", pct: "8%" },
    { label: "1 × 2", pct: "6%" },
    { label: "0 × 2", pct: "4%" },
  ],
  scenarios: [
    {
      label: "Se Flamengo estiver vencendo por 1 × 0 aos 30'",
      before: "24%",
      after: "55%",
    },
  ],
  signals: [
    {
      label: "Flamengo venceu 2 dos últimos 5 confrontos",
      origin: "dados",
      note: null,
    },
  ],
  narrative: {
    sentences: [
      "O Flamengo venceu 2 dos últimos 5 confrontos.",
      "Um gol cedo muda tudo: a chance passa de 24% para 55%.",
    ],
    counterpoint: "Ainda assim, o Palmeiras vence 49% das vezes.",
    family: "Sonnet",
    cut: 1,
    source: "llm",
  },
  freshness: "current",
};

const TEASER = { underdogName: "Flamengo", pct: "24%" };

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.mocked(openUnderdogView).mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const header = () =>
  container.querySelector<HTMLButtonElement>("h2 > button[aria-expanded]")!;
const region = () => container.querySelector<HTMLElement>('[role="region"]')!;
const render = (slot: UnderdogSlotView) =>
  act(async () =>
    root.render(<UnderdogPanel matchId={MATCH_ID} slot={slot} />)
  );

describe("UnderdogPanel — fechado (#671)", () => {
  it("mostra o lado, a chance e o custo; nada aberto e sem chamar a action", async () => {
    await render({ teaser: TEASER, view: null });
    const btn = header();
    expect(btn.textContent).toContain("Chances do azarão");
    expect(btn.textContent).toContain("Flamengo vence");
    expect(btn.textContent).toContain("24%");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(btn.getAttribute("type")).toBe("button");
    const cost = document.getElementById(btn.getAttribute("aria-describedby")!);
    expect(cost?.textContent).toBe(UNDERDOG_COST_NOTE);
    expect(region().hidden).toBe(true);
    expect(openUnderdogView).not.toHaveBeenCalled();
    // Só o matchId vai ao servidor.
    const inputs = container.querySelectorAll("input");
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.name).toBe("matchId");
    expect(inputs[0]!.value).toBe(MATCH_ID);
  });

  it("abrir sem texto guardado chama a action e mostra o resultado", async () => {
    let resolve: (v: unknown) => void = () => {};
    vi.mocked(openUnderdogView).mockImplementation(
      () => new Promise((r) => (resolve = r as (v: unknown) => void))
    );
    await render({ teaser: TEASER, view: null });
    header().focus();
    await act(async () => header().click());
    expect(openUnderdogView).toHaveBeenCalledTimes(1);
    // Carregando: o botão focado segue focável (aria-disabled, sem `disabled`) e um
    // segundo clique não chama a action de novo.
    expect(header().disabled).toBe(false);
    expect(header().getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(header());
    await act(async () => header().click());
    expect(openUnderdogView).toHaveBeenCalledTimes(1);
    const fd = vi.mocked(openUnderdogView).mock.calls[0]![1];
    expect(fd.get("matchId")).toBe(MATCH_ID);
    expect(container.textContent).toContain(UNDERDOG_LOADING_COPY);
    expect(container.querySelector("form")!.getAttribute("aria-busy")).toBe(
      "true"
    );
    expect(header().getAttribute("aria-expanded")).toBe("true");

    await act(async () => resolve({ ok: true, view: VIEW, charged: true }));
    expect(container.textContent).not.toContain(UNDERDOG_LOADING_COPY);
    expect(region().hidden).toBe(false);
    expect(container.textContent).toContain("Placares de zebra mais prováveis");
    expect(container.textContent).toContain("Se acontecer…");
    expect(container.textContent).toContain("Sinais a favor hoje");
    expect(container.textContent).toContain("1 frase cortada");
    // Pago: o custo some e o título recebe o foco; o status anuncia o resultado.
    expect(container.textContent).not.toContain(UNDERDOG_COST_NOTE);
    expect(document.activeElement?.tagName).toBe("H3");
    expect(container.querySelector('[role="status"]')!.textContent).toBe(
      underdogReadyCopy("Flamengo", "24%")
    );
    expect(header().getAttribute("aria-disabled")).toBeNull();
  });

  it("erro da action aparece no status e não abre o painel", async () => {
    vi.mocked(openUnderdogView).mockResolvedValue({
      ok: false,
      error: "Você atingiu o limite.",
    });
    await render({ teaser: TEASER, view: null });
    await act(async () => header().click());
    expect(container.querySelector('[role="status"]')!.textContent).toContain(
      "Você atingiu o limite."
    );
    expect(header().getAttribute("aria-expanded")).toBe("false");
    expect(region().hidden).toBe(true);
  });
});

describe("UnderdogPanel — texto guardado", () => {
  it("abre na hora, sem chamar a action, e fecha de novo", async () => {
    await render({ teaser: TEASER, view: VIEW });
    expect(header().getAttribute("aria-describedby")).toBeNull();
    await act(async () => header().click());
    expect(openUnderdogView).not.toHaveBeenCalled();
    expect(region().hidden).toBe(false);
    expect(container.textContent).toContain("Advogado da zebra · Sonnet");
    expect(container.textContent).toContain("Revisor adversarial · Haiku");
    expect(container.textContent).not.toContain("Atualizar");
    await act(async () => header().click());
    expect(region().hidden).toBe(true);
  });

  it("texto padrão: sem família do advogado, com a nota do template", () => {
    const html = renderToStaticMarkup(
      <UnderdogPanel
        matchId={MATCH_ID}
        slot={{
          teaser: TEASER,
          view: {
            ...VIEW,
            narrative: {
              ...VIEW.narrative,
              family: null,
              cut: 0,
              source: "template",
            },
          },
        }}
      />
    );
    expect(html).toContain(UNDERDOG_TEMPLATE_NOTE);
    expect(html).not.toContain("Advogado da zebra ·");
    expect(html).not.toContain("Revisor adversarial");
  });

  it("base recalculada: aviso e 'Atualizar' (submit do form)", async () => {
    await render({ teaser: TEASER, view: { ...VIEW, freshness: "refresh" } });
    expect(container.textContent).toContain(UNDERDOG_STALE_REFRESH);
    const update = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.startsWith("Atualizar")
    )!;
    expect(update.getAttribute("type")).toBe("submit");
    expect(update.closest("form")).toBe(container.querySelector("form"));
  });

  it("'Atualizar' some no carregando: o foco vai pro painel e depois pro título", async () => {
    let resolve: (v: unknown) => void = () => {};
    vi.mocked(openUnderdogView).mockImplementation(
      () => new Promise((r) => (resolve = r as (v: unknown) => void))
    );
    await render({ teaser: TEASER, view: { ...VIEW, freshness: "refresh" } });
    await act(async () => header().click());
    const update = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.startsWith("Atualizar")
    )!;
    update.focus();
    await act(async () => update.click());
    expect(openUnderdogView).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("Atualizar");
    expect(document.activeElement).toBe(region());
    await act(async () => resolve({ ok: true, view: VIEW, charged: true }));
    expect(document.activeElement?.tagName).toBe("H3");
  });

  it("recalculada com o botão suspenso: aviso de recálculo sem botão", async () => {
    await render({
      teaser: TEASER,
      view: { ...VIEW, freshness: "recalculated" },
    });
    expect(container.textContent).toContain(UNDERDOG_STALE_REFRESH);
    expect(container.textContent).not.toContain(UNDERDOG_STALE_CHANGED);
    expect(container.textContent).not.toContain("Atualizar");
  });

  it("base que não passa mais na porta: aviso sem botão", async () => {
    await render({ teaser: TEASER, view: { ...VIEW, freshness: "changed" } });
    expect(container.textContent).toContain(UNDERDOG_STALE_CHANGED);
    expect(container.textContent).not.toContain("Atualizar");
  });
});

describe("UnderdogPanel — linguagem", () => {
  it("sem linguagem de valor, casa de apostas ou 'bet' na tela", () => {
    for (const freshness of [
      "current",
      "refresh",
      "recalculated",
      "changed",
    ] as const) {
      const html = renderToStaticMarkup(
        <UnderdogPanel
          matchId={MATCH_ID}
          slot={{ teaser: TEASER, view: { ...VIEW, freshness } }}
        />
      );
      const text = html.replace(/<[^>]+>/g, " ");
      expect(containsValueLanguage(text)).toBe(false);
      expect(text).not.toMatch(/\bbet\b|\bodds?\b|\bstake\b|aposte/i);
    }
  });
});
