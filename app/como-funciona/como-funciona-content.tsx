import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { GlossarySection } from "@/components/help/glossary-section";
import { PageHeader } from "@/components/page-header";
import { MIN_EDGE_PP } from "@/lib/odds/scenario";
import { POOL_MONEY_NOTE } from "@/lib/view/friend-pool";

/**
 * Corpo síncrono e presentacional de `/como-funciona`. Separado da page async
 * de propósito: `renderToStaticMarkup` (usado pelo teste de contrato de anchors)
 * não aguarda Server Component async, então o markup testável precisa ser
 * síncrono. Conteúdo 100% estático — sem fetch, sem sessão.
 *
 * Um bloco por conceito (#579), com o índice e as seções gerados da mesma lista
 * (`COMO_FUNCIONA_SECTIONS`), pra nunca divergirem. As contas de exemplo ficam num
 * `<details>` nativo ("ver a conta"): sem JS e ainda no markup. Vocabulário de tela
 * da ADR 0056 no corpo (vantagem em pontos, sem aposta, retorno, mais de/menos de,
 * vírgula decimal); os apelidos em inglês só aparecem no termo do glossário.
 *
 * Página pública: nenhum número de desempenho (ADR 0048 D4) e nenhum horário de
 * fechamento do bolão (o #580 muda; a tela do bolão diz quando fecha). Os ids de
 * mercado (`mercado-*`) e `o-palpite` são alvos de link de outras telas: não mudam.
 */
export const COMO_FUNCIONA_SECTIONS = [
  { id: "o-palpite", title: "Palpite da IA" },
  { id: "leitura-do-jogo", title: "Como a IA lê o jogo" },
  { id: "mercados", title: "Os mercados" },
  { id: "como-o-app-decide", title: "Vantagem e sem aposta" },
  { id: "suas-apostas", title: "Suas apostas" },
  { id: "bolao", title: "Bolão" },
  { id: "seus-numeros", title: "Seus números" },
  { id: "glossario", title: "Glossário" },
  { id: "jogo-responsavel", title: "Jogo responsável" },
] as const;

type SectionId = (typeof COMO_FUNCIONA_SECTIONS)[number]["id"];

const LINK =
  "text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

const MIN_EDGE = `${MIN_EDGE_PP} pontos`;

function Strong({ children }: { children: ReactNode }) {
  return <strong className="font-medium text-foreground">{children}</strong>;
}

/** Link pra uma entrada do glossário ou seção desta página (`#anchor`). */
function G({ to, children }: { to: string; children: ReactNode }) {
  return (
    <a href={`#${to}`} className={LINK}>
      {children}
    </a>
  );
}

function Section({
  id,
  badge,
  children,
}: {
  id: SectionId;
  badge?: ReactNode;
  children: ReactNode;
}) {
  const title = COMO_FUNCIONA_SECTIONS.find((s) => s.id === id)!.title;
  return (
    <section
      id={id}
      aria-labelledby={`${id}-titulo`}
      className="border-border mt-8 scroll-mt-20 border-t pt-8"
    >
      <div className="flex items-center gap-2">
        <h2 id={`${id}-titulo`} className="text-display-sm font-medium tracking-tight">
          {title}
        </h2>
        {badge}
      </div>
      {children}
    </section>
  );
}

function Prose({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 pt-3 text-body leading-relaxed tracking-tight text-muted-foreground">
      {children}
    </div>
  );
}

function Market({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div id={id} className="scroll-mt-20 pt-6">
      <h3 className="text-label font-medium tracking-tight">{title}</h3>
      {children}
    </div>
  );
}

/** A conta de exemplo, recolhida: `<details>` nativo, abre e fecha por teclado sem JS. */
function VerAConta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group mt-4 rounded-xl border border-border bg-surface-2">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-3 text-body-sm font-medium tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
        />
        ver a conta
      </summary>
      <div className="px-4 pb-4">
        <p className="text-meta uppercase tracking-label text-muted-foreground">{label}</p>
        <ul className="mt-3 flex flex-col gap-2 text-body leading-relaxed text-muted-foreground tracking-tight">
          {children}
        </ul>
      </div>
    </details>
  );
}

export function ComoFuncionaContent() {
  return (
    <>
      <PageHeader
        title="Como funciona"
        description='Do palpite da IA ao bolão com os amigos, sem jargão. As contas ficam recolhidas em "ver a conta".'
      />

      <nav aria-label="Nesta página">
        <p className="text-meta uppercase tracking-label text-muted-foreground">
          nesta página
        </p>
        <ul className="grid gap-x-6 gap-y-1.5 pt-3 text-body tracking-tight sm:grid-cols-2">
          {COMO_FUNCIONA_SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className={LINK}>
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Section id="o-palpite">
        <Prose>
          <p>
            Na página de um jogo, toque em <Strong>Analisar com IA</Strong> e a IA crava
            um <G to="palpite">palpite</G>: quem leva, o{" "}
            <G to="placar-provavel">placar provável</G> e o porquê, no tom de um amigo
            que entende de futebol. A análise é sob demanda e tem um limite por dia,
            então nem todo jogo tem palpite pronto. A convicção vem numa{" "}
            <G to="confianca-palpite">palavra</G>: baixa, média ou alta.
          </p>
          <p>
            O palpite não traz odd, vantagem, stake nem porcentagem: o placar provável
            é um palpite de placar, não uma cotação.{" "}
            <G to="nao-e-recomendacao">É palpite, não recomendação de aposta.</G>
          </p>
          <p>
            E ele presta contas. Depois do apito, o que dá pra conferir no placar ganha
            o selo <G to="acertou-errou">Acertou ou Errou</G> (fica Em aberto até lá),
            inclusive os palpites secundários do <G to="e-ainda">“e ainda”</G>; o que
            não dá pra conferir de forma justa, como cartão ou escanteio, fica marcado{" "}
            <Strong>“só por diversão”</Strong>. Quando a IA leu notícias, elas aparecem
            em <G to="fontes-palpite">“o palpite leu”</G>, com link pra fonte.
          </p>
        </Prose>
      </Section>

      <Section id="leitura-do-jogo">
        <Prose>
          <p>
            Antes da IA, o app calcula em código a chance de cada placar com o modelo{" "}
            <Strong>Dixon-Coles</Strong>: a força de ataque e de defesa de cada time,
            estimada nos jogos da liga dos últimos três anos, com mais peso para os
            recentes, e o mando de campo. Daí saem as chances de vitória, empate, total
            de gols e ambas marcam. Quando falta histórico (time que acabou de subir,
            poucos jogos na Champions) e na Copa do Mundo, o app usa um modelo mais
            simples, a partir da tabela.
          </p>
          <p>
            Perto do jogo, a análise ajusta essa leitura com o que o modelo não vê:
            desfalques, escalação provável e notícias. Essa é a{" "}
            <G to="leitura-modelo">leitura do modelo</G>, com a{" "}
            <G to="odd-justa">odd justa</G> de cada seleção.
          </p>
        </Prose>
      </Section>

      <Section id="mercados">
        <Prose>
          <p>
            Um <G to="mercado">mercado</G> é o tipo de aposta; cada um tem as suas{" "}
            <G to="selecao">seleções</G> e, às vezes, uma <G to="linha">linha</G>. O
            app trabalha com quatro.
          </p>
        </Prose>

        <Market id="mercado-over-under" title="Total de gols">
          <Prose>
            <p>
              A aposta é no total de gols do jogo, somando os dois times; não importa
              quem marca. <Strong>Mais de 2,5</Strong> = 3 gols ou mais.{" "}
              <Strong>Menos de 2,5</Strong> = 0, 1 ou 2 gols. A linha 2,5 é meio gol de
              propósito: o placar nunca dá 2,5, então a aposta{" "}
              <Strong>nunca empata</Strong>.
            </p>
            <p>
              Cada lado tem uma <G to="odd-decimal">odd decimal</G>, o multiplicador do
              que você recebe se acertar. A conta completa de um jogo está em{" "}
              <G to="como-o-app-decide">Vantagem e sem aposta</G>.
            </p>
          </Prose>
        </Market>

        <Market id="mercado-1x2" title="Resultado (1X2)">
          <Prose>
            <p>
              Quem vence os 90 minutos: <Strong>mandante</Strong> (quem joga em casa),{" "}
              <Strong>empate</Strong> ou <Strong>visitante</Strong>. São três seleções,
              então a <G to="overround">margem</G> se tira das três juntas e cada uma
              tem a sua <G to="edge">vantagem</G>.
            </p>
          </Prose>
          <VerAConta label="resultado, um jogo de exemplo">
            <li>
              Odds de mercado:{" "}
              <Strong>mandante 2,10 / empate 3,40 / visitante 3,60</Strong>.
            </li>
            <li>
              Chance crua (1 ÷ odd): mandante <Strong>0,4762</Strong>, empate{" "}
              <Strong>0,2941</Strong>, visitante <Strong>0,2778</Strong>. Soma das três:{" "}
              <Strong>1,0481</Strong>.
            </li>
            <li>
              A sobra de 4,81% é a margem embutida na odd. Tirando a margem (÷ 1,0481):
              mandante <Strong>45,43%</Strong>, empate <Strong>28,06%</Strong>, visitante{" "}
              <Strong>26,50%</Strong>: a chance do mercado de cada lado.
            </li>
            <li>
              O modelo diz: mandante <Strong>52%</Strong>, empate <Strong>27%</Strong>,
              visitante <Strong>21%</Strong>.
            </li>
            <li>
              Vantagem de cada seleção: mandante 52% − 45,43% ={" "}
              <strong className="font-medium text-edge-fg">+6,57 pontos</strong>; empate
              −1,06 pontos; visitante −5,50 pontos. Só o mandante passa do mínimo de{" "}
              {MIN_EDGE} → o app <Strong>recomenda mandante</Strong>.
            </li>
            <li>
              <Strong>Retorno esperado</Strong> do mandante (se os 52% estiverem certos,
              na odd crua): (52 ÷ 100) × 2,10 − 1 ={" "}
              <strong className="font-medium text-edge-fg">+0,092 ≈ +9%</strong> por
              unidade.
            </li>
          </VerAConta>
        </Market>

        <Market id="mercado-btts" title="Ambas marcam">
          <Prose>
            <p>
              Os dois times marcam? <Strong>Sim</Strong> se cada um faz pelo menos um
              gol; <Strong>não</Strong> se pelo menos um termina sem marcar. Não importa
              o placar nem quem vence: duas seleções, sem empate na aposta, como no total
              de gols.
            </p>
          </Prose>
          <VerAConta label="ambas marcam, um jogo de exemplo">
            <li>
              Odds: <Strong>sim 1,80 / não 2,00</Strong>. Crua: 1 ÷ 1,80 ={" "}
              <Strong>0,5556</Strong>, 1 ÷ 2,00 = <Strong>0,5000</Strong>. Soma{" "}
              <Strong>1,0556</Strong> (margem de 5,56%).
            </li>
            <li>
              Tirando a margem: sim <Strong>52,63%</Strong>, não <Strong>47,37%</Strong>.
              O modelo diz <Strong>60%</Strong> no sim → vantagem{" "}
              <strong className="font-medium text-edge-fg">+7,37 pontos</strong> → passa
              de {MIN_EDGE} → <Strong>recomenda sim</Strong>. Retorno esperado: (60 ÷
              100) × 1,80 − 1 ={" "}
              <strong className="font-medium text-edge-fg">+0,08 ≈ +8%</strong>.
            </li>
          </VerAConta>
        </Market>

        <Market id="mercado-dupla-chance" title="Dupla chance">
          <Prose>
            <p>
              Cobre <Strong>dois dos três</Strong> resultados numa aposta só, em troca
              de uma odd menor: <Strong>mandante ou empate</Strong>,{" "}
              <Strong>empate ou visitante</Strong> e{" "}
              <Strong>mandante ou visitante</Strong>. Como cada opção cobre dois
              resultados, as três somam cerca de <Strong>200%</Strong>, não 100%, e a
              margem se tira com esse alvo. A vantagem costuma ser fina e o sem aposta é
              comum.
            </p>
          </Prose>
          <VerAConta label="dupla chance, um jogo de exemplo">
            <li>
              Odds:{" "}
              <Strong>
                mandante ou empate 1,25 / empate ou visitante 2,00 / mandante ou
                visitante 1,30
              </Strong>
              .
            </li>
            <li>
              Crua (1 ÷ odd), na mesma ordem: 0,8000, 0,5000, 0,7692. Soma{" "}
              <Strong>2,0692</Strong>. Como o alvo é 200%, cada crua ÷ 2,0692 × 2:
              mandante ou empate <Strong>77,32%</Strong>, empate ou visitante{" "}
              <Strong>48,33%</Strong>, mandante ou visitante <Strong>74,35%</Strong>.
            </li>
            <li>
              O modelo diz 79% / 48% / 73%. Vantagens: <Strong>+1,68 pontos</Strong> /
              −0,33 pontos / −1,35 pontos. Nenhuma passa do mínimo de {MIN_EDGE} → o app
              dá <Strong>sem aposta</Strong> (e tudo bem: é o resultado mais comum aqui).
            </li>
          </VerAConta>
        </Market>

        <Prose>
          <p>
            Nem todo jogo tem odds de todos os mercados; quando falta, o mercado não
            aparece na análise daquele jogo.
          </p>
        </Prose>
      </Section>

      <Section id="como-o-app-decide">
        <Prose>
          <p>
            Pra cada seleção, o app compara duas chances: a{" "}
            <G to="prob-modelo">chance do modelo</G> e a{" "}
            <G to="prob-implicita">chance do mercado</G>, que é a que a odd embute
            depois de tirar a <G to="overround">margem embutida na odd</G>. A diferença
            entre as duas é a <G to="edge">vantagem</G>, em pontos.
          </p>
          <p>
            O app só recomenda com vantagem de pelo menos <Strong>{MIN_EDGE}</Strong>.
            Quando nenhuma seleção chega lá, a análise sai como{" "}
            <G to="recomendacao">sem aposta</G>: não apostar. Sem aposta{" "}
            <Strong>não é erro</Strong>: recusar jogo ruim é o que separa apostar de
            torcer.
          </p>
          <p>
            Quando recomenda, o tamanho da aposta vai de{" "}
            <G to="stake-confianca">1 a 3 unidades</G>, conforme a força do sinal. A
            análise mostra ainda o <G to="retorno-esperado">retorno esperado</G>, a{" "}
            <G to="odd-na-analise">odd congelada</G> no momento da análise, a{" "}
            <G to="odd-minima">odd mínima</G> que ainda vale a pena, os{" "}
            <G to="cenarios">cenários</G> das outras seleções e os{" "}
            <G to="inputs-analise">dados</G> que a IA usou.
          </p>
        </Prose>
        <VerAConta label="total de gols, um jogo de exemplo, ponta a ponta">
          <li>
            Odds de mercado: <Strong>mais de 1,92 / menos de 1,92</Strong>.
          </li>
          <li>
            Chance crua de cada lado: 1 ÷ 1,92 = <Strong>0,5208</Strong> (52,08%). Soma
            dos dois: 0,5208 + 0,5208 = <Strong>1,0417</Strong>.
          </li>
          <li>
            Essa sobra de 4,17% é a margem embutida na odd. Tirando a margem: 0,5208 ÷
            1,0417 = <Strong>50%</Strong> pra cada lado → essa é a{" "}
            <Strong>chance do mercado</Strong>.
          </li>
          <li>
            O <Strong>modelo</Strong> diz <Strong>58%</Strong> no mais de.
          </li>
          <li>
            <Strong>Vantagem</Strong> = 58% − 50% ={" "}
            <strong className="font-medium text-edge-fg">+8 pontos</strong> → passa do
            mínimo de {MIN_EDGE} → o app <Strong>recomenda mais de 2,5</Strong>.
          </li>
          <li>
            <Strong>Retorno esperado</Strong> (se os 58% estiverem certos): (58 ÷ 100) ×
            1,92 − 1 = <strong className="font-medium text-edge-fg">+0,1136 ≈ +11%</strong>{" "}
            por unidade, no longo prazo.
          </li>
        </VerAConta>
      </Section>

      <Section id="suas-apostas">
        <Prose>
          <p>
            Na página do jogo, toque nas seleções que você apostou, informe a odd e, se
            quiser, quanto apostou em <G to="stake-unidade">unidades</G>, e registre.
            Duas ou mais seleções podem virar uma <G to="combinada">combinada</G>. Na
            hora, o app mostra a chance que o modelo dá pra cada seleção e a{" "}
            <G to="odd-justa">odd justa</G>; com as odds completas do mercado, também a
            vantagem.
          </p>
          <p>
            Depois do apito ele <G to="liquidacao">confere</G> sozinho: Acertou, Errou
            ou Devolvida. É privado: só você vê.{" "}
            <G to="app-nao-aposta">O app não aposta por você</G> e não tem ligação com
            casa de apostas.
          </p>
        </Prose>
      </Section>

      <Section id="bolao">
        <Prose>
          <p>
            Crie um bolão pra um jogo e anote a aposta de cada amigo (placar exato,
            resultado, dupla chance, ambas marcam ou total de gols), sem ninguém
            precisar de conta. No fim, o app confere com as mesmas regras de Suas
            apostas, usando o placar do jogo ou o que vocês lançarem, e mostra quem
            ganhou e quanto cada um leva do <G to="pote">pote</G>, se vocês combinaram
            um valor.
          </p>
          <p>{POOL_MONEY_NOTE}</p>
        </Prose>
      </Section>

      <Section id="seus-numeros">
        <Prose>
          <p>
            Em Desempenho (as análises da IA que você pediu) e em Suas apostas, tudo é
            contado em <G to="stake-unidade">unidades</G> de dinheiro hipotético e só
            com apostas já <G to="pendente-liquidada">conferidas</G>. No Desempenho, os
            números também saem separados por mercado.
          </p>
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li>
              <G to="yield">Retorno</G>: lucro ÷ total apostado. Mede eficiência, não
              tamanho.
            </li>
            <li>
              <G to="win-rate">Taxa de acerto</G>: quantas acertaram entre as que
              acertaram ou erraram. Alta não garante lucro: o que paga é o retorno.
            </li>
            <li>
              <G to="pass-rate">Jogos sem aposta</G>: em quantas análises a IA não viu
              vantagem suficiente.
            </li>
            <li>
              <G to="lucro-total">Saldo</G>: o lucro ou prejuízo somado, em unidades; o{" "}
              <G to="bankroll">gráfico do saldo</G> mostra a trajetória no tempo.
            </li>
            <li>
              <G to="amostra-pequena">Amostra pequena</G>: com menos de 20 apostas, os
              números ainda são sorte, não habilidade. Não conclua nada cedo demais.
            </li>
          </ul>
          <p>Resultado passado não garante resultado futuro.</p>
        </Prose>
      </Section>

      <Section id="glossario">
        <p className="pb-4 pt-1 text-meta text-muted-foreground">
          toque pra expandir · o significado de cada termo do app
        </p>
        <GlossarySection />
      </Section>

      {/* Jogo responsável / aviso legal: texto verbatim (copy exata do doc). */}
      <Section
        id="jogo-responsavel"
        badge={
          <span className="border-warn-border bg-warn-soft text-warn-fg rounded-md border px-1.5 py-0.5 text-meta font-medium tracking-label">
            18+
          </span>
        }
      >
        <div className="flex flex-col gap-3 pt-3 text-body leading-relaxed text-muted-foreground tracking-tight">
          <p>
            <strong className="font-medium text-foreground">Aposta não é investimento.</strong>{" "}
            As recomendações do Palpiteiro são análises e{" "}
            <strong className="font-medium text-foreground">não garantem resultado</strong>.
            Aposte com responsabilidade, só o que você pode perder, e nunca para
            recuperar perdas. Se a aposta deixou de ser diversão, procure ajuda.
          </p>
          <ul className="flex flex-col gap-2">
            <li>
              <strong className="font-medium text-foreground">CVV</strong> (Centro de
              Valorização da Vida) — apoio emocional / crise, 24h. Ligue{" "}
              <strong className="font-medium text-foreground">188</strong> ·{" "}
              <a
                href="https://www.cvv.org.br/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                cvv.org.br
              </a>
            </li>
            <li>
              <strong className="font-medium text-foreground">Jogadores Anônimos</strong> —
              grupos de apoio a vício em jogo ·{" "}
              <a
                href="https://jogadoresanonimos.com.br/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                jogadoresanonimos.com.br
              </a>
            </li>
          </ul>
          <p className="text-muted-fg-2 text-body-sm">
            Palpiteiro é uma ferramenta de análise. Não é casa de apostas e não
            aceita dinheiro real.
          </p>
        </div>
      </Section>
    </>
  );
}
