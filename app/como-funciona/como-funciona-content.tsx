import { MIN_EDGE_PP } from "@/lib/odds/scenario";
import { GlossarySection } from "@/components/help/glossary-section";

/**
 * Corpo síncrono e presentacional de `/como-funciona`. Separado da page async
 * de propósito: `renderToStaticMarkup` (usado pelo teste de contrato de anchors)
 * não aguarda Server Component async, então o markup testável precisa ser
 * síncrono. Conteúdo 100% estático — sem fetch, sem sessão.
 */
export function ComoFuncionaContent() {
  return (
    <>
      <h1 className="text-display-md font-medium tracking-tight">
        Como funciona
      </h1>
      <p className="pb-8 pt-2 text-body leading-relaxed text-muted-foreground tracking-tight">
        O Palpiteiro <strong className="font-medium text-foreground">recomenda</strong> e{" "}
        <strong className="font-medium text-foreground">acompanha</strong> apostas em
        vários mercados de futebol — over/under (total de gols), resultado final
        (1X2), ambas marcam e dupla chance. Pra cada jogo ele compara as odds da casa
        com a estimativa da IA, mede onde há vantagem (o{" "}
        <strong className="font-medium text-foreground">edge</strong>) e devolve{" "}
        <strong className="font-medium text-foreground">uma recomendação só</strong> —
        mercado, seleção, linha e tamanho da aposta — ou{" "}
        <strong className="font-medium text-foreground">PASS</strong>, quando não
        compensa apostar. Você aposta por fora, na casa, com seu próprio dinheiro; o
        dinheiro que aparece aqui dentro é hipotético, serve só pra você medir se as
        recomendações estão valendo a pena. Esta página explica, do zero, o que cada
        número da tela quer dizer.
      </p>

      {/* Seção 2 — over/under do zero (= seção de ajuda do mercado over/under) */}
      <section
        id="mercado-over-under"
        className="border-border scroll-mt-20 border-t pt-8 mt-8"
      >
        <h2 className="text-display-sm font-medium tracking-tight">
          O que é over/under 2.5 (do zero)
        </h2>
        <div className="flex flex-col gap-3 pt-3 text-body leading-relaxed text-muted-foreground tracking-tight">
          <p>
            A aposta é no <strong className="font-medium text-foreground">total de gols</strong>{" "}
            do jogo, somando os dois times — não importa quem marca.{" "}
            <strong className="font-medium text-foreground">Over</strong> = 3 gols ou mais.{" "}
            <strong className="font-medium text-foreground">Under</strong> = 0, 1 ou 2 gols.
          </p>
          <p>
            A linha <strong className="font-medium text-foreground">2.5</strong> é meio gol de
            propósito: como gol é número inteiro, o placar nunca dá exatamente 2.5.
            Por isso a aposta <strong className="font-medium text-foreground">nunca empata</strong>{" "}
            — sempre sai Over ou Under, sem devolução.
          </p>
          <p>
            Cada lado tem uma{" "}
            <a href="#odd-decimal" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              odd decimal
            </a>
            : o multiplicador do que você recebe se acertar.
          </p>
        </div>
      </section>

      {/* Seção 3 — como o app decide */}
      <section className="border-border border-t pt-8 mt-8">
        <h2 className="text-display-sm font-medium tracking-tight">
          Como o app decide: edge, confiança e PASS
        </h2>
        <div className="flex flex-col gap-3 pt-3 text-body leading-relaxed text-muted-foreground tracking-tight">
          <p>
            Pra cada jogo o Palpiteiro compara duas chances: a{" "}
            <a href="#prob-modelo" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              prob. do modelo
            </a>{" "}
            (o quanto a IA acredita num lado) e a{" "}
            <a href="#prob-implicita" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              prob. do mercado
            </a>{" "}
            (a chance que a odd embute, já descontada a{" "}
            <a href="#overround" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              margem da casa
            </a>
            ). A diferença entre as duas é o{" "}
            <a href="#edge" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              edge
            </a>
            .
          </p>
          <p>
            O app só recomenda quando o edge é de pelo menos{" "}
            <strong className="font-medium text-foreground">{MIN_EDGE_PP}pp</strong> (pontos
            percentuais). Quando não há vantagem suficiente, ele dá{" "}
            <strong className="font-medium text-foreground">PASS</strong> — ou seja, não
            apostar. PASS <strong className="font-medium text-foreground">não é erro</strong>:
            é disciplina. Recusar jogos ruins é o que separa apostar de torcer. Um{" "}
            <a href="#pass-rate" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              pass rate
            </a>{" "}
            entre 30% e 60% é saudável e esperado.
          </p>
          <p>
            Você escolhe o mercado de um jogo; dentro dele o app compara cada
            seleção e recomenda a de maior edge — ou PASS, se nenhuma passa do
            mínimo. Quando recomenda, o tamanho da aposta vai de{" "}
            <a href="#stake-confianca" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              1 a 3 unidades
            </a>
            , conforme a força do sinal — quanto mais edge e confiança, mais
            unidades.
          </p>
        </div>

        {/* Box do exemplo numérico ponta-a-ponta — números EXATOS do spec */}
        <div className="border-border bg-surface-2 mt-5 rounded-xl border p-4">
          <p className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
            um jogo de exemplo, ponta a ponta
          </p>
          <ul className="mt-3 flex flex-col gap-2 text-body leading-relaxed text-muted-foreground tracking-tight">
            <li>
              Odds da casa:{" "}
              <strong className="font-medium text-foreground">over 1.92 / under 1.92</strong>.
            </li>
            <li>
              Prob. crua de cada lado: 1 ÷ 1.92 ={" "}
              <strong className="font-medium text-foreground">0.5208</strong> (52,08%). Soma dos
              dois: 0.5208 + 0.5208 ={" "}
              <strong className="font-medium text-foreground">1.0417</strong>.
            </li>
            <li>
              Essa sobra de 4,17% é o{" "}
              <strong className="font-medium text-foreground">overround</strong> (margem da
              casa). Normalizando: 0.5208 ÷ 1.0417 ={" "}
              <strong className="font-medium text-foreground">50%</strong> pra cada lado → essa é
              a <strong className="font-medium text-foreground">prob. do mercado</strong>.
            </li>
            <li>
              O <strong className="font-medium text-foreground">modelo</strong> diz{" "}
              <strong className="font-medium text-foreground">58%</strong> no over.
            </li>
            <li>
              <strong className="font-medium text-foreground">Edge</strong> = 58% − 50% ={" "}
              <strong className="font-medium text-edge-fg">+8pp</strong> → passa do mínimo de{" "}
              {MIN_EDGE_PP}pp → o app{" "}
              <strong className="font-medium text-foreground">recomenda over</strong>.
            </li>
            <li>
              <strong className="font-medium text-foreground">Retorno esperado</strong> (se os
              58% estiverem certos): (58 ÷ 100) × 1.92 − 1 ={" "}
              <strong className="font-medium text-edge-fg">+0.1136 ≈ +11%</strong> por unidade,
              no longo prazo.
            </li>
          </ul>
        </div>
      </section>

      {/* Seção — os outros mercados (1X2, BTTS, dupla chance). O over/under é a
          seção acima; aqui ficam os demais, cada um com âncora linkável própria.
          1X2 ganha o exemplo "do zero" 3-vias; BTTS e dupla chance ficam concisos.
          Mesma matemática do método acima (ADR 0018): a implícita NORMALIZADA
          governa o edge, a odd CRUA governa o retorno; cada seleção tem seu edge. */}
      <section className="border-border border-t pt-8 mt-8">
        <h2 className="text-display-sm font-medium tracking-tight">
          Os outros mercados
        </h2>
        <div className="flex flex-col gap-3 pt-3 text-body leading-relaxed text-muted-foreground tracking-tight">
          <p>
            O mesmo método vale pra todos os mercados — prob. do modelo contra
            prob. do mercado, edge de pelo menos{" "}
            <strong className="font-medium text-foreground">{MIN_EDGE_PP}pp</strong> ou
            PASS. Muda só o que cada aposta cobre e quantas seleções ela tem.
          </p>
        </div>

        {/* 1X2 — do zero, completo (3 seleções, edge por seleção) */}
        <div id="mercado-1x2" className="scroll-mt-20 pt-6">
          <h3 className="text-label font-medium tracking-tight">
            Resultado final: 1X2
          </h3>
          <div className="flex flex-col gap-3 pt-3 text-body leading-relaxed text-muted-foreground tracking-tight">
            <p>
              A aposta é em quem vence os 90 minutos. São três{" "}
              <a href="#selecao" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                seleções
              </a>
              : <strong className="font-medium text-foreground">casa</strong> (o
              mandante ganha),{" "}
              <strong className="font-medium text-foreground">empate</strong> e{" "}
              <strong className="font-medium text-foreground">fora</strong> (o
              visitante ganha). Não tem linha — e, como são três caminhos, a chance
              de um não dá pra deduzir a partir do outro.
            </p>
            <p>
              Com três seleções, a conta da{" "}
              <a href="#overround" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                margem
              </a>{" "}
              muda: somam-se as três probabilidades cruas e normaliza-se cada uma
              por essa soma. Cada seleção tem o seu próprio{" "}
              <a href="#edge" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                edge
              </a>
              .
            </p>
          </div>

          <div className="border-border bg-surface-2 mt-5 rounded-xl border p-4">
            <p className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
              1x2 — um jogo de exemplo, ponta a ponta
            </p>
            <ul className="mt-3 flex flex-col gap-2 text-body leading-relaxed text-muted-foreground tracking-tight">
              <li>
                Odds da casa:{" "}
                <strong className="font-medium text-foreground">casa 2.10 / empate 3.40 / fora 3.60</strong>.
              </li>
              <li>
                Prob. crua (1 ÷ odd): casa{" "}
                <strong className="font-medium text-foreground">0.4762</strong>, empate{" "}
                <strong className="font-medium text-foreground">0.2941</strong>, fora{" "}
                <strong className="font-medium text-foreground">0.2778</strong>. Soma das
                três: <strong className="font-medium text-foreground">1.0481</strong>.
              </li>
              <li>
                A sobra de 4,81% é o{" "}
                <strong className="font-medium text-foreground">overround</strong>.
                Normalizando cada uma (÷ 1.0481): casa{" "}
                <strong className="font-medium text-foreground">45,43%</strong>, empate{" "}
                <strong className="font-medium text-foreground">28,06%</strong>, fora{" "}
                <strong className="font-medium text-foreground">26,50%</strong> → a prob.
                do mercado de cada lado.
              </li>
              <li>
                O <strong className="font-medium text-foreground">modelo</strong> diz:
                casa <strong className="font-medium text-foreground">52%</strong>, empate{" "}
                <strong className="font-medium text-foreground">27%</strong>, fora{" "}
                <strong className="font-medium text-foreground">21%</strong>.
              </li>
              <li>
                Cada seleção tem o seu{" "}
                <strong className="font-medium text-foreground">edge</strong>: casa 52% −
                45,43% = <strong className="font-medium text-edge-fg">+6,57pp</strong>;
                empate −1,06pp; fora −5,50pp. Só a casa passa do mínimo de{" "}
                {MIN_EDGE_PP}pp → o app{" "}
                <strong className="font-medium text-foreground">recomenda casa</strong>.
              </li>
              <li>
                <strong className="font-medium text-foreground">Retorno esperado</strong>{" "}
                da casa (se os 52% estiverem certos, na odd crua): (52 ÷ 100) × 2.10 − 1
                = <strong className="font-medium text-edge-fg">+0.092 ≈ +9%</strong> por
                unidade.
              </li>
            </ul>
          </div>
        </div>

        {/* BTTS — conciso (N=2, mecânica do over/under) */}
        <div id="mercado-btts" className="scroll-mt-20 pt-8">
          <h3 className="text-label font-medium tracking-tight">
            Ambas marcam (BTTS)
          </h3>
          <div className="flex flex-col gap-3 pt-3 text-body leading-relaxed text-muted-foreground tracking-tight">
            <p>
              BTTS (<em>both teams to score</em>) é sobre os dois times marcarem no
              jogo. Duas seleções:{" "}
              <strong className="font-medium text-foreground">sim</strong> (os dois
              marcam pelo menos um gol) e{" "}
              <strong className="font-medium text-foreground">não</strong> (pelo menos
              um time termina sem marcar). Não importa o placar nem quem vence — a
              mecânica é a mesma do over/under: duas seleções, sem empate na aposta.
            </p>
          </div>

          <div className="border-border bg-surface-2 mt-5 rounded-xl border p-4">
            <p className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
              btts — um jogo de exemplo
            </p>
            <ul className="mt-3 flex flex-col gap-2 text-body leading-relaxed text-muted-foreground tracking-tight">
              <li>
                Odds:{" "}
                <strong className="font-medium text-foreground">sim 1.80 / não 2.00</strong>.
                Crua: 1 ÷ 1.80 ={" "}
                <strong className="font-medium text-foreground">0.5556</strong>, 1 ÷ 2.00
                = <strong className="font-medium text-foreground">0.5000</strong>. Soma{" "}
                <strong className="font-medium text-foreground">1.0556</strong> (overround
                5,56%).
              </li>
              <li>
                Normalizando: sim{" "}
                <strong className="font-medium text-foreground">52,63%</strong>, não{" "}
                <strong className="font-medium text-foreground">47,37%</strong>. O modelo
                diz <strong className="font-medium text-foreground">60%</strong> no sim →
                edge <strong className="font-medium text-edge-fg">+7,37pp</strong> → passa
                de {MIN_EDGE_PP}pp →{" "}
                <strong className="font-medium text-foreground">recomenda sim</strong>.
                Retorno esperado: (60 ÷ 100) × 1.80 − 1 ={" "}
                <strong className="font-medium text-edge-fg">+0.08 ≈ +8%</strong>.
              </li>
            </ul>
          </div>
          <p className="text-muted-fg-2 mt-3 text-body-sm">
            Hoje disponível só em jogos de Copa do Mundo.
          </p>
        </div>

        {/* Dupla chance — conciso (3 seleções, mercado par: implícitas somam ~200%) */}
        <div id="mercado-dupla-chance" className="scroll-mt-20 pt-8">
          <h3 className="text-label font-medium tracking-tight">
            Dupla chance
          </h3>
          <div className="flex flex-col gap-3 pt-3 text-body leading-relaxed text-muted-foreground tracking-tight">
            <p>
              Dupla chance cobre{" "}
              <strong className="font-medium text-foreground">dois dos três</strong>{" "}
              resultados do 1X2 numa aposta só, em troca de uma odd menor. As
              seleções:{" "}
              <strong className="font-medium text-foreground">casa ou empate</strong>,{" "}
              <strong className="font-medium text-foreground">empate ou fora</strong> e{" "}
              <strong className="font-medium text-foreground">casa ou fora</strong>. Como
              cada opção abrange dois resultados, as probabilidades das três somam cerca
              de <strong className="font-medium text-foreground">200%</strong> (não 100%)
              — então a normalização tem 200% como alvo. É um mercado conservador: o
              edge costuma ser fino e o PASS é comum.
            </p>
          </div>

          <div className="border-border bg-surface-2 mt-5 rounded-xl border p-4">
            <p className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
              dupla chance — um jogo de exemplo
            </p>
            <ul className="mt-3 flex flex-col gap-2 text-body leading-relaxed text-muted-foreground tracking-tight">
              <li>
                Odds:{" "}
                <strong className="font-medium text-foreground">casa ou empate 1.25 / empate ou fora 2.00 / casa ou fora 1.30</strong>.
              </li>
              <li>
                Crua (1 ÷ odd), na mesma ordem: 0.8000, 0.5000, 0.7692. Soma{" "}
                <strong className="font-medium text-foreground">2.0692</strong>. Como o
                alvo é 200%, normaliza pra somar 2 (cada crua ÷ 2.0692 × 2): casa ou
                empate <strong className="font-medium text-foreground">77,32%</strong>,
                empate ou fora{" "}
                <strong className="font-medium text-foreground">48,33%</strong>, casa ou
                fora <strong className="font-medium text-foreground">74,35%</strong>.
              </li>
              <li>
                O modelo diz 79% / 48% / 73%. Edges:{" "}
                <strong className="font-medium text-foreground">+1,68pp</strong> / −0,33pp
                / −1,35pp. Nenhum passa do mínimo de {MIN_EDGE_PP}pp → o app dá{" "}
                <strong className="font-medium text-foreground">PASS</strong> (e tudo bem
                — PASS é o resultado mais comum aqui).
              </li>
            </ul>
          </div>
          <p className="text-muted-fg-2 mt-3 text-body-sm">
            Hoje disponível só em jogos de Copa do Mundo.
          </p>
        </div>
      </section>

      {/* Seção 4 — como ler os números */}
      <section className="border-border border-t pt-8 mt-8">
        <h2 className="text-display-sm font-medium tracking-tight">
          Como ler os números (análise + dashboard)
        </h2>
        <div className="flex flex-col gap-3 pt-3 text-body leading-relaxed text-muted-foreground tracking-tight">
          <p>
            Na <strong className="font-medium text-foreground">análise</strong> de um jogo você
            vê o{" "}
            <a href="#retorno-esperado" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              retorno esperado
            </a>
            , a{" "}
            <a href="#odd-na-analise" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              odd congelada
            </a>{" "}
            no momento da análise, a{" "}
            <a href="#odd-minima" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              odd mínima
            </a>{" "}
            que ainda vale a pena, os{" "}
            <a href="#cenarios" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              cenários
            </a>{" "}
            dos dois lados e os{" "}
            <a href="#inputs-analise" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              inputs
            </a>{" "}
            que a IA usou.
          </p>
          <p>
            No <strong className="font-medium text-foreground">dashboard</strong>, cada aposta
            usa uma{" "}
            <a href="#stake-unidade" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              unidade
            </a>{" "}
            abstrata e, depois do jogo, é{" "}
            <a href="#liquidacao" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              liquidada
            </a>{" "}
            (de{" "}
            <a href="#pendente-liquidada" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              pendente a liquidada
            </a>
            ). As métricas que importam:{" "}
            <a href="#yield" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              yield
            </a>{" "}
            (eficiência),{" "}
            <a href="#win-rate" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              win rate
            </a>
            ,{" "}
            <a href="#pass-rate" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              pass rate
            </a>
            ,{" "}
            <a href="#lucro-total" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              lucro total
            </a>{" "}
            e a trajetória do{" "}
            <a href="#bankroll" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              bankroll
            </a>
            . Com menos de 20 apostas o app marca{" "}
            <a href="#amostra-pequena" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              amostra pequena
            </a>{" "}
            — não conclua nada cedo demais.
          </p>
          <p>
            Com vários mercados no ar, o{" "}
            <a href="#yield" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              yield
            </a>{" "}
            e as demais métricas também aparecem{" "}
            <strong className="font-medium text-foreground">separados por mercado</strong>{" "}
            — pra você ver onde as recomendações rendem mais.
          </p>
          <p>
            Lembrando que{" "}
            <a href="#app-nao-aposta" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              o app não aposta por você
            </a>
            : tudo aqui é registro e medição.
          </p>
        </div>
      </section>

      {/* Seção 5 — glossário expansível */}
      <section className="border-border border-t pt-8 mt-8">
        <h2 className="text-display-sm font-medium tracking-tight">Glossário</h2>
        <p className="pb-4 pt-1 font-mono text-meta text-muted-foreground">
          toque pra expandir · casa de cada termo do app
        </p>
        <GlossarySection />
      </section>

      {/* Seção 6 — jogo responsável / aviso legal (copy exata do doc) */}
      <section className="border-border border-t pt-8 mt-8">
        <div className="flex items-center gap-2">
          <h2 className="text-display-sm font-medium tracking-tight">
            Jogo responsável
          </h2>
          <span className="border-warn-border bg-warn-soft text-warn-fg rounded-md border px-1.5 py-0.5 font-mono text-meta font-medium tracking-label">
            18+
          </span>
        </div>
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
      </section>
    </>
  );
}
