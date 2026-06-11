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
      <h1 className="text-[20px] font-medium tracking-[-0.02em]">
        Como funciona
      </h1>
      <p className="pb-8 pt-2 text-[13.5px] leading-relaxed text-muted-foreground tracking-tight">
        O Palpiteiro <strong className="font-medium text-foreground">recomenda</strong> e{" "}
        <strong className="font-medium text-foreground">acompanha</strong> apostas em
        over/under 2.5 gols — e só isso. Você aposta por fora, na casa, com seu
        próprio dinheiro; o dinheiro que aparece aqui dentro é hipotético, serve só
        pra você medir se as recomendações estão valendo a pena. Esta página explica,
        do zero, o que cada número da tela quer dizer.
      </p>

      {/* Seção 2 — over/under do zero */}
      <section className="border-border border-t pt-8">
        <h2 className="text-[16px] font-medium tracking-[-0.02em]">
          O que é over/under 2.5 (do zero)
        </h2>
        <div className="flex flex-col gap-3 pt-3 text-[13.5px] leading-relaxed text-muted-foreground tracking-tight">
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
            <a href="#odd-decimal" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground">
              odd decimal
            </a>
            : o multiplicador do que você recebe se acertar.
          </p>
        </div>
      </section>

      {/* Seção 3 — como o app decide */}
      <section className="border-border border-t pt-8 mt-8">
        <h2 className="text-[16px] font-medium tracking-[-0.02em]">
          Como o app decide: edge, confiança e PASS
        </h2>
        <div className="flex flex-col gap-3 pt-3 text-[13.5px] leading-relaxed text-muted-foreground tracking-tight">
          <p>
            Pra cada jogo o Palpiteiro compara duas chances: a{" "}
            <a href="#prob-modelo" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground">
              prob. do modelo
            </a>{" "}
            (o quanto a IA acredita num lado) e a{" "}
            <a href="#prob-implicita" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground">
              prob. do mercado
            </a>{" "}
            (a chance que a odd embute, já descontada a{" "}
            <a href="#overround" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground">
              margem da casa
            </a>
            ). A diferença entre as duas é o{" "}
            <a href="#edge" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground">
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
            <a href="#pass-rate" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground">
              pass rate
            </a>{" "}
            entre 30% e 60% é saudável e esperado.
          </p>
        </div>

        {/* Box do exemplo numérico ponta-a-ponta — números EXATOS do spec */}
        <div className="border-border bg-surface-2 mt-5 rounded-lg border p-4">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground">
            um jogo de exemplo, ponta a ponta
          </p>
          <ul className="mt-3 flex flex-col gap-2 text-[13px] leading-relaxed text-muted-foreground tracking-tight">
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
              <strong className="font-medium text-edge-fg">+8pp</strong> → passa do mínimo de
              5pp → o app <strong className="font-medium text-foreground">recomenda over</strong>.
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

      {/* Seção 4 — como ler os números */}
      <section className="border-border border-t pt-8 mt-8">
        <h2 className="text-[16px] font-medium tracking-[-0.02em]">
          Como ler os números (análise + dashboard)
        </h2>
        <div className="flex flex-col gap-3 pt-3 text-[13.5px] leading-relaxed text-muted-foreground tracking-tight">
          <p>
            Na <strong className="font-medium text-foreground">análise</strong> de um jogo você
            vê o{" "}
            <a href="#retorno-esperado" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground">
              retorno esperado
            </a>
            , a{" "}
            <a href="#odd-na-analise" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground">
              odd congelada
            </a>{" "}
            no momento da análise, a{" "}
            <a href="#odd-minima" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground">
              odd mínima
            </a>{" "}
            que ainda vale a pena, os{" "}
            <a href="#cenarios" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground">
              cenários
            </a>{" "}
            dos dois lados e os{" "}
            <a href="#inputs-analise" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground">
              inputs
            </a>{" "}
            que a IA usou.
          </p>
          <p>
            No <strong className="font-medium text-foreground">dashboard</strong>, cada aposta
            usa uma{" "}
            <a href="#stake-unidade" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground">
              unidade
            </a>{" "}
            abstrata e, depois do jogo, é{" "}
            <a href="#liquidacao" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground">
              liquidada
            </a>{" "}
            (de{" "}
            <a href="#pendente-liquidada" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground">
              pendente a liquidada
            </a>
            ). As métricas que importam:{" "}
            <a href="#yield" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground">
              yield
            </a>{" "}
            (eficiência),{" "}
            <a href="#win-rate" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground">
              win rate
            </a>
            ,{" "}
            <a href="#pass-rate" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground">
              pass rate
            </a>
            ,{" "}
            <a href="#lucro-total" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground">
              lucro total
            </a>{" "}
            e a trajetória do{" "}
            <a href="#bankroll" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground">
              bankroll
            </a>
            . Com menos de 20 apostas o app marca{" "}
            <a href="#amostra-pequena" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground">
              amostra pequena
            </a>{" "}
            — não conclua nada cedo demais.
          </p>
          <p>
            Lembrando que{" "}
            <a href="#app-nao-aposta" className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground">
              o app não aposta por você
            </a>
            : tudo aqui é registro e medição.
          </p>
        </div>
      </section>

      {/* Seção 5 — glossário expansível */}
      <section className="border-border border-t pt-8 mt-8">
        <h2 className="text-[16px] font-medium tracking-[-0.02em]">Glossário</h2>
        <p className="pb-4 pt-1 font-mono text-[11px] text-muted-foreground">
          toque pra expandir · casa de cada termo do app
        </p>
        <GlossarySection />
      </section>

      {/* Seção 6 — jogo responsável / aviso legal (copy exata do doc) */}
      <section className="border-border border-t pt-8 mt-8">
        <div className="flex items-center gap-2">
          <h2 className="text-[16px] font-medium tracking-[-0.02em]">
            Jogo responsável
          </h2>
          <span className="border-warn-border bg-warn-soft text-warn-fg rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-medium tracking-[0.04em]">
            18+
          </span>
        </div>
        <div className="flex flex-col gap-3 pt-3 text-[13.5px] leading-relaxed text-muted-foreground tracking-tight">
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
                className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground"
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
                className="text-foreground underline underline-offset-2 decoration-border-strong hover:decoration-foreground"
              >
                jogadoresanonimos.com.br
              </a>
            </li>
          </ul>
          <p className="text-muted-fg-2 text-[12.5px]">
            Palpiteiro é uma ferramenta de análise. Não é casa de apostas e não
            aceita dinheiro real.
          </p>
        </div>
      </section>
    </>
  );
}
