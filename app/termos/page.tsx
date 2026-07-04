import type { Metadata } from "next";
import Link from "next/link";

import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";

// Rota PÚBLICA estática (sem auth, sem DB) — precisa ser lida ANTES do login (linkada
// no /signin e no footer). Liberada no matcher do middleware (`termos$`). Conteúdo de
// docs/ops/05-legal-compliance.md §5. Versão forward-only: bump a data ao mudar o texto.
export const dynamic = "force-static";

const LAST_UPDATED = "4 de julho de 2026";

export const metadata: Metadata = {
  title: "Termos de Uso",
  description:
    "Termos de Uso do Palpiteiro — ferramenta informativa de análise de futebol. Não é casa de apostas, não aceita dinheiro e não garante resultado.",
  alternates: { canonical: "/termos" },
};

export default function TermosPage() {
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
          Termos de Uso
        </h1>
        <p className="mt-2 text-body-sm text-muted-fg-2 tracking-tight">
          Última atualização: {LAST_UPDATED}
        </p>

        <div className="mt-10 flex flex-col gap-8 text-body leading-relaxed text-muted-foreground tracking-tight">
          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">1. O que o Palpiteiro é</h2>
            <p>
              O Palpiteiro é uma <strong className="font-medium text-foreground">ferramenta
              informativa e educacional</strong> de análise de partidas de futebol. Usa
              inteligência artificial e dados públicos (estatísticas, cotações de referência)
              para gerar palpites e análises por mercado, com o racional por trás de cada um.
            </p>
            <p>
              O Palpiteiro <strong className="font-medium text-foreground">não é uma casa de
              apostas</strong> e não realiza nenhuma das atividades de um operador:
            </p>
            <ul className="ml-4 flex list-disc flex-col gap-1.5">
              <li>não aceita depósito, saldo ou dinheiro real;</li>
              <li>não processa pagamento nem paga prêmio;</li>
              <li>não recebe, casa nem segura apostas;</li>
              <li>não garante resultado, acerto ou lucro.</li>
            </ul>
            <p>
              Qualquer aposta é feita por você, por sua conta, fora do Palpiteiro, numa casa
              autorizada. O valor mostrado no app (yield, retorno) é sempre{" "}
              <strong className="font-medium text-foreground">hipotético</strong>, para fins de
              acompanhamento.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">2. Sem garantia de resultado</h2>
            <p>
              As análises e palpites são opinião analítica baseada em dados e IA. Podem estar
              erradas. Desempenho passado não garante desempenho futuro. Você é o único
              responsável por qualquer decisão de aposta e assume integralmente o risco.{" "}
              <strong className="font-medium text-foreground">Aposta não é investimento.</strong>
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">3. Limitação de responsabilidade</h2>
            <p>
              O Palpiteiro não se responsabiliza por perdas, danos ou prejuízos decorrentes de
              apostas feitas por você fora do app, nem por indisponibilidades, erros de dados de
              terceiros ou falhas dos modelos de IA. O serviço é oferecido “como está”.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">4. Maioridade (18+)</h2>
            <p>
              O serviço é destinado exclusivamente a maiores de 18 anos. Ao acessar, você declara
              ter 18 anos ou mais. Conteúdo sobre apostas não é adequado a menores.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">5. Inteligência artificial</h2>
            <p>
              As análises são geradas por modelos de IA (entre eles o Claude, da Anthropic) e
              podem conter erros ou imprecisões. Nada aqui é conselho financeiro, de investimento
              ou recomendação personalizada de aposta.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">6. Conduta e acesso</h2>
            <p>
              O acesso pode exigir cadastro. É proibido abusar do serviço, automatizar acessos ou
              tentar contornar limites. O Palpiteiro pode suspender ou revogar o acesso a qualquer
              momento, especialmente em caso de abuso.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">7. Jogo responsável</h2>
            <p>
              Aposte com responsabilidade, apenas o que você pode perder, e nunca para recuperar
              perdas. Se a aposta deixou de ser diversão, procure ajuda:{" "}
              <a
                href="https://www.cvv.org.br"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-sm text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                CVV — 188
              </a>{" "}
              e{" "}
              <a
                href="https://jogadoresanonimos.com.br"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-sm text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                Jogadores Anônimos
              </a>
              .
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">8. Alterações</h2>
            <p>
              O Palpiteiro pode alterar o serviço e estes Termos a qualquer momento. Mudanças
              materiais serão refletidas na data de “Última atualização” acima. O uso continuado
              após uma mudança significa concordância com a versão vigente.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">9. Contato</h2>
            <p>
              Dúvidas sobre estes Termos:{" "}
              <a
                href="mailto:contato@palpiteiro.live"
                className="rounded-sm text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                contato@palpiteiro.live
              </a>
              . Veja também a{" "}
              <Link
                href="/privacidade"
                className="rounded-sm text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                Política de Privacidade
              </Link>
              .
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
