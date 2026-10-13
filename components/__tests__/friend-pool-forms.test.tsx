import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// Actions "use server" mockadas: o teste prova o comportamento do form com o reset
// automático do React 19 (erro mantém o que foi digitado; sucesso volta pro padrão).
vi.mock("@/app/actions/friend-pools", () => ({
  addFriendPoolEntry: vi.fn(),
  createFriendPool: vi.fn(),
  setFriendPoolScore: vi.fn(),
}));

import { addFriendPoolEntry, setFriendPoolScore } from "@/app/actions/friend-pools";
import { AddEntryForm, ManualScoreForm } from "@/components/friend-pool-forms";

const POOL = "11111111-1111-1111-1111-111111111111";

async function mount() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<AddEntryForm poolId={POOL} homeTeam="Flamengo" awayTeam="Palmeiras" />);
  });
  const form = container.querySelector("form")!;
  const name = container.querySelector<HTMLInputElement>('input[name="bettorName"]')!;
  const kind = container.querySelector<HTMLSelectElement>('select[name="kind"]')!;
  return { container, root, form, name, kind };
}

async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.requestSubmit();
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.mocked(addFriendPoolEntry).mockReset();
  vi.mocked(setFriendPoolScore).mockReset();
});

describe("AddEntryForm", () => {
  it("envia nome, tipo e seleção", async () => {
    vi.mocked(addFriendPoolEntry).mockResolvedValue({ ok: true });
    const { container, form, name, kind, root } = await mount();
    name.value = "Ana";
    await choose(kind, "btts");
    const pick = container.querySelector<HTMLSelectElement>('select[name="pick"]')!;
    await choose(pick, "yes");
    await submit(form);

    const fd = vi.mocked(addFriendPoolEntry).mock.calls[0]![1];
    expect(fd.get("poolId")).toBe(POOL);
    expect(fd.get("bettorName")).toBe("Ana");
    expect(fd.get("kind")).toBe("btts");
    expect(fd.get("pick")).toBe("yes");
    await act(async () => root.unmount());
  });

  it("depois de anotar, o tipo e os campos voltam pro placar exato", async () => {
    vi.mocked(addFriendPoolEntry).mockResolvedValue({ ok: true });
    const { container, form, name, kind, root } = await mount();
    name.value = "Ana";
    await choose(kind, "btts");
    await choose(container.querySelector<HTMLSelectElement>('select[name="pick"]')!, "no");
    await submit(form);

    expect(name.value).toBe("");
    expect(kind.value).toBe("exact_score");
    expect(container.querySelector('input[name="home"]')).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("em erro, mantém o que foi digitado e mostra a mensagem", async () => {
    vi.mocked(addFriendPoolEntry).mockResolvedValue({ ok: false, error: "O jogo já começou." });
    const { container, form, name, kind, root } = await mount();
    name.value = "Bia";
    await choose(kind, "match_result");
    await choose(container.querySelector<HTMLSelectElement>('select[name="pick"]')!, "draw");
    await submit(form);

    expect(container.textContent).toContain("O jogo já começou.");
    expect(name.value).toBe("Bia");
    expect(kind.value).toBe("match_result");
    expect(container.querySelector<HTMLSelectElement>('select[name="pick"]')!.value).toBe("draw");
    await act(async () => root.unmount());
  });
});

describe("ManualScoreForm", () => {
  it("o botão clicado manda o intent (usar placar vs voltar pro do jogo)", async () => {
    vi.mocked(setFriendPoolScore).mockResolvedValue({ ok: true });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ManualScoreForm poolId={POOL} homeTeam="Flamengo" awayTeam="Palmeiras" manual={{ home: 1, away: 0 }} />,
      );
    });
    const buttons = Array.from(container.querySelectorAll("button"));
    const clear = buttons.find((b) => b.textContent?.includes("Voltar pro placar do jogo"))!;
    await act(async () => {
      clear.click();
    });
    const fd = vi.mocked(setFriendPoolScore).mock.calls[0]![1];
    expect(fd.get("intent")).toBe("clear");
    expect(fd.get("poolId")).toBe(POOL);
    await act(async () => root.unmount());
  });
});
