import type { Metadata } from "next";
import Link from "next/link";

import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";
import { LEGAL_CONTACT_EMAIL, controllerIdentification } from "@/lib/legal/controller";

// Rota PÚBLICA estática (sem auth, sem DB) — precisa ser lida ANTES do login (linkada
// no /signin e no footer). Liberada no matcher do middleware (`termos$`). Conteúdo
// revisado em docs/reports/11-revisao-legal.md; aceite explícito (clickwrap) no ADR 0040;
// envelope não-operador / sem vínculo com casa de apostas no ADR 0041. Versão
// forward-only: bump a data ao mudar o texto material.
export const dynamic = "force-static";

const LAST_UPDATED = "24 de setembro de 2026";

export const metadata: Metadata = {
  title: "Termos de Uso",
  description:
    "Termos de Uso do Palpiteiro — ferramenta informativa de análise de futebol. Não é casa de apostas, não aceita dinheiro e não garante resultado.",
  alternates: { canonical: "/termos" },
};

const linkClass =
  "rounded-sm text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

function Strong({ children }: { children: React.ReactNode }) {
  return <strong className="font-medium text-foreground">{children}</strong>;
}

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
              O Palpiteiro é uma <Strong>ferramenta informativa e educacional</Strong> de análise
              de partidas de futebol. Usa inteligência artificial e dados públicos (estatísticas,
              cotações de referência, notícias) para gerar palpites e análises por mercado, com o
              racional por trás de cada um.
            </p>
            <p>
              O Palpiteiro <Strong>não é uma casa de apostas</Strong> e não realiza nenhuma das
              atividades de um operador:
            </p>
            <ul className="ml-4 flex list-disc flex-col gap-1.5">
              <li>não aceita depósito, saldo ou dinheiro real;</li>
              <li>não processa pagamento nem paga prêmio;</li>
              <li>não recebe, casa nem segura apostas;</li>
              <li>não garante resultado, acerto ou lucro.</li>
            </ul>
            <p>
              Qualquer aposta é feita por você, por sua conta, fora do Palpiteiro. Se decidir
              apostar, use apenas casas autorizadas pelo Ministério da Fazenda (sites com final{" "}
              <Strong>.bet.br</Strong>). O dinheiro mostrado no app (unidades, yield, retorno) é
              sempre <Strong>hipotético</Strong>, para fins de acompanhamento.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">2. Quem oferece o serviço</h2>
            <p>
              O Palpiteiro é mantido por {controllerIdentification()}. O serviço é gratuito: não
              há cobrança, anúncio ou comissão. Contato:{" "}
              <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className={linkClass}>
                {LEGAL_CONTACT_EMAIL}
              </a>
              .
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">3. Aceite</h2>
            <p>
              Para criar a conta, você marca a caixa em que declara ter 18 anos ou mais e aceita
              estes Termos. Guardamos a data desse aceite. Se não concordar com estes Termos, não
              use o Palpiteiro. O tratamento dos seus dados está descrito na{" "}
              <Link href="/privacidade" className={linkClass}>
                Política de Privacidade
              </Link>
              .
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">4. Sem garantia de resultado</h2>
            <p>
              As análises e palpites são opinião analítica baseada em dados e IA. Podem estar
              erradas. Desempenho passado não garante desempenho futuro. Você é o único
              responsável por qualquer decisão de aposta e assume integralmente o risco.{" "}
              <Strong>Aposta não é investimento</Strong> nem fonte de renda.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">5. Sem vínculo com casas de apostas</h2>
            <p>
              O Palpiteiro não tem parceria, patrocínio, afiliação nem comissão de nenhuma casa de
              apostas, não exibe publicidade de apostas e não indica casas. As cotações que
              aparecem no app são referência de mercado para a análise, não oferta de aposta;
              quando o nome de uma casa aparece junto de uma cotação, é só a fonte do dado — não
              é indicação nem convite para apostar nela.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">6. Maioridade (18+)</h2>
            <p>
              O serviço é destinado exclusivamente a maiores de 18 anos. Conteúdo sobre apostas
              não é adequado a menores, e a lei proíbe que menores de 18 anos apostem. Se
              soubermos que uma conta pertence a um menor, ela será excluída.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">7. Inteligência artificial</h2>
            <p>
              As análises são geradas por modelos de IA (entre eles o Claude, da Anthropic) e
              podem conter erros ou imprecisões, inclusive sobre escalações, desfalques e
              notícias de terceiros. Nada aqui é conselho financeiro, de investimento ou
              recomendação personalizada de aposta.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">8. Sua conta e o que você registra</h2>
            <p>
              Você é responsável pelo acesso à sua conta e pelo que registra nela, como as
              apostas descritas em texto livre — não inclua dados pessoais de outras pessoas. É
              proibido abusar do serviço, automatizar acessos ou tentar contornar limites. O
              Palpiteiro pode suspender ou revogar o acesso em caso de abuso ou de violação
              destes Termos.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">9. Jogo responsável</h2>
            <p>
              Aposte com responsabilidade, apenas o que você pode perder, e nunca para recuperar
              perdas. Se você está em autoexclusão numa casa de apostas, ou sente que perdeu o
              controle, não use o Palpiteiro. Se a aposta deixou de ser diversão, procure ajuda:{" "}
              <a
                href="https://www.cvv.org.br"
                target="_blank"
                rel="noopener noreferrer"
                className={linkClass}
              >
                CVV — 188
              </a>{" "}
              e{" "}
              <a
                href="https://jogadoresanonimos.com.br"
                target="_blank"
                rel="noopener noreferrer"
                className={linkClass}
              >
                Jogadores Anônimos
              </a>
              .
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">10. Limitação de responsabilidade</h2>
            <p>
              Na medida permitida pela lei, o Palpiteiro não se responsabiliza por perdas, danos
              ou prejuízos decorrentes de apostas feitas por você, nem por indisponibilidades,
              erros de dados de terceiros ou falhas dos modelos de IA. O serviço é oferecido
              gratuitamente e “como está”. Nada nestes Termos afasta direitos que a lei garante e
              não permite limitar.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">11. Encerramento</h2>
            <p>
              Você pode encerrar sua conta a qualquer momento, pedindo a exclusão pelo contato
              acima; o que acontece com seus dados está na{" "}
              <Link href="/privacidade" className={linkClass}>
                Política de Privacidade
              </Link>
              . O Palpiteiro pode descontinuar o serviço, avisando no app com antecedência
              razoável sempre que possível.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">12. Alterações</h2>
            <p>
              Estes Termos podem mudar. A versão em vigor é sempre a desta página, com a data de
              “Última atualização” acima, e mudanças relevantes serão avisadas no app. Se uma
              mudança reduzir seus direitos, pediremos um novo aceite antes de você continuar
              usando o serviço.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">13. Lei aplicável e foro</h2>
            <p>
              Estes Termos seguem as leis brasileiras. Qualquer disputa pode ser levada ao foro do
              seu domicílio.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">14. Contato</h2>
            <p>
              Dúvidas sobre estes Termos:{" "}
              <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className={linkClass}>
                {LEGAL_CONTACT_EMAIL}
              </a>
              . Veja também a{" "}
              <Link href="/privacidade" className={linkClass}>
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
