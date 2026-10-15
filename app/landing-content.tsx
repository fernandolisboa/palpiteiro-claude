import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import { ApostasPreview } from "@/components/landing/apostas-preview";
import { BolaoPreview } from "@/components/landing/bolao-preview";
import { LandingFigure } from "@/components/landing/landing-figure";
import { PalpitePreview } from "@/components/landing/palpite-preview";
import { Button } from "@/components/ui/button";
import { POOL_MONEY_NOTE } from "@/lib/view/friend-pool";

/**
 * Corpo síncrono e presentacional da landing pública `/`. Separado da page de
 * propósito (espelha o split de `ComoFuncionaContent`): o teste de contrato usa
 * `renderToStaticMarkup`, que não aguarda Server Component async, então o markup
 * testável precisa ser síncrono. Conteúdo 100% estático — sem `auth()`, sem DB,
 * sem Odds-API, sem IA, sem "use client".
 *
 * Firewall regulatório (ADR 0048 D2/D4, ADR 0059): nada de odd, EV, vantagem, stake,
 * R$, %, número de desempenho nem promessa ("ganhe", "lucro", "garantido"); nenhum
 * nome, link ou logo de casa de apostas. O palpite é sob demanda ("o jogo que você
 * escolher"), nunca "um palpite pra cada jogo". As ilustrações usam dados fictícios
 * (components/landing/) sob a legenda "Exemplo ilustrativo". O aviso da tela é o
 * rodapé global (18+, jogo responsável, "não é casa de apostas"): sem aviso inline.
 */
export function LandingContent() {
  return (
    <div className="flex flex-col gap-14 lg:gap-20">
      <section className="flex flex-col items-start gap-6 pt-6 sm:pt-12 lg:pt-14">
        <h1 className="max-w-reading text-balance text-display-lg font-medium leading-[1.1] tracking-tight lg:text-display-xl">
          Palpites de futebol e o bolão da turma, num lugar só.
        </h1>

        <p className="max-w-reading text-body leading-relaxed text-muted-foreground tracking-tight">
          Escolha o jogo e a IA crava um palpite com o porquê. Você anota suas
          apostas e o bolão com os amigos; depois do apito, o app confere o placar e
          faz a conta.
        </p>

        <div className="flex flex-col items-start gap-3 pt-2 sm:flex-row sm:items-center">
          <Button asChild size="lg">
            <Link href="/signin">
              Entrar <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Link
            href="/como-funciona"
            className="rounded-sm px-1 text-body font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            Como funciona →
          </Link>
        </div>
      </section>

      <div className="grid gap-12 lg:grid-cols-3 lg:gap-8">
        <Block
          id="landing-palpite"
          title="Palpite da IA"
          text="No jogo que você escolher, a IA cruza forma, confrontos, desfalques e o modelo de placar e diz quem leva, o placar provável e por quê. É palpite, não recomendação de aposta."
          figure={
            <LandingFigure description="Um cartão de Palpite da IA: Coqueiros FC contra Serra Azul, confiança média, Coqueiros leva num jogo de poucos gols, placar provável 1 a 0.">
              <PalpitePreview />
            </LandingFigure>
          }
        />
        <Block
          id="landing-apostas"
          title="Suas apostas"
          text="Marque o que você apostou e o app guarda tudo, em unidades. Depois do jogo, ele confere sozinho: Acertou, Errou ou Devolvida. Só você vê."
          figure={
            <LandingFigure description="Uma aposta combinada anotada em Suas apostas: vitória do Coqueiros FC e menos de 2,5 gols, as duas em aberto.">
              <ApostasPreview />
            </LandingFigure>
          }
        />
        <Block
          id="landing-bolao"
          title="Bolão"
          text="Anote o palpite de cada amigo, sem ninguém precisar de conta. No fim do jogo o app mostra quem acertou e, se vocês combinaram um valor, como fica a divisão."
          note={POOL_MONEY_NOTE}
          figure={
            <LandingFigure description="Um bolão conferido: placar final 1 a 0; Ana acertou o placar e ganhou, Beto e Caio erraram.">
              <BolaoPreview />
            </LandingFigure>
          }
        />
      </div>
    </div>
  );
}

function Block({
  id,
  title,
  text,
  note,
  figure,
}: {
  id: string;
  title: string;
  text: string;
  note?: string;
  figure: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 id={id} className="text-display-sm font-medium tracking-tight">
          {title}
        </h2>
        <p className="text-body leading-relaxed text-muted-foreground tracking-tight">
          {text}
        </p>
        {note && (
          <p className="text-body-sm leading-relaxed text-muted-foreground tracking-tight">
            {note}
          </p>
        )}
      </div>
      {figure}
    </section>
  );
}
