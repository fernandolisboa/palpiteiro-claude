import Link from "next/link";
import type { ReactNode } from "react";
import { Compass } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TOUR_RESTART_HREF } from "@/lib/tour/steps";

/**
 * Corpo síncrono de `/como-usar`: o passo a passo de USO do app (onde clicar, o que
 * cada tela faz). Complementa `/como-funciona`, que explica os CONCEITOS (edge, PASS,
 * odds, mercados) — aqui só linkamos pra lá, sem repetir. Síncrono pelo mesmo motivo
 * do `ComoFuncionaContent`: o teste renderiza com `renderToStaticMarkup`.
 *
 * Os rótulos entre aspas são os textos reais dos botões; se um botão mudar de nome,
 * este guia precisa acompanhar.
 */

export const COMO_USAR_SECTIONS = [
  { id: "primeiros-passos", title: "Primeiros passos" },
  { id: "escolher-jogo", title: "Escolher um jogo" },
  { id: "gerar-palpite", title: "Gerar o palpite" },
  { id: "ler-analise", title: "Ler o palpite e a análise" },
  { id: "seu-palpite", title: "Analisar o seu palpite" },
  { id: "minha-aposta", title: "Registrar e avaliar sua aposta" },
  { id: "compartilhar", title: "Compartilhar um palpite" },
  { id: "resultados", title: "Acompanhar os resultados" },
  { id: "perfil", title: "Perfil e preferências" },
  { id: "tour", title: "Tour guiado" },
] as const;

type SectionId = (typeof COMO_USAR_SECTIONS)[number]["id"];

const LINK =
  "text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

function Strong({ children }: { children: ReactNode }) {
  return <strong className="font-medium text-foreground">{children}</strong>;
}

/** Rótulo de botão/aba como aparece na tela. */
function Ui({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-sm border border-border-subtle bg-surface-2 px-1 py-px font-medium text-foreground">
      {children}
    </span>
  );
}

function Section({ id, children }: { id: SectionId; children: ReactNode }) {
  const title = COMO_USAR_SECTIONS.find((s) => s.id === id)!.title;
  return (
    <section id={id} className="border-border mt-8 scroll-mt-20 border-t pt-8">
      <h2 className="text-display-sm font-medium tracking-tight">{title}</h2>
      <div className="flex flex-col gap-3 pt-3 text-body leading-relaxed tracking-tight text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return (
    <ol className="flex list-decimal flex-col gap-2 pl-5 marker:font-mono marker:text-muted-fg-2">
      {children}
    </ol>
  );
}

function Tip({ children }: { children: ReactNode }) {
  return (
    <p className="border-border bg-surface-2 rounded-xl border p-4">{children}</p>
  );
}

export function ComoUsarContent() {
  return (
    <>
      <h1 className="text-display-md font-medium tracking-tight">Como usar</h1>
      <p className="pb-6 pt-2 text-body leading-relaxed text-muted-foreground tracking-tight">
        O caminho do app, tela por tela: achar um jogo, pedir o palpite da IA, ler a
        análise, registrar sua aposta e acompanhar o resultado. O que os números
        querem dizer (edge, PASS, odd, stake) está em{" "}
        <Link href="/como-funciona" className={LINK}>
          Como funciona
        </Link>
        .
      </p>

      <div className="border-accent-border bg-accent-soft flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Compass
            aria-hidden="true"
            className="text-accent-fg mt-0.5 size-5 shrink-0"
            strokeWidth={1.5}
          />
          <p className="text-body leading-relaxed tracking-tight text-foreground">
            Prefere ver na prática? O tour guiado destaca cada parte da tela e diz
            onde tocar. Leva menos de um minuto.
          </p>
        </div>
        <Button asChild size="sm" className="w-fit shrink-0">
          <Link href={TOUR_RESTART_HREF}>Fazer o tour</Link>
        </Button>
      </div>

      <nav aria-label="Seções do guia" className="pt-8">
        <p className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
          nesta página
        </p>
        <ol className="flex flex-col gap-1.5 pt-3 text-body tracking-tight">
          {COMO_USAR_SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className={LINK}>
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <Section id="primeiros-passos">
        <p>
          Entre com sua conta Google, com uma passkey ou com um link enviado pro seu
          e-mail. Se o link não chegar em alguns minutos, olhe a caixa de spam.
        </p>
        <p>
          Depois do login você cai em <Strong>Próximos jogos</Strong>, a tela
          principal. O menu fica sempre no topo da tela (no celular, no ícone ☰):{" "}
          <Ui>jogos</Ui>, <Ui>apostas</Ui>, <Ui>bolão</Ui> e <Ui>desempenho</Ui> são
          as telas do dia a dia (no <Ui>bolão</Ui> você anota a aposta de cada amigo
          num jogo e o app diz quem ganhou); <Ui>ajuda</Ui> reúne <Ui>como usar</Ui>, <Ui>como funciona</Ui> e{" "}
          <Ui>rever o tour</Ui>. O <Ui>perfil</Ui> e o <Ui>sair</Ui> ficam no seu
          avatar, no canto direito.
        </p>
      </Section>

      <Section id="escolher-jogo">
        <Steps>
          <li>
            Escolha o campeonato no seletor (<Ui>Todas as ligas</Ui> junta todos os
            que o app acompanha).
          </li>
          <li>
            Escolha o período: <Ui>5 dias</Ui>, <Ui>14 dias</Ui>,{" "}
            <Ui>Competição</Ui> (a temporada inteira) ou um intervalo seu nos campos
            de data <Ui>De</Ui> e <Ui>Até</Ui>.
          </li>
          <li>
            Toque no jogo pra abrir. A lista mostra 15 jogos por vez;{" "}
            <Ui>Carregar mais</Ui> traz mais 15.
          </li>
        </Steps>
        <p>
          Cada linha traz o campeonato, o horário, os times e as odds de referência
          (mandante / empate / visitante, ou mais / menos gols) quando o mercado já tem
          odd. Aparece{" "}
          <Ui>✓ analisado</Ui> nos jogos que você já analisou, <Ui>AO VIVO</Ui> nos
          que estão rolando e o placar nos encerrados. <Strong>sem odd</Strong>{" "}
          significa que ainda não há cotação; sem ela a análise não roda.
        </p>
        <p>
          Abaixo da lista, <Strong>Suas predições recentes</Strong> mostra os últimos
          jogos que você analisou. <Ui>ver todas →</Ui> abre o desempenho.
        </p>
      </Section>

      <Section id="gerar-palpite">
        <Steps>
          <li>
            Na página do jogo, toque em <Ui>Analisar com IA</Ui>, no quadro{" "}
            <Strong>O Palpite</Strong>.
          </li>
          <li>
            Espere: a IA analisa cada mercado disponível pro jogo (resultado, gols,
            ambas marcam, dupla chance e outros) e depois monta o palpite. Pode
            levar alguns minutos; mantenha a página aberta.
          </li>
          <li>
            O palpite aparece no topo e o detalhe de cada mercado fica logo abaixo.
          </li>
        </Steps>
        <p>
          Depois da primeira análise surgem dois botões. <Ui>Analisar de novo</Ui>{" "}
          refaz tudo com dados novos (odds mudam, escalações saem).{" "}
          <Ui>Refazer só o palpite</Ui> reescreve só o texto do palpite a partir das
          análises que já existem, bem mais rápido.
        </p>
        <p>
          Sabe de algo que os dados podem não ter, como quem está fora ou como os
          times vêm? Quando aparecer <Ui>Contexto extra (opcional)</Ui> logo acima
          do botão, abra e escreva antes de analisar. A IA separa as afirmações e a
          gente confere cada uma com os nossos dados: a confirmada em geral o modelo
          já considerava, a não verificável entra com peso menor e a contradita não
          entra. O contexto não
          conta a mais no seu limite do dia. Não escreva dados pessoais. Pra ver o
          que entrou, abra <Ui>ver análise por mercado</Ui>: lá em cima fica{" "}
          <Ui>o que você acrescentou</Ui>, com o status de cada afirmação.
        </p>
        <Tip>
          <Strong>Limite diário.</Strong> Cada mercado analisado conta como uma
          análise do seu limite do dia, então um <Ui>Analisar com IA</Ui> gasta
          várias de uma vez. Refazer só o palpite tem um limite separado, bem maior.
          Quando o limite acaba, o app avisa; ele libera de novo 24 horas depois da
          primeira análise da janela.
        </Tip>
        <p>
          A análise só roda <Strong>antes do apito inicial</Strong>. Com o jogo em
          andamento, adiado ou encerrado, os botões somem, mas o que você já
          analisou continua lá.
        </p>
      </Section>

      <Section id="ler-analise">
        <p>
          <Strong>O Palpite</Strong> é a manchete: quem leva, o placar provável, a
          confiança (baixa, média ou alta) e um parágrafo com o porquê. Embaixo
          aparecem os mercados que ele usou e, quando a IA leu notícias, os links das
          fontes. Depois do jogo, o quadro mostra se <Ui>acertou</Ui> ou{" "}
          <Ui>errou</Ui> e o placar real.
        </p>
        <p>
          Logo abaixo, toque em <Ui>ver análise por mercado</Ui> pra
          abrir o detalhe de cada mercado: a seleção sugerida com odd, stake e
          retorno esperado, os cenários comparados e os fatores-chave. Quando nenhum
          lado tem vantagem suficiente, o mercado sai como <Strong>PASS</Strong> (não
          apostar), e isso é esperado. <Ui>análises anteriores</Ui> guarda as versões
          antigas.
        </p>
        <p>
          Todo número com um <Ui>?</Ui> ao lado explica o que é num toque, com um
          link pro trecho certo de{" "}
          <Link href="/como-funciona" className={LINK}>
            Como funciona
          </Link>
          . Mais abaixo na página ficam as odds atuais, as partidas recentes, o
          confronto direto, a classificação, os desfalques e as escalações. Tocar no
          nome de um time abre o histórico dele.
        </p>
      </Section>

      <Section id="seu-palpite">
        <p>
          Tem um palpite seu pro jogo? Na página do jogo, a parte{" "}
          <Ui>seu palpite</Ui> mostra o que o modelo acha dele. Escolha{" "}
          <Ui>Placar</Ui> (toque nos gols de cada time, ou use <Ui>outro placar</Ui>{" "}
          e <Ui>Usar placar</Ui> pra 6 gols ou mais) ou <Ui>Resultado</Ui> (vitória
          de um dos times ou empate). A leitura sai na hora e é grátis: a chance do
          seu palpite, a posição do placar entre os mais prováveis e a chance de
          cada resultado.
        </p>
        <Steps>
          <li>Escolha o placar ou o resultado nos botões.</li>
          <li>
            Se quiser, escreva em poucas linhas por que você acha isso (quem está
            fora, como os times vêm, o que o jogo vale) e toque em{" "}
            <Ui>Analisar meu palpite</Ui>. Conta 1 do seu limite diário de palpites.
          </li>
          <li>
            A IA lê o seu motivo e separa as afirmações. Cada uma é conferida com os
            nossos dados e ganha uma etiqueta: <Ui>confirmada</Ui>,{" "}
            <Ui>contradita</Ui> ou <Ui>não verificável</Ui>.
          </li>
        </Steps>
        <p>
          A análise mostra a leitura <Ui>sem o seu contexto</Ui> e{" "}
          <Ui>com o seu contexto</Ui>, lado a lado. O que você contou só mexe no
          modelo por um caminho limitado: desfalques e rodízio descontam gols
          esperados e o peso do jogo soma um pouco. Uma afirmação contradita não
          entra, e uma não verificável entra com peso menor. Dizer que o time está
          completo não sobe a chance, porque o modelo não premia ausência de
          desfalque. Quando o modelo discorda de você, ele diz por quê, citando o
          dado.
        </p>
        <Tip>
          <Strong>Gostou do palpite?</Strong> <Ui>Adicionar às suas apostas</Ui>{" "}
          leva o placar ou o resultado pra lista de <Ui>Suas apostas</Ui>, logo
          abaixo, pra você registrar. Não escreva dados pessoais no motivo: ele fica
          salvo com a sua análise.
        </Tip>
      </Section>

      <Section id="minha-aposta">
        <p>
          Na página do jogo, a parte <Ui>registrar apostas</Ui> deixa todos os
          mercados à vista: você só toca no que apostou (ou pensa em apostar). O Palpiteiro não aceita dinheiro: aqui é só
          registro e avaliação, sem gastar análises do seu limite.
        </p>
        <Steps>
          <li>
            Toque nas seleções: resultado, dupla chance, ambas marcam, mais ou menos
            gols (1.5, 2.5, 3.5) e placar exato (pra um placar fora da lista, use{" "}
            <Ui>outro placar</Ui> e <Ui>Adicionar placar</Ui>). Cada uma entra em{" "}
            <Ui>Suas apostas</Ui>, ao lado no computador ou na barra de baixo no
            celular.
          </li>
          <li>
            Confira a odd de cada uma. Ela vem preenchida com a odd de referência
            quando o app tem uma; troque pela que você pegou. Stake é opcional.
          </li>
          <li>
            Escolha <Ui>Simples</Ui> (cada seleção é uma aposta) ou{" "}
            <Ui>Combinada</Ui> (todas juntas, com a odd total) e toque em{" "}
            <Ui>Registrar apostas</Ui>.
          </li>
        </Steps>
        <p>
          Logo depois aparece a avaliação de cada aposta: a probabilidade do modelo,
          a odd justa, o retorno esperado na sua odd e uma sugestão de stake. Elas
          ficam salvas em{" "}
          <Link href="/apostas" className={LINK}>
            Apostas
          </Link>{" "}
          e são conferidas sozinhas depois do jogo.
        </p>
        <Tip>
          <Strong>Prefere escrever?</Strong> Em <Ui>ou digite sua aposta</Ui>,
          escreva do seu jeito, por exemplo{" "}
          <em>&quot;Palmeiras vence, mais de 2.5 gols, odd 3.20&quot;</em>, e toque em{" "}
          <Ui>Preencher com o texto</Ui>. O app monta a lista pra você conferir antes
          de registrar.
        </Tip>
      </Section>

      <Section id="compartilhar">
        <p>
          No quadro do palpite, <Ui>Compartilhar</Ui> cria um link público só com o
          palpite (sem seus dados) e copia pra você colar onde quiser. Depois o botão
          vira <Ui>Copiar link</Ui>. <Ui>Parar de compartilhar</Ui> desliga o link;
          prévias já enviadas em apps de mensagem podem continuar aparecendo por um
          tempo.
        </p>
      </Section>

      <Section id="resultados">
        <p>
          Os resultados são apurados sozinhos depois de cada jogo; você não precisa
          marcar nada. São duas telas, com papéis diferentes:
        </p>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>
            <Link href="/dashboard" className={LINK}>
              Desempenho
            </Link>
            : as análises da IA que você pediu, com yield, taxa de acerto, pass rate,
            lucro hipotético em unidades, o gráfico da banca e a tabela jogo a jogo.
            Os filtros de liga e mercado no topo valem pra página toda; o de status
            filtra só a tabela. Tocar numa linha abre o detalhe da análise.
          </li>
          <li>
            <Link href="/apostas" className={LINK}>
              Apostas
            </Link>
            : as apostas que você registrou na página do jogo, cada uma
            marcada como <Ui>Acertou</Ui>, <Ui>Errou</Ui> ou <Ui>Pendente</Ui>. Só
            você vê.
          </li>
        </ul>
        <p>
          O que cada indicador do desempenho mede está em{" "}
          <Link href="/como-funciona" className={LINK}>
            Como funciona
          </Link>
          .
        </p>
      </Section>

      <Section id="perfil">
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>
            <Strong>Nome e avatar</Strong>: como você aparece no app.
          </li>
          <li>
            <Strong>Modelo de análise</Strong>: qual modelo de IA roda as suas
            análises. Sem escolha, vale o padrão do app.
          </li>
          <li>
            <Strong>Passkeys</Strong>: entre com biometria ou o PIN do aparelho, sem
            esperar e-mail. Toque em <Ui>Registrar passkey</Ui>.
          </li>
          <li>
            <Strong>Seus dados</Strong>: como pedir uma cópia dos seus dados ou a
            exclusão da conta.
          </li>
        </ul>
        <p>
          O tema claro ou escuro muda no ícone de sol/lua no topo das telas. O
          fuso horário é o do seu aparelho, sem configurar. Quando sai uma versão
          nova do app, aparece um aviso com <Ui>Recarregar</Ui> no rodapé.
        </p>
      </Section>

      <Section id="tour">
        <p>
          Na primeira vez que você abre o app, um tour escurece a tela e destaca uma
          parte por vez: primeiro a lista de jogos e, quando você abre um jogo, a
          página do jogo. <Ui>Pular tour</Ui>, o <Ui>×</Ui> ou a tecla Esc fecham o
          tour, e ele não volta sozinho.
        </p>
        <p>
          Pra ver de novo, é só tocar em{" "}
          <Link href={TOUR_RESTART_HREF} className={LINK}>
            Fazer o tour
          </Link>{" "}
          ou em <Ui>ajuda</Ui> → <Ui>rever o tour</Ui>, no menu.
        </p>
      </Section>
    </>
  );
}
