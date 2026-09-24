import type { Metadata } from "next";
import Link from "next/link";

import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";
import {
  DATA_REQUEST_RESPONSE_DAYS,
  LEGAL_CONTACT_EMAIL,
  controllerIdentification,
} from "@/lib/legal/controller";

// Rota PÚBLICA estática (sem auth, sem DB) — lida ANTES do login. Liberada no matcher do
// middleware (`privacidade$`). Conteúdo aterrado no CÓDIGO (não só na ops-doc): revisão
// legal em docs/reports/11-revisao-legal.md; bases legais e transparência no ADR 0040;
// exclusão de conta no ADR 0039. A lista de operadores reflete o que o código usa hoje
// (Sentry incluso; OpenAI condicional à key, ADR 0027). Versão forward-only: bump a data
// ao mudar o texto material.
export const dynamic = "force-static";

const LAST_UPDATED = "24 de setembro de 2026";

export const metadata: Metadata = {
  title: "Política de Privacidade",
  description:
    "Política de Privacidade do Palpiteiro — quais dados tratamos, para quê, com qual base legal, com quem, por quanto tempo e como exercer seus direitos sob a LGPD.",
  alternates: { canonical: "/privacidade" },
};

const linkClass =
  "rounded-sm text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

function Strong({ children }: { children: React.ReactNode }) {
  return <strong className="font-medium text-foreground">{children}</strong>;
}

function ContactLink() {
  return (
    <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className={linkClass}>
      {LEGAL_CONTACT_EMAIL}
    </a>
  );
}

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
              O controlador dos seus dados pessoais, nos termos da{" "}
              <a
                href="https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm"
                target="_blank"
                rel="noopener noreferrer"
                className={linkClass}
              >
                LGPD (Lei nº 13.709/2018)
              </a>
              , é {controllerIdentification()}. O Palpiteiro não tem fins lucrativos hoje: não
              cobra, não exibe anúncios e não recebe comissão de ninguém.
            </p>
            <p>
              Canal para qualquer assunto de privacidade, inclusive pedidos de identificação
              completa do controlador: <ContactLink />.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">2. Dados que tratamos</h2>
            <ul className="ml-4 flex list-disc flex-col gap-1.5">
              <li>
                <Strong>Conta:</Strong> seu e-mail; se você entrar com Google, o nome e a imagem
                de perfil que o Google nos entrega; se cadastrar uma passkey, a chave pública da
                credencial (nunca sua biometria, que fica no seu dispositivo); o nome e o avatar
                que você editar no perfil; sua preferência de modelo; e a data em que você
                aceitou os Termos e declarou ter 18 anos ou mais.
              </li>
              <li>
                <Strong>Uso:</Strong> as análises e palpites que você pede, seu histórico e
                resultados, os palpites que você decidir compartilhar e as apostas que você
                registrar no app — inclusive o texto livre que você digitar para descrevê-las.
                Não escreva nesse campo dados pessoais seus ou de outras pessoas.
              </li>
              <li>
                <Strong>Técnicos e de segurança:</Strong> endereço IP e e-mail usados nos
                contadores de limite do login, o custo de IA por usuário, registros de acesso e
                de erro gerados pela hospedagem e pelo monitoramento.
              </li>
            </ul>
            <p>
              Coletamos apenas o necessário (art. 6º, III da LGPD). Não tratamos dados sensíveis,
              não pedimos documento, CPF, telefone ou dados bancários, e não recebemos dinheiro.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">3. Para que usamos e com qual base legal</h2>
            <ul className="ml-4 flex list-disc flex-col gap-1.5">
              <li>
                <Strong>Criar e manter sua conta, gerar e guardar suas análises, palpites e
                apostas registradas, e publicar um palpite quando você pede para compartilhar</Strong>{" "}
                — execução do contrato (os Termos de Uso) que você aceita ao entrar (art. 7º, V).
              </li>
              <li>
                <Strong>Segurança, prevenção de abuso e controle de custo</Strong> (limites de
                uso, monitoramento de erros, alerta de gasto) e{" "}
                <Strong>registro do seu aceite</Strong> — legítimo interesse do controlador em
                manter o serviço seguro, estável e viável (art. 7º, IX, e art. 10). Você pode se
                opor a esse tratamento pelo canal de contato (art. 18, § 2º).
              </li>
            </ul>
            <p>
              Não usamos o consentimento como base para o funcionamento do serviço, e por isso
              não há um consentimento separado a revogar: se não quiser mais o tratamento, você
              pode encerrar a conta a qualquer momento (seção 8).
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">4. O que não fazemos</h2>
            <ul className="ml-4 flex list-disc flex-col gap-1.5">
              <li>não vendemos nem alugamos dados, e não fazemos marketing com eles;</li>
              <li>não exibimos publicidade nem compartilhamos dados com casas de apostas;</li>
              <li>
                não tomamos decisões automatizadas sobre você: a IA analisa partidas, não
                pessoas;
              </li>
              <li>não usamos cookies de rastreamento, de publicidade ou de analytics de terceiros.</li>
            </ul>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">5. Com quem os dados são tratados (operadores)</h2>
            <p>Fornecedores envolvidos na operação do serviço, cada um só com o necessário:</p>
            <ul className="ml-4 flex list-disc flex-col gap-1.5">
              <li><Strong>Vercel</Strong> — hospedagem, entrega das páginas e registros de acesso;</li>
              <li><Strong>Neon</Strong> — banco de dados;</li>
              <li><Strong>Resend</Strong> — envio do e-mail de login (magic link);</li>
              <li>
                <Strong>Google</Strong> — login com Google, apenas se você escolher esse método;
              </li>
              <li>
                <Strong>Anthropic</Strong> — geração das análises e palpites; recebe dados das
                partidas e, quando você registra uma aposta em texto livre, esse texto (nunca seu
                e-mail ou nome);
              </li>
              <li>
                <Strong>OpenAI</Strong> — geração de texto, uso condicional e só quando habilitado,
                nas mesmas condições da Anthropic;
              </li>
              <li><Strong>Upstash / Vercel KV</Strong> — contadores de limite de uso;</li>
              <li><Strong>Sentry</Strong> — monitoramento de erros, configurado para não enviar dados pessoais por padrão.</li>
            </ul>
            <p>
              Dados de partidas, odds e notícias vêm de provedores esportivos; nada seu é enviado
              a eles.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">6. Transferência internacional</h2>
            <p>
              Esses fornecedores armazenam ou processam dados fora do Brasil, principalmente nos
              Estados Unidos. A transferência é necessária para executar o serviço que você pediu
              (art. 33, IX, combinado com o art. 7º, V, da LGPD) e fica sujeita às garantias
              contratuais de proteção de dados de cada fornecedor.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">7. Cookies e armazenamento no navegador</h2>
            <p>
              Usamos só o essencial: o cookie de sessão do login, um cookie com o seu fuso horário
              (para mostrar os horários dos jogos corretamente) e a preferência de tema claro ou
              escuro guardada no navegador. Nenhum deles serve para rastrear você.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">8. Por quanto tempo guardamos e como excluir</h2>
            <ul className="ml-4 flex list-disc flex-col gap-1.5">
              <li>
                <Strong>Conta e uso:</Strong> enquanto sua conta existir.
              </li>
              <li>
                <Strong>Contadores de limite</Strong> (IP, e-mail, usuário): expiram sozinhos em
                até 24 horas.
              </li>
              <li>
                <Strong>Registros de hospedagem, e-mail e monitoramento:</Strong> pelo prazo de
                retenção de cada fornecedor, sem uso para outra finalidade.
              </li>
            </ul>
            <p>
              <Strong>Exclusão da conta:</Strong> peça pelo canal <ContactLink />{" "}
              (a partir do e-mail da conta, para confirmarmos que é você). Em até{" "}
              {DATA_REQUEST_RESPONSE_DAYS} dias nós: apagamos seu e-mail, nome, imagem, vínculos
              de login (Google e passkeys) e a data de aceite; apagamos as apostas que você
              registrou, inclusive o texto livre; e desativamos os links públicos dos palpites
              que você compartilhou. As análises e palpites gerados pela IA sobre as partidas
              ficam guardados <Strong>sem qualquer vínculo com você</Strong> (anonimizados),
              só para a estatística agregada de desempenho do modelo, com acesso vedado a
              terceiros (arts. 12 e 16, IV). Depois disso, o mesmo e-mail pode criar uma conta
              nova, do zero.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">9. Seus direitos</h2>
            <p>Pelo art. 18 da LGPD, você pode pedir, a qualquer momento:</p>
            <ul className="ml-4 flex list-disc flex-col gap-1.5">
              <li>confirmação de que tratamos seus dados, e acesso a eles;</li>
              <li>
                correção de dados incompletos, inexatos ou desatualizados (nome e avatar você
                edita direto no{" "}
                <Link href="/perfil" className={linkClass}>
                  perfil
                </Link>
                );
              </li>
              <li>
                anonimização, bloqueio ou eliminação de dados desnecessários, excessivos ou
                tratados em desconformidade com a lei;
              </li>
              <li>portabilidade dos seus dados, em formato estruturado;</li>
              <li>eliminação dos seus dados, com a exclusão da conta (seção 8);</li>
              <li>informação sobre com quem compartilhamos seus dados (seção 5);</li>
              <li>
                informação sobre a possibilidade de não consentir e revogação do consentimento,
                quando ele for a base do tratamento (hoje não é — seção 3);
              </li>
              <li>oposição ao tratamento feito com base em legítimo interesse.</li>
            </ul>
            <p>
              Para exercer qualquer direito, escreva para <ContactLink />. Respondemos em até{" "}
              {DATA_REQUEST_RESPONSE_DAYS} dias. Você também pode peticionar à{" "}
              <a
                href="https://www.gov.br/anpd"
                target="_blank"
                rel="noopener noreferrer"
                className={linkClass}
              >
                Autoridade Nacional de Proteção de Dados (ANPD)
              </a>
              .
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">10. Palpites compartilhados</h2>
            <p>
              Quando você compartilha um palpite, geramos um link público com o conteúdo do
              palpite e os times do jogo — sem seu nome, e-mail ou foto. O link só existe porque
              você pediu, e você pode pedir para desativá-lo a qualquer momento pelo canal de
              contato — ele deixa de abrir para todo mundo.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">11. Menores de 18 anos</h2>
            <p>
              O Palpiteiro não é destinado a menores de 18 anos e não coleta dados de crianças ou
              adolescentes de propósito. Se soubermos que uma conta pertence a um menor,
              excluímos a conta e os dados conforme a seção 8.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">12. Segurança</h2>
            <p>
              Usamos conexão criptografada (HTTPS), login sem senha, acesso restrito ao banco de
              dados e limites contra abuso. Nenhum sistema é infalível: se ocorrer um incidente
              de segurança que possa trazer risco ou dano relevante a você, avisaremos você e a
              ANPD, como manda a lei.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">13. Encarregado</h2>
            <p>
              Como agente de tratamento de pequeno porte, o Palpiteiro está dispensado de indicar
              um encarregado (Resolução CD/ANPD nº 2/2022, art. 11). O canal de comunicação com
              você é o <ContactLink />.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">14. Alterações</h2>
            <p>
              Esta Política pode mudar para refletir o que o serviço faz. A versão em vigor é
              sempre a desta página, com a data de “Última atualização” acima. Mudanças
              relevantes também serão avisadas no app.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-label font-medium text-foreground">15. Contato</h2>
            <p>
              Dúvidas sobre esta Política: <ContactLink />. Veja também os{" "}
              <Link href="/termos" className={linkClass}>
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
