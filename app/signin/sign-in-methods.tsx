"use client";

import { IntentLink } from "@/components/intent-link";
import { useState } from "react";
import { Checkbox } from "radix-ui";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { canSubmit } from "./can-submit";
import { sendMagicLink, signInWithGoogle } from "./actions";
import { GoogleMark } from "./google-mark";
import { PasskeySignInButton } from "./passkey-signin-button";

const GATE_HINT_ID = "signin-gate-hint";

/**
 * Wrapper CLIENT do /signin (#282, ADR 0047): detém o estado do checkbox obrigatório
 * de maioridade + aceite dos Termos ("Declaro ter 18 anos ou mais e aceito os Termos
 * de Uso.") e GATEIA os três métodos de login
 * — os botões de Google e magic link e o PasskeySignInButton ficam desabilitados
 * até o checkbox ser marcado (`canSubmit(accepted)`). As server actions (Google,
 * magic link) vivem em `./actions` ("use server") pra serem importáveis aqui; o
 * `errorMessage` já-mapeado vem do Server Component (a leitura de searchParams +
 * o mapeamento de erro PT continuam server-side em page.tsx).
 *
 * Natureza: auto-declaração (gate de UI), não enforcement server-side. A
 * auditoria do consentimento é o `accepted_terms_at` carimbado em
 * `events.createUser` (auth.ts) — a row do usuário só nasce depois daqui.
 *
 * Um campo de e-mail só (#579): serve ao link e à passkey. O estado sobe pra cá e o
 * PasskeySignInButton recebe `email`. Ordem no form, load-bearing: "Enviar link de
 * acesso" (submit) vem antes da passkey (`type="button"`), então o Enter no campo
 * envia o link e, com a caixa desmarcada, o submit padrão desabilitado bloqueia a
 * submissão implícita. Enquanto a caixa não está marcada, uma frase diz por que os
 * botões estão desabilitados.
 */
export function SignInMethods({
  errorMessage,
}: {
  errorMessage: string | null;
}) {
  const [accepted, setAccepted] = useState(false);
  const [email, setEmail] = useState("");
  const enabled = canSubmit(accepted);
  const describedBy = enabled ? undefined : GATE_HINT_ID;

  return (
    <div className="flex flex-col gap-6">
      {/* Clickwrap (ADR 0047): UM checkbox obrigatório = declaração 18+ E aceite
          EXPLÍCITO dos Termos de Uso (contrato). A Política de Privacidade é
          INFORMADA, não "aceita" — a base legal do tratamento é execução de contrato
          (LGPD art. 7º, V), não consentimento; por isso ela aparece como leitura
          ao lado, não dentro da frase de aceite. Os links vivem FORA do <label> que
          toggla o checkbox de propósito (abrir a página não deve marcar o checkbox) e
          abrem em nova aba pra não perder o estado do /signin. A prova do aceite é o
          accepted_terms_at (events.createUser) + a data forward-only de /termos. */}
      <div className="flex flex-col gap-2">
        <label className="flex cursor-pointer items-start gap-2.5">
          <Checkbox.Root
            checked={accepted}
            onCheckedChange={(v) => setAccepted(v === true)}
            className={cn(
              "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border border-input bg-transparent shadow-xs outline-none transition-colors",
              "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
              "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
            )}
          >
            <Checkbox.Indicator>
              <Check className="size-3" strokeWidth={3} />
            </Checkbox.Indicator>
          </Checkbox.Root>
          <span className="text-body-sm leading-snug tracking-tight text-muted-foreground">
            Declaro ter 18 anos ou mais e aceito os Termos de Uso.
          </span>
        </label>
        <p className="pl-[26px] text-meta leading-snug tracking-tight text-muted-foreground">
          Leia os{" "}
          <IntentLink
            href="/termos"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            Termos de Uso
          </IntentLink>{" "}
          e a{" "}
          <IntentLink
            href="/privacidade"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            Política de Privacidade
          </IntentLink>
          , que explica como tratamos seus dados.
        </p>
      </div>

      {!enabled && (
        <p id={GATE_HINT_ID} className="text-body-sm tracking-tight text-muted-foreground">
          Marque a caixa acima para entrar. O Palpiteiro é só para maiores de 18 anos.
        </p>
      )}

      <form action={signInWithGoogle}>
        <Button
          type="submit"
          variant="outline"
          className="w-full gap-2.5 px-3 text-label font-medium"
          disabled={!enabled}
          aria-describedby={describedBy}
        >
          <GoogleMark />
          Continuar com o Google
        </Button>
      </form>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-meta uppercase tracking-label text-muted-foreground">
          ou com seu e-mail
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <form action={sendMagicLink} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-meta uppercase tracking-label text-muted-foreground">
            e-mail
          </span>
          <Input
            type="email"
            name="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            // O mesmo valor do campo de passkey de antes e do `formFields` do provider.
            autoComplete="username webauthn"
            placeholder="voce@exemplo.com"
          />
        </label>
        {/* Submit padrão do form: tem de vir ANTES da passkey (ver o comentário do topo). */}
        <Button
          type="submit"
          className="w-full"
          disabled={!enabled}
          aria-describedby={describedBy}
        >
          Enviar link de acesso
        </Button>
        <PasskeySignInButton email={email} enabled={enabled} describedBy={describedBy} />
        {errorMessage && (
          <p role="alert" className="text-body-sm text-destructive tracking-tight">
            {errorMessage}
          </p>
        )}
      </form>

      <div className="flex flex-col gap-1.5 text-meta text-muted-foreground tracking-tight">
        <p>
          Qualquer e-mail pode entrar. O link pode cair na pasta de spam no
          primeiro envio.
        </p>
        <p>
          A passkey usa a biometria ou o PIN deste aparelho; cadastre uma no seu
          perfil depois de entrar.
        </p>
      </div>
    </div>
  );
}
