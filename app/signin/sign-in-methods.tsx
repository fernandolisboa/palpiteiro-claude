"use client";

import { useState } from "react";
import { Checkbox } from "radix-ui";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { canSubmit } from "./can-submit";
import { sendMagicLink, signInWithGoogle } from "./actions";
import { PasskeySignInButton } from "./passkey-signin-button";

/**
 * Wrapper CLIENT do /signin (#282): detém o estado do checkbox obrigatório de
 * maioridade ("Declaro ter 18 anos ou mais") e GATEIA os três métodos de login
 * — os botões de Google e magic link e o PasskeySignInButton ficam desabilitados
 * até o checkbox ser marcado (`canSubmit(accepted)`). As server actions (Google,
 * magic link) vivem em `./actions` ("use server") pra serem importáveis aqui; o
 * `errorMessage` já-mapeado vem do Server Component (a leitura de searchParams +
 * o mapeamento de erro PT continuam server-side em page.tsx).
 *
 * Natureza: auto-declaração (gate de UI), não enforcement server-side. A
 * auditoria do consentimento é o `accepted_terms_at` carimbado em
 * `events.createUser` (auth.ts) — a row do usuário só nasce depois daqui.
 */
export function SignInMethods({
  errorMessage,
}: {
  errorMessage: string | null;
}) {
  const [accepted, setAccepted] = useState(false);
  const enabled = canSubmit(accepted);

  return (
    <div className="flex flex-col gap-6">
      {/* Gate de maioridade: destrava os três métodos. TODO(go-live): quando
          /termos e /privacidade existirem (ADR/ops 05), estender o texto para
          "Declaro ter 18 anos ou mais e aceito os Termos e a Política de
          Privacidade" com links. Por ora SÓ a auto-declaração 18+. */}
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
          Declaro ter 18 anos ou mais.
        </span>
      </label>

      <form action={signInWithGoogle}>
        <Button
          type="submit"
          variant="outline"
          className="w-full"
          disabled={!enabled}
        >
          Entrar com Google
        </Button>
      </form>

      <PasskeySignInButton enabled={enabled} />

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="font-mono text-eyebrow uppercase tracking-label text-muted-fg-2">
          ou
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <Card className="p-5">
        <form action={sendMagicLink} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
              e-mail
            </span>
            <Input
              type="email"
              name="email"
              required
              autoComplete="email"
              placeholder="voce@exemplo.com"
            />
          </label>
          <Button type="submit" className="w-full" disabled={!enabled}>
            Enviar link de acesso
          </Button>
          {errorMessage && (
            <p className="text-body-sm text-destructive tracking-tight">
              {errorMessage}
            </p>
          )}
        </form>
      </Card>

      <p className="text-meta text-muted-fg-2 tracking-tight">
        Qualquer e-mail pode entrar. O link pode cair na pasta de spam no
        primeiro envio.
      </p>
    </div>
  );
}
