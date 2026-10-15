import type { Metadata } from "next";

import { AppShell } from "@/components/app-shell";
import { PageContainer } from "@/components/page-container";

import { ComoFuncionaContent } from "./como-funciona-content";

export const metadata: Metadata = {
  // `absolute` opta o título fora do `template: "%s · Palpiteiro"` do root — a
  // string já carrega a marca, então o template duplicaria (" · Palpiteiro").
  title: { absolute: "Como funciona · Palpiteiro" },
  description:
    'Como o Palpiteiro funciona: o palpite da IA, o modelo de placar (Dixon-Coles), os mercados, a vantagem e o "sem aposta", Suas apostas e o bolão entre amigos. Com glossário.',
  alternates: { canonical: "/como-funciona" },
};

/**
 * Página pública `/como-funciona` (sem login; fora do matcher do middleware). O
 * conteúdo é idêntico pra todos; só o header muda: o `AppShell` lê a sessão e mostra
 * o menu completo pra quem está logado (a página é item do menu "ajuda", #553) ou só
 * marca + tema + "entrar" pra quem não está. Ler a sessão torna a página dinâmica; a
 * CSP pública (`'unsafe-inline'`, sem nonce) não depende disso.
 *
 * O corpo vive em `ComoFuncionaContent` (síncrono) pra que o teste de contrato
 * consiga `renderToStaticMarkup` sem aguardar Server Component async.
 */
export default function ComoFuncionaPage() {
  return (
    <AppShell>
      <PageContainer width="reading">
        <ComoFuncionaContent />
      </PageContainer>
    </AppShell>
  );
}
