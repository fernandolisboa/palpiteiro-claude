import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Corpo síncrono e presentacional da landing pública `/`. Separado da page de
 * propósito (espelha o split de `ComoFuncionaContent`): o teste de contrato usa
 * `renderToStaticMarkup`, que não aguarda Server Component async, então o markup
 * testável precisa ser síncrono. Conteúdo 100% estático — sem `auth()`, sem DB,
 * sem Odds-API, sem IA.
 *
 * Firewall regulatório: a manchete posiciona o produto ("motor de seleção de
 * edge multi-mercado que emite UM palpite com racional") — "edge multi-mercado"
 * é o framing sancionado que já circula público no signin/desktop-shell. O que
 * NÃO pode aparecer aqui é linguagem de odds/EV/stake/promessa-de-retorno
 * ("ganhe", "lucro garantido"). O rodapé 18+ fecha o disclaimer.
 */
export function LandingContent() {
  return (
    <section className="flex flex-col items-start gap-6 py-16 sm:py-24 lg:py-32">
      <span className="font-mono text-eyebrow uppercase tracking-eyebrow text-muted-fg-2">
        palpite-first · IA + odds
      </span>

      <h1 className="text-display-md font-medium leading-tight tracking-tight sm:text-display-lg">
        Um palpite por jogo, com racional.
      </h1>

      <p className="max-w-reading text-body leading-relaxed text-muted-foreground tracking-tight">
        O Palpiteiro é um motor de seleção de{" "}
        <strong className="font-medium text-foreground">
          edge multi-mercado
        </strong>{" "}
        — resultado final, total de gols, ambas marcam e dupla chance. Pra cada
        jogo ele compara a IA com a casa, escolhe o mercado certo e emite{" "}
        <strong className="font-medium text-foreground">um palpite só</strong>,
        com o porquê na frente. Sem listão de números: a leitura vem pronta, a
        análise fica como detalhe.
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

      <p className="pt-8 text-body-sm text-muted-fg-2 tracking-tight">
        18+ · Não é casa de apostas e não aceita dinheiro real. O dinheiro aqui é
        hipotético; aposta não é investimento. Jogue com responsabilidade — CVV
        188.
      </p>
    </section>
  );
}
