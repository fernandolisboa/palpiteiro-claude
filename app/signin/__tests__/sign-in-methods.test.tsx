import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// O wrapper importa as server actions (que puxam @/auth → DrizzleAdapter/Neon) e
// o PasskeySignInButton (que importa next-auth/webauthn). Mockamos ambos pra que
// o smoke de markup não exija env de DB nem a stack do WebAuthn — só queremos
// asseverar o ESTADO INICIAL (checkbox não-marcado → Google e magic link
// desabilitados). Espelha o padrão renderToStaticMarkup do repo
// (model-override-select.test.tsx): não há Testing Library/simulação de clique,
// então só o estado inicial é observável; a regra de gating em si é coberta pelo
// teste puro de can-submit.
vi.mock("../actions", () => ({
  sendMagicLink: vi.fn(),
  signInWithGoogle: vi.fn(),
}));

vi.mock("../passkey-signin-button", () => ({
  // Reflete a prop `enabled` no markup pra travar que o wrapper a propaga
  // desabilitada no estado inicial (canSubmit(false) === false).
  PasskeySignInButton: ({ enabled }: { enabled?: boolean }) => (
    <button type="button" disabled={!enabled} data-testid="passkey">
      Entrar com passkey
    </button>
  ),
}));

import { SignInMethods } from "../sign-in-methods";

describe("SignInMethods — gate de maioridade no estado inicial (#282)", () => {
  it("no estado inicial (checkbox não-marcado) os 3 métodos saem DESABILITADOS", () => {
    const markup = renderToStaticMarkup(
      <SignInMethods errorMessage={null} />,
    );

    // Conta os botões desabilitados: Google, magic link e o passkey mock — os
    // três do gate. renderToStaticMarkup emite `disabled=""` pra disabled=true.
    const disabledCount = (markup.match(/disabled=""/g) ?? []).length;
    expect(disabledCount).toBeGreaterThanOrEqual(3);

    // Sanidade: os três rótulos de método estão presentes.
    expect(markup).toContain("Entrar com Google");
    expect(markup).toContain("Enviar link de acesso");
    expect(markup).toContain("Entrar com passkey");
    // E o checkbox de maioridade com o texto da auto-declaração.
    expect(markup).toContain("Declaro ter 18 anos ou mais");
  });

  it("renderiza a mensagem de erro mapeada quando recebida via prop", () => {
    const markup = renderToStaticMarkup(
      <SignInMethods errorMessage="Informe um e-mail." />,
    );
    expect(markup).toContain("Informe um e-mail.");
  });

  it("não renderiza bloco de erro quando errorMessage é null", () => {
    const markup = renderToStaticMarkup(
      <SignInMethods errorMessage={null} />,
    );
    expect(markup).not.toContain("text-destructive");
  });
});
