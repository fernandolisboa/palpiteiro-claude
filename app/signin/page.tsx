import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type PageProps = {
  searchParams: Promise<{ error?: string; sent?: string }>;
};

async function sendMagicLink(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!email) redirect("/signin?error=MissingEmail");
  // signIn redireciona internamente: sucesso → verifyRequest; e-mail fora da
  // whitelist → AccessDenied (o callback signIn roda ANTES do envio, então
  // nenhum e-mail/token é gerado). Não capturar — é um redirect do Next.
  await signIn("resend", { email, redirectTo: "/" });
}

export default async function SignInPage({ searchParams }: PageProps) {
  const session = await auth();
  if (session?.user) redirect("/");

  const { error } = await searchParams;
  const message =
    error === "AccessDenied"
      ? "Este e-mail não está autorizado. Fale com o admin pra entrar na whitelist."
      : error === "MissingEmail"
        ? "Informe um e-mail."
        : error
          ? "Não foi possível enviar o link. Tente novamente."
          : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-5 text-foreground">
      <div className="flex w-full max-w-[380px] flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline gap-2">
            <span className="text-[20px] font-semibold tracking-[-0.04em]">
              palpiteiro
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-fg-2">
              · over/under 2.5
            </span>
          </div>
          <p className="text-[13px] text-muted-foreground tracking-tight">
            Entre com seu e-mail — enviamos um link de acesso.
          </p>
        </div>

        <Card className="p-5">
          <form action={sendMagicLink} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
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
            <Button type="submit" className="w-full">
              Enviar link de acesso
            </Button>
            {message && (
              <p className="text-[12.5px] text-destructive tracking-tight">
                {message}
              </p>
            )}
          </form>
        </Card>

        <p className="text-[11.5px] text-muted-fg-2 tracking-tight">
          Acesso restrito a e-mails autorizados. O link pode cair na pasta de
          spam no primeiro envio.
        </p>
      </div>
    </div>
  );
}
