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
  // Reflete as props `enabled`, `email` e `describedBy` no markup pra travar que o
  // wrapper as propaga (canSubmit(false) === false no estado inicial).
  PasskeySignInButton: ({
    enabled,
    email,
    describedBy,
  }: {
    enabled?: boolean;
    email: string;
    describedBy?: string;
  }) => (
    <button
      type="button"
      disabled={!enabled}
      data-testid="passkey"
      data-email={email}
      aria-describedby={describedBy}
    >
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
    expect(markup).toContain("Continuar com o Google");
    expect(markup).toContain("Enviar link de acesso");
    expect(markup).toContain("Entrar com passkey");
    // E o checkbox de maioridade com o texto da auto-declaração.
    expect(markup).toContain("Declaro ter 18 anos ou mais");
  });

  it("o checkbox é clickwrap explícito dos Termos, com links legais ao lado (ADR 0047)", () => {
    const markup = renderToStaticMarkup(
      <SignInMethods errorMessage={null} />,
    );
    expect(markup).toContain(
      "Declaro ter 18 anos ou mais e aceito os Termos de Uso.",
    );
    expect(markup).toContain('href="/termos"');
    expect(markup).toContain('href="/privacidade"');
    // Links FORA do <label>: abrir os Termos não pode marcar o checkbox.
    expect(markup.indexOf("</label>")).toBeLessThan(
      markup.indexOf('href="/termos"'),
    );
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

describe("SignInMethods — um campo de e-mail, frase do bloqueio e o \"G\" (#579)", () => {
  const markup = renderToStaticMarkup(<SignInMethods errorMessage={null} />);

  it("tem um campo de e-mail só, o do link, com name=\"email\"", () => {
    expect((markup.match(/type="email"/g) ?? []).length).toBe(1);
    expect(markup).toMatch(/<input[^>]*type="email"[^>]*name="email"/);
    expect(markup).toContain('data-email=""');
  });

  it("a passkey fica DENTRO do form do link, depois do submit, e não submete", () => {
    const magicForm = markup.slice(markup.lastIndexOf("<form"));
    const formHtml = magicForm.slice(0, magicForm.indexOf("</form>"));
    const submit = formHtml.indexOf("Enviar link de acesso");
    const passkey = formHtml.indexOf('data-testid="passkey"');
    expect(submit).toBeGreaterThan(-1);
    expect(passkey).toBeGreaterThan(submit);
    expect(formHtml).toMatch(/<button type="button"[^>]*data-testid="passkey"/);
  });

  it("no estado inicial mostra a frase do bloqueio e liga os botões a ela", () => {
    expect(markup).toContain("Marque a caixa acima para entrar.");
    expect(markup).toContain('id="signin-gate-hint"');
    expect((markup.match(/aria-describedby="signin-gate-hint"/g) ?? []).length).toBe(3);
  });

  it("o botão do Google traz o \"G\" oficial: 18px por classe, decorativo, sem style", () => {
    const googleForm = markup.slice(markup.indexOf("<form"), markup.indexOf("</form>"));
    const svg = googleForm.slice(googleForm.indexOf("<svg"), googleForm.indexOf("</svg>"));
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toMatch(/class="[^"]*\bsize-4\.5\b/);
    expect(svg).not.toContain("style=");
    for (const fill of ["#EA4335", "#4285F4", "#FBBC05", "#34A853"]) {
      expect(svg).toContain(`fill="${fill}"`);
    }
    expect(googleForm).toContain("bg-white");
  });
});
