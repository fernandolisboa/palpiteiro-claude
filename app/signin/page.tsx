import { redirect } from "next/navigation";

import { auth } from "@/auth";

import { SignInMethods } from "./sign-in-methods";

type PageProps = {
  searchParams: Promise<{ error?: string; sent?: string }>;
};

export default async function SignInPage({ searchParams }: PageProps) {
  const session = await auth();
  if (session?.user) redirect("/");

  const { error } = await searchParams;
  const message =
    error === "AccessDenied"
      ? "Não foi possível entrar com este e-mail. Se o problema persistir, fale com o admin."
      : error === "RateLimited"
        ? "Muitos pedidos de link. Aguarde alguns minutos e tente de novo."
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
            Entre com sua conta Google, com uma passkey ou com um link por
            e-mail.
          </p>
        </div>

        {/* O checkbox obrigatório 18+ e o gating dos 3 métodos vivem no wrapper
            CLIENT (#282). A leitura de searchParams e o mapeamento de erro PT
            ficam aqui no Server Component; a mensagem já-mapeada desce como prop. */}
        <SignInMethods errorMessage={message} />
      </div>
    </div>
  );
}
