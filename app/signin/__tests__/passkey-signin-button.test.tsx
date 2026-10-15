import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-auth/webauthn", () => ({ signIn: vi.fn() }));

import { signIn } from "next-auth/webauthn";

import { PasskeySignInButton } from "../passkey-signin-button";

// Sem harness de clique no repo: trava o estado do botão no markup e, por guarda de
// fonte, a normalização do e-mail no clique (R4 do PLAN-579).
function render(props: { email: string; enabled?: boolean }) {
  return renderToStaticMarkup(<PasskeySignInButton {...props} />);
}

describe("PasskeySignInButton (#579)", () => {
  it("sem e-mail, ou só com espaços, sai desabilitado", () => {
    expect(render({ email: "", enabled: true })).toContain('disabled=""');
    expect(render({ email: "   ", enabled: true })).toContain('disabled=""');
  });

  it("com e-mail e o gate liberado, habilitado", () => {
    expect(render({ email: "a@b.com", enabled: true })).not.toContain('disabled=""');
  });

  it("com e-mail mas sem o 18+ marcado, desabilitado", () => {
    expect(render({ email: "a@b.com", enabled: false })).toContain('disabled=""');
  });

  it("não tem campo próprio e não submete o form em volta", () => {
    const html = render({ email: "a@b.com" });
    expect(html).not.toContain("<input");
    expect(html).toMatch(/<button[^>]*type="button"/);
  });

  it("normaliza o e-mail no clique como o link (trim + minúsculas)", () => {
    const src = readFileSync(
      join(process.cwd(), "app/signin/passkey-signin-button.tsx"),
      "utf8",
    );
    expect(src).toContain("email: email.trim().toLowerCase()");
  });

  it("valida o form antes da cerimônia: e-mail mal formado não chama o signIn", async () => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const mocked = vi.mocked(signIn);
    mocked.mockResolvedValue({ ok: false, error: "x", code: undefined, status: 401, url: null });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const mount = (email: string) =>
      act(async () =>
        root.render(
          <form>
            <input type="email" required defaultValue={email} />
            <PasskeySignInButton email={email} />
          </form>,
        ),
      );
    const click = () =>
      act(async () => container.querySelector("button")!.click());

    await mount("abc");
    await click();
    expect(mocked).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    const root2 = createRoot(container);
    await act(async () =>
      root2.render(
        <form>
          <input type="email" required defaultValue="Fulano@X.com" />
          <PasskeySignInButton email="Fulano@X.com" />
        </form>,
      ),
    );
    await click();
    expect(mocked).toHaveBeenCalledWith(
      "passkey",
      expect.objectContaining({ email: "fulano@x.com" }),
    );
    await act(async () => root2.unmount());
    container.remove();
  });
});
