import { NextResponse } from "next/server";

// Rota pública e sem gate (o matcher do middleware exclui /api/*). Devolve o
// commit SHA do deploy VIVO pra o cliente detectar uma versão nova (ADR 0024).
// O SHA é info de baixo risco (#260). `force-dynamic` garante leitura por
// request (env do deploy ativo), nunca um valor cacheado em build; `no-store`
// impede qualquer cache intermediário entre o cliente e o deploy.
export const dynamic = "force-dynamic";

export function GET(): Response {
  return NextResponse.json(
    { sha: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
