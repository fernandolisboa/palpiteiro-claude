import { IntentLink } from "@/components/intent-link";
import type { ReactNode } from "react";

import { ParrotMascot } from "@/components/brand/parrot-mascot";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { TOUR_RESTART_HREF } from "@/lib/tour/steps";

/**
 * Corpo síncrono de `/como-usar`: o passo a passo de USO do app (onde clicar, o que
 * cada tela faz). Complementa `/como-funciona`, que explica os CONCEITOS (vantagem, sem aposta,
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
      <PageHeader
        title="Como usar"
        description={
          <>
            O caminho do app, tela por tela: achar um jogo, pedir o palpite da IA, ler a
            análise, registrar sua aposta e acompanhar o resultado. O que os números
            querem dizer (vantagem, sem aposta, odd, stake) está em{" "}
            <IntentLink href="/como-funciona" className={LINK}>
              Como funciona
            </IntentLink>
            .
          </>
        }
      />

      <div className="border-accent-border bg-accent-soft flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <ParrotMascot className="size-10" />
          <p className="text-body leading-relaxed tracking-tight text-foreground">
            Prefere ver na prática? O tour guiado destaca cada parte da tela e diz
            onde tocar. Leva menos de um minuto.
          </p>
        </div>
        <Button asChild size="sm" className="w-fit shrink-0">
          <IntentLink href={TOUR_RESTART_HREF}>Fazer o tour</IntentLink>
        </Button>
      </div>

      <nav aria-label="Seções do guia" className="pt-8">
        <p className="text-meta uppercase tracking-label text-muted-foreground">
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
          principal. O menu fica sempre à vista: no computador, no topo da tela; no
          celular, nas abas da parte de baixo.{" "}
          <Ui>jogos</Ui>, <Ui>suas apostas</Ui>, <Ui>bolão</Ui> e <Ui>desempenho</Ui> são
          as telas do dia a dia (no <Ui>bolão</Ui> você anota a aposta de cada amigo
          num jogo e o app diz quem ganhou). No computador, as três últimas ficam
          juntas no menu <Ui>apostas</Ui>. <Ui>Ajuda</Ui> (no celular, em{" "}
          <Ui>mais</Ui>) reúne <Ui>como usar</Ui>, <Ui>como funciona</Ui> e{" "}
          <Ui>rever o tour</Ui>. O <Ui>perfil</Ui> e o <Ui>sair</Ui> ficam no seu
          avatar, no canto direito.
        </p>
      </Section>

      <Section id="escolher-jogo">
        <Steps>
          <li>
            Escolha o campeonato no primeiro botão da linha de filtros{" "}
            (<Ui>Todas as ligas</Ui> junta todos os que o app acompanha). No
            celular, a linha rola pro lado.
          </li>
          <li>
            A lista começa nos próximos jogos e segue daqui pra frente;{" "}
            <Ui>Carregar mais</Ui>, no fim, traz mais 15. Pra um período seu,
            inclusive jogos que já passaram, use <Ui>Escolher datas</Ui> (campos{" "}
            <Ui>De</Ui> e <Ui>Até</Ui>, depois <Ui>Aplicar</Ui>). Com um intervalo
            escolhido, o botão mostra as datas e o <Ui>×</Ui> do lado volta pros
            próximos jogos.
          </li>
          <li>
            Toque no jogo pra abrir.
          </li>
        </Steps>
        <p>
          Os jogos vêm separados por dia (Hoje, Amanhã, e depois o dia da semana com
          a data), no seu fuso. Cada linha traz o horário (nas últimas 3 horas antes
          do jogo, quanto falta), o campeonato, os times e as odds de referência lado
          a lado (mandante / empate / visitante, ou mais / menos gols) quando o
          mercado já tem odd. Embaixo, quando já calculada, a linha do{" "}
          <Strong>Modelo</Strong> dá a chance do favorito e de menos de 2,5 gols.
          Aparece <Ui>✓ analisado</Ui> nos jogos que você já analisou,{" "}
          <Ui>AO VIVO</Ui> no lugar do horário e o placar com o minuto (quando já
          temos) nos que estão rolando, e o placar nos encerrados.{" "}
          <Strong>sem odd</Strong> significa que ainda não há cotação; sem ela a
          análise não roda.
        </p>
        <p>
          Abaixo da lista, <Strong>Suas predições recentes</Strong> mostra os últimos
          jogos que você analisou, um cartão por jogo com o que a IA recomendou em
          cada mercado (e quantos ficaram sem aposta). <Ui>ver todas →</Ui> abre o
          desempenho.
        </p>
      </Section>

      <Section id="gerar-palpite">
        <Steps>
          <li>
            Na página do jogo, toque em <Ui>Analisar com IA</Ui>, no quadro{" "}
            <Strong>Palpite da IA</Strong>.
          </li>
          <li>
            Espere: a IA analisa cada mercado disponível pro jogo (resultado, gols,
            ambas marcam, dupla chance e outros) e depois monta o palpite. Pode
            levar alguns minutos; mantenha a página aberta.
          </li>
          <li>
            O palpite aparece no topo, resumido. <Ui>Ler análise completa</Ui>,
            logo abaixo dele, abre o porquê inteiro e o detalhe de cada mercado.
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
          que entrou, abra <Ui>Ler análise completa</Ui>: lá em cima fica{" "}
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
          Com o jogo rolando, o topo da página mostra o placar, o minuto e há
          quanto tempo ele foi atualizado (e as expulsões, quando há);{" "}
          <Ui>Atualizar placar</Ui> busca de novo, e voltar pra aba também
          atualiza. Durante o jogo, <Ui>Analisar com IA</Ui> faz uma{" "}
          <Strong>leitura ao vivo</Strong>: as chances de cada mercado
          para o resultado final, a partir do placar e do tempo que falta, e um
          palpite com o minuto e o placar. Sem odd ao vivo, ela não recomenda
          aposta, e o <Ui>Contexto extra (opcional)</Ui> fica só pro pré-jogo. A
          leitura conta uma análise do seu limite do dia e fica separada da
          análise de antes do apito. Se o placar mudar, faça uma leitura nova. Com
          o jogo adiado ou encerrado (ou quando a leitura ao vivo não está
          disponível), os botões somem, mas o que você já analisou continua lá.
        </p>
      </Section>

      <Section id="ler-analise">
        <p>
          O <Strong>Palpite da IA</Strong> é a manchete: quem leva, o placar provável, a
          confiança (baixa, média ou alta) e o começo do porquê. Ao abrir{" "}
          <Ui>Ler análise completa</Ui>, o quadro mostra o parágrafo inteiro, os
          mercados que ele usou, os palpites extras e, quando a IA leu notícias, os
          links das fontes. Depois do jogo, o quadro mostra se <Ui>Acertou</Ui> ou{" "}
          <Ui>Errou</Ui> e o placar real.
        </p>
        <p>
          O mesmo <Ui>Ler análise completa</Ui> abre, logo abaixo do palpite, o
          detalhe de cada mercado, um embaixo do outro: a seleção sugerida com odd,
          stake e retorno esperado, os cenários comparados e os fatores-chave. Quando nenhum
          lado tem vantagem suficiente, o mercado sai como <Strong>Sem aposta</Strong> (não
          apostar), e isso é esperado. No fim, <Ui>análises anteriores</Ui> guarda as
          versões antigas.
        </p>
        <p>
          Todo número com um <Ui>?</Ui> ao lado explica o que é num toque, com um
          link pro trecho certo de{" "}
          <IntentLink href="/como-funciona" className={LINK}>
            Como funciona
          </IntentLink>
          . Logo abaixo do palpite ficam três abas. Em <Ui>Mercados</Ui>, as odds de
          mercado (as de antes do jogo, quando ele já começou) com a chance do modelo e
          a odd justa de cada seleção. Em <Ui>Seu palpite</Ui>, o seu palpite. Em{" "}
          <Ui>Dados</Ui>, as partidas recentes, o confronto direto, a classificação, os
          desfalques e as escalações. Tocar no nome de um time abre o histórico dele.
        </p>
      </Section>

      <Section id="seu-palpite">
        <p>
          Tem um palpite seu pro jogo? Na página do jogo, a aba{" "}
          <Ui>Seu palpite</Ui> mostra o que o modelo acha dele. Escolha{" "}
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
          leva o placar ou o resultado pra lista de <Ui>Suas apostas</Ui> (no painel
          ao lado das abas no computador, na barra de baixo no celular), pra você
          registrar. Não escreva dados pessoais no motivo: ele fica
          salvo com a sua análise.
        </Tip>
      </Section>

      <Section id="minha-aposta">
        <p>
          Na página do jogo, a aba <Ui>Mercados</Ui> deixa todos os mercados à vista:
          a odd de mercado, a chance do modelo e a odd justa de cada seleção (nos
          mercados que você analisou, a chance é a da análise), e embaixo de cada
          mercado a chance sem a margem. A marca <Ui>IA</Ui> mostra a seleção
          que a análise recomendou. Você só toca no que apostou (ou pensa em apostar).
          O Palpiteiro não aceita dinheiro: aqui é só registro e avaliação, sem gastar
          análises do seu limite.
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
          <IntentLink href="/apostas" className={LINK}>
            Suas apostas
          </IntentLink>{" "}
          e são conferidas sozinhas depois do jogo. Antes do jogo, <Ui>Explicar com IA</Ui>{" "}
          abaixo da avaliação conta em texto o porquê desses números, sem mudar nenhum
          deles (1 do seu limite diário de palpites).
        </p>
        <p>
          <Strong>Com o jogo rolando</Strong>, dá pra registrar resultado, dupla
          chance, ambas marcam, mais ou menos gols (1.5, 2.5, 3.5) e placar exato. A
          chance da tabela é a do modelo ao vivo, que leva em conta o placar e o
          minuto; as odds mostradas são as de antes do jogo, só de referência, e a
          odd vem em branco: digite a que você pegou. O mercado que o placar já
          decidiu aparece como <Ui>decidido</Ui> e não entra. A avaliação sai pela
          chance ao vivo, sem sugestão de stake. A aposta fica marcada com o minuto
          e o placar do registro, e em Suas apostas as de jogo rolando têm uma linha
          própria, fora do saldo das de antes do jogo.
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
            <IntentLink href="/dashboard" className={LINK}>
              Desempenho
            </IntentLink>
            : as análises da IA que você pediu. No topo, o retorno, a taxa de acerto e
            o saldo em unidades; logo abaixo, o gráfico do saldo. Em{" "}
            <Ui>Detalhe técnico</Ui> ficam os números por mercado (CLV, amostra,
            graduação) e os jogos sem aposta. A tabela, jogo a jogo pela data do jogo,
            mostra 25 análises por página. Os filtros de liga e mercado no topo valem
            pra página toda; o de status filtra só a tabela. Tocar numa linha abre o
            detalhe da análise.
          </li>
          <li>
            <IntentLink href="/apostas" className={LINK}>
              Suas apostas
            </IntentLink>
            : as apostas que você registrou na página do jogo. No topo, quantas estão
            em aberto, quantas você acertou e o saldo em unidades; o filtro separa{" "}
            <Ui>Em aberto</Ui> e <Ui>Encerradas</Ui>. Cada aposta vem marcada como{" "}
            <Ui>Acertou</Ui>, <Ui>Errou</Ui> ou <Ui>Em aberto</Ui>, e a combinada traz
            o selo de cada seleção. As registradas com o jogo rolando levam o selo{" "}
            <Ui>ao vivo</Ui> com o minuto e o placar da hora, e contam numa linha à
            parte, fora dos acertos e do saldo do topo. Só você vê.
          </li>
        </ul>
        <p>
          O que cada indicador do desempenho mede está em{" "}
          <IntentLink href="/como-funciona" className={LINK}>
            Como funciona
          </IntentLink>
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
          <IntentLink href={TOUR_RESTART_HREF} className={LINK}>
            Fazer o tour
          </IntentLink>{" "}
          ou em <Ui>ajuda</Ui> → <Ui>rever o tour</Ui>, no menu (no celular, em{" "}
          <Ui>mais</Ui>).
        </p>
      </Section>
    </>
  );
}
