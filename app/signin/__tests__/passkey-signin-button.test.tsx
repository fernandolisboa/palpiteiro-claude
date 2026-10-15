import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-auth/webauthn", () => ({ signIn: vi.fn() }));

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
});
