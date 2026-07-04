import type { Metadata } from "next";
import Link from "next/link";

import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";

// Rota PÚBLICA estática (sem auth, sem DB) — lida ANTES do login. Liberada no matcher do
// middleware (`privacidade$`). Conteúdo de docs/ops/05-legal-compliance.md §4 (LGPD).
// A lista de sub-operadores reflete o que o CÓDIGO realmente usa hoje (inclui Sentry;
// OpenAI é condicional à key, ADR 0027). Versão forward-only: bump a data ao mudar o texto.
export const dynamic = "force-static";

const LAST_UPDATED = "4 de julho de 2026";

export const metadata: Metadata = {
  title: "Política de Privacidade",
  description:
    "Política de Privacidade do Palpiteiro — quais dados coletamos, para quê, com quem tratamos e seus direitos sob a LGPD.",
  alternates: { canonical: "/privacidade" },
};

export default function PrivacidadePage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex h-14 items-center justify-between border-b border-border-subtle px-6">
        <Link href="/" className="rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <Wordmark />
        </Link>
        <ThemeToggle />
      </header>

      <main className="mx-auto w-full max-w-reading px-6 py-12 sm:py-16">
        <p className="font-mono text-eyebrow uppercase tracking-eyebrow text-muted-fg-2">
          Documento legal
        </p>
        <h1 className="mt-3 text-display-md font-medium tracking-tight sm:text-display-lg">
          Política de Privacidade
        </h1>
        <p className="mt-2 text-body-sm text-muted-fg-2 tracking-tight">
          Última atualização: {LAST_UPDATED}
        </p>

        <div className="mt-10 flex flex-col gap-8 text-body leading-relaxed text-muted-foreground tracking-tight">
          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">1. Controlador e contato</h2>
            <p>
              O Palpiteiro é um projeto pessoal mantido por seu responsável, que atua como{" "}
              <strong className="font-medium text-foreground">controlador</strong> dos dados sob a{" "}
              <a
                href="https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-sm text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                LGPD (Lei nº 13.709/2018)
              </a>
              . Contato para assuntos de privacidade:{" "}
              <a
                href="mailto:contato@palpiteiro.live"
                className="rounded-sm text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                contato@palpiteiro.live
              </a>
              .
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">2. Dados que coletamos</h2>
            <ul className="ml-4 flex list-disc flex-col gap-1.5">
              <li>
                <strong className="font-medium text-foreground">Dados de conta:</strong> e-mail
                (autenticação por magic link) e, se você entrar com Google, o nome e a imagem de
                perfil fornecidos por esse login.
              </li>
              <li>
                <strong className="font-medium text-foreground">Dados de uso:</strong> as análises
                e palpites que você gera, seu histórico e resultados.
              </li>
              <li>
                <strong className="font-medium text-foreground">Logs técnicos:</strong> registros de
                acesso e de custo de IA por usuário, para operar e controlar o serviço.
              </li>
            </ul>
            <p>
              Coletamos apenas o necessário (princípio da minimização). Não coletamos dados
              sensíveis e não pedimos documentos.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">3. Para que usamos</h2>
            <p>
              Para autenticar seu acesso, operar o app (gerar e guardar análises, palpites e
              acompanhamento), e controlar custo e uso (limite diário, alerta de gasto). Não
              fazemos marketing com seus dados e não vendemos dados a ninguém.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">4. Base legal</h2>
            <p>
              O tratamento se apoia na <strong className="font-medium text-foreground">execução do
              serviço</strong> que você solicita ao se cadastrar e usar o app, e no seu{" "}
              <strong className="font-medium text-foreground">consentimento</strong> ao criar a
              conta.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">5. Com quem tratamos (sub-operadores)</h2>
            <p>Terceiros que processam dados para operar o Palpiteiro:</p>
            <ul className="ml-4 flex list-disc flex-col gap-1.5">
              <li><strong className="font-medium text-foreground">Vercel</strong> — hospedagem e logs;</li>
              <li><strong className="font-medium text-foreground">Neon</strong> — banco de dados;</li>
              <li><strong className="font-medium text-foreground">Resend</strong> — envio de e-mail (magic link);</li>
              <li><strong className="font-medium text-foreground">Anthropic</strong> — geração de texto das análises;</li>
              <li><strong className="font-medium text-foreground">Upstash / Vercel KV</strong> — limite de uso (rate limit);</li>
              <li><strong className="font-medium text-foreground">Sentry</strong> — monitoramento de erros;</li>
              <li><strong className="font-medium text-foreground">OpenAI</strong> — geração de texto (uso condicional, apenas quando habilitado).</li>
            </ul>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">6. Transferência internacional</h2>
            <p>
              Os provedores acima podem tratar dados fora do Brasil. A LGPD permite essa
              transferência; ela ocorre para viabilizar o funcionamento do serviço.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">7. Retenção</h2>
            <p>
              Guardamos seus dados enquanto sua conta existir. Logs técnicos podem ser mantidos
              por período limitado conforme a política de cada provedor. Ao excluir a conta,
              removemos ou anonimizamos os dados associados.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">8. Seus direitos</h2>
            <p>
              Você pode solicitar acesso, correção, exclusão, portabilidade e revogação de
              consentimento sobre seus dados. Para exercer qualquer direito — inclusive a{" "}
              <strong className="font-medium text-foreground">exclusão da sua conta e dados</strong>{" "}
              — escreva para{" "}
              <a
                href="mailto:contato@palpiteiro.live"
                className="rounded-sm text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                contato@palpiteiro.live
              </a>
              . O histórico pode ser mantido de forma anônima (desidentificada).
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">9. Contato</h2>
            <p>
              Dúvidas sobre esta Política:{" "}
              <a
                href="mailto:contato@palpiteiro.live"
                className="rounded-sm text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                contato@palpiteiro.live
              </a>
              . Veja também os{" "}
              <Link
                href="/termos"
                className="rounded-sm text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                Termos de Uso
              </Link>
              .
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
