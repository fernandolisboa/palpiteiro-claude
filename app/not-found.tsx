import type { Metadata } from "next";
import { connection } from "next/server";

import { AppShell } from "@/components/app-shell";
import { NotFoundContent } from "@/app/not-found-content";

// 404 próprio em português (#574 linha 12). Renderizado POR REQUISIÇÃO: o middleware
// manda CSP com nonce + 'strict-dynamic' pras rotas gateadas, e um 404 estático (sem
// nonce no HTML) ficava sem JS — sem menu da conta e com o tema errado. O
// `connection()` deixa o render dinâmico explícito (o AppShell já leria a sessão);
// scripts/check-csp-prerender.ts derruba o build se o /_not-found voltar a ser estático.
// O Next já põe `noindex` na resposta 404.
export const metadata: Metadata = { title: "Página não encontrada" };

export default async function NotFound() {
  await connection();
  return (
    <AppShell>
      <NotFoundContent />
    </AppShell>
  );
}
