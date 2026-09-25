import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A action real é server-only; aqui ela só confirma o save.
vi.mock("@/app/actions/ai-config", () => ({
  updateAdminFlag: vi.fn(async () => ({ ok: true })),
}));

import { AdminFlagControl } from "@/app/admin/settings/admin-flag-control";
import { getAdminFlagDef } from "@/lib/config/admin-flags";

// Regressão: o React 19 reseta o <form> depois da action e o <select> voltava pro
// valor da MONTAGEM ("LLM (atual)") mesmo com o servidor já devolvendo o novo.
describe("AdminFlagControl (enum) — select depois de salvar", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("mostra o valor salvo, não o da montagem", async () => {
    const flag = getAdminFlagDef("analysisEngine");
    act(() => root.render(<AdminFlagControl flag={flag} current="llm" />));

    const select = () => container.querySelector("select") as HTMLSelectElement;
    select().value = "code_jev";
    await act(async () => {
      (container.querySelector("form") as HTMLFormElement).requestSubmit();
    });

    // O servidor revalida e devolve o valor persistido.
    await act(async () => {
      root.render(<AdminFlagControl flag={flag} current="code_jev" />);
    });

    expect(select().value).toBe("code_jev");
  });
});
