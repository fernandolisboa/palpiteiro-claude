import { MIN_EDGE_PP } from "@/lib/odds/scenario";

/**
 * Fonte única de verdade do glossário de `/como-funciona`.
 *
 * Módulo de dados puro (sem JSX): consumido pela página (pra renderizar as
 * entradas) E pela issue de hints inline (`?`), que valida que cada `anchor`
 * existe como `id` no DOM da página. Por isso os anchors são o **contrato** —
 * mudá-los quebra os deep-links das dicas.
 *
 * Convenções (pinadas por components/help/__tests__/glossary.test.ts):
 *  - `anchor` único e em kebab-case (vira `id` + alvo de `#hash`);
 *  - `term` lidera com o texto que aparece na tela do app;
 *  - `meaning` em PT-BR claro pra iniciante total, nunca vazio;
 *  - o significado de `edge` cita `${MIN_EDGE_PP}pp` (não hardcode) pra não
 *    driftar do threshold real do prompt (lib/odds/scenario.ts).
 */
export type GlossaryGroup = "conceitos" | "decisao" | "numeros";

export type GlossaryEntry = {
  /** Lidera com o texto exato que aparece na tela do app. */
  term: string;
  /** Slug kebab-case, estável: vira `id` no DOM e alvo de deep-link. */
  anchor: string;
  /** Definição em PT-BR claro pra iniciante; nunca vazia. Genérica (agnóstica de mercado). */
  meaning: string;
  /**
   * Detalhe específico por mercado (`marketKey` → texto), aditivo ao `meaning`
   * genérico. Mantém a FONTE ÚNICA market-aware: o conteúdo over/under vive em
   * `markets.over_under`, preservado verbatim; mercados novos (Fase 4) só
   * adicionam suas chaves. Renderizado pela GlossarySection sob o significado.
   */
  markets?: Record<string, string>;
  /** Categoria temática do termo. Metadado; ainda não dirige a renderização (a lista do glossário é plana). */
  group: GlossaryGroup;
};

export const GLOSSARY: readonly GlossaryEntry[] = [
  {
    term: "over/under 2.5 gols",
    anchor: "over-under-2-5",
    meaning:
      "Mercado de over/under: a aposta é se o TOTAL de uma métrica do jogo fica ACIMA (over) ou ABAIXO (under) de uma linha. A linha define o corte.",
    markets: {
      over_under:
        "Aposta no TOTAL de gols do jogo (os dois times somados). Over = 3 gols ou mais. Under = 0, 1 ou 2 gols. A linha 2.5 nunca empata — sempre dá Over ou Under.",
    },
    group: "conceitos",
  },
  {
    term: "mercado",
    anchor: "mercado",
    meaning:
      "O tipo de aposta. Tier 1: over/under (total de gols) e 1X2 (resultado final); Tier 2: BTTS (ambos marcam) e dupla chance. Cada mercado tem suas seleções e, às vezes, uma linha. O app recomenda UM mercado por análise.",
    group: "conceitos",
  },
  {
    term: "seleção",
    anchor: "selecao",
    meaning:
      "Uma opção dentro de um mercado. Over/under tem 2 (over e under); 1X2 tem 3 (casa, empate, fora). O app recomenda UMA seleção por análise — ou PASS.",
    group: "conceitos",
  },
  {
    term: "linha",
    anchor: "linha",
    meaning:
      "O corte numérico de um mercado, quando ele tem um (ex.: 2.5 no over/under de gols). Linhas inteiras podem dar push (devolução) se o resultado bater exatamente nelas; a 2.5 nunca empata.",
    group: "conceitos",
  },
  {
    term: "odd decimal",
    anchor: "odd-decimal",
    meaning:
      "O multiplicador do retorno. Odd 1.92 = aposta 1u, recebe 1.92u se ganhar (1u de volta + 0.92u de lucro). Se perder, você perde a 1u apostada (−1u).",
    group: "conceitos",
  },
  {
    term: "over / under / PASS",
    anchor: "recomendacao",
    meaning:
      "O app sugere UMA seleção do mercado, ou PASS. PASS = não apostar, porque não há vantagem suficiente. PASS NÃO é erro — é disciplina; pass rate alto (30–60%) é BOM.",
    markets: {
      over_under: "As seleções do over/under são over e under.",
    },
    group: "decisao",
  },
  {
    term: "o app não aposta por você",
    anchor: "app-nao-aposta",
    meaning:
      "O Palpiteiro só recomenda e acompanha. A aposta de verdade você faz por fora, na casa (Betano etc.), com seu dinheiro. O app não movimenta dinheiro nenhum.",
    group: "decisao",
  },
  {
    term: 'prob. do mercado (também chamada "normalizada")',
    anchor: "prob-implicita",
    meaning:
      "A chance que a odd embute, JÁ descontada a margem da casa. Normaliza TODAS as seleções: (1/odd da seleção) ÷ Σ(1/odd de todas as seleções). NUNCA é 1/odd cru — isso ignoraria a margem.",
    markets: {
      over_under:
        "No over/under (2 seleções): (1/odd do lado) ÷ (1/odd_over + 1/odd_under).",
    },
    group: "decisao",
  },
  {
    term: "overround / margem do mercado",
    anchor: "overround",
    meaning:
      "A margem embutida pela casa. Por isso, no cru, as probabilidades de todas as seleções somam mais de 100% — o excedente é a margem. Fórmula: Σ(1/odd) − 1.",
    markets: {
      over_under:
        "No over/under: over% + under% somam mais de 100%; (1/odd_over + 1/odd_under) − 1.",
    },
    group: "decisao",
  },
  {
    term: "prob. do modelo (confiança)",
    anchor: "prob-modelo",
    meaning:
      "A chance que a IA dá ao lado recomendado. É a estimativa do modelo, comparada com a prob. do mercado pra medir o edge.",
    group: "decisao",
  },
  {
    term: "edge",
    anchor: "edge",
    meaning: `Quanto a prob. do modelo supera a prob. do mercado, em PONTOS percentuais (prob. do modelo − prob. do mercado normalizada). O app só recomenda com edge de pelo menos ${MIN_EDGE_PP}pp.`,
    group: "decisao",
  },
  {
    term: "retorno esperado",
    anchor: "retorno-esperado",
    meaning:
      "Ganho médio por aposta, no longo prazo, se a estimativa do modelo estiver certa: (confiança ÷ 100) × odd − 1. Usa a odd crua (é ela que paga). Ex.: 58% e odd 1.92 → +0.1136 (≈ +11%).",
    group: "numeros",
  },
  {
    term: 'odd mínima ("vale a pena se odd ≥")',
    anchor: "odd-minima",
    meaning: `A menor odd em que a aposta ainda mantém edge de pelo menos ${MIN_EDGE_PP}pp — definida pela IA na análise. Se a casa baixar abaixo disso, a vantagem some.`,
    group: "numeros",
  },
  {
    term: "odd na análise (congelada)",
    anchor: "odd-na-analise",
    meaning:
      "A odd que valia no momento em que a análise rodou, registrada na predição. A casa pode ter mudado depois — por isso o card de odds atuais pode mostrar outro número.",
    group: "numeros",
  },
  {
    term: "stake / unidade (u)",
    anchor: "stake-unidade",
    meaning:
      'O tamanho da aposta em "unidades" abstratas. Você define quanto vale 1u no seu bolso. Tudo é contado em unidades pra comparar apostas de tamanhos diferentes.',
    group: "numeros",
  },
  {
    term: "stake por confiança (1–3u)",
    anchor: "stake-confianca",
    meaning:
      "O tamanho da aposta varia com a força do sinal (edge × confiança): 1u, 2u ou 3u. Mais vantagem → mais unidades. As bandas são determinísticas (ADR 0019); o histórico antigo permanece tudo 1u.",
    group: "numeros",
  },
  {
    term: "liquidação / settlement",
    anchor: "liquidacao",
    meaning:
      "A resolução da aposta depois do jogo: won (ganhou), lost (perdeu) ou void (anulada). Não é instantâneo — roda via cron depois do apito final.",
    group: "numeros",
  },
  {
    term: "push / devolução",
    anchor: "push",
    meaning:
      "Resultado nulo: a aposta é devolvida (lucro 0), sem ganho nem perda. Acontece em linhas inteiras quando o placar bate exatamente nelas — raro no over/under 2.5, que nunca empata. Como o void, fica FORA do yield e do win rate.",
    group: "numeros",
  },
  {
    term: "pendente vs liquidada",
    anchor: "pendente-liquidada",
    meaning:
      "Pendente = jogo não terminou ou resultado não processado ainda. Liquidada = já resolvida (won/lost/void) e contando nas métricas.",
    group: "numeros",
  },
  {
    term: "yield",
    anchor: "yield",
    meaning:
      "A métrica-mãe: lucro ÷ total apostado × 100. Conta só apostas liquidadas com won/lost (exclui pass e void). Mede eficiência, não tamanho.",
    group: "numeros",
  },
  {
    term: "win rate",
    anchor: "win-rate",
    meaning:
      "% de apostas ganhas entre as liquidadas: won ÷ (won + lost). Exclui pass e void. Win rate alto não garante lucro — o que paga é o yield.",
    group: "numeros",
  },
  {
    term: "pass rate",
    anchor: "pass-rate",
    meaning:
      "% de jogos em que o app deu PASS, sobre TODAS as predições. Alvo saudável: 30–60%. Pass rate alto é disciplina, não fraqueza.",
    group: "numeros",
  },
  {
    term: "lucro total",
    anchor: "lucro-total",
    meaning:
      "Soma de lucro/prejuízo acumulado em unidades das apostas já liquidadas (won/lost), em dinheiro hipotético. Diferente do bankroll (que é a trajetória no tempo) e do yield (que é eficiência em %).",
    group: "numeros",
  },
  {
    term: "bankroll",
    anchor: "bankroll",
    meaning:
      "O gráfico de lucro/prejuízo acumulado ao longo do tempo (em unidades), começando em zero. Dinheiro hipotético — serve pra ver a trajetória, não é saldo real.",
    group: "numeros",
  },
  {
    term: "amostra pequena",
    anchor: "amostra-pequena",
    meaning:
      "Menos de 20 apostas liquidadas. Com tão poucas, os números (yield, win rate) são ruído de sorte, não habilidade. O app sinaliza pra você não concluir cedo demais.",
    group: "numeros",
  },
  {
    term: "cenários (lado alternativo)",
    anchor: "cenarios",
    meaning:
      'As seleções do mercado com os números congelados da análise. A seleção recomendada é a aposta; as demais são só informativas, NUNCA segundas recomendações. A frase "só sai do zero com odd ≥" é o break-even daquela seleção.',
    markets: {
      over_under:
        'No over/under, são os dois lados (over e under); o lado não-recomendado aparece como "cenário alternativo".',
    },
    group: "numeros",
  },
  {
    term: "inputs da análise",
    anchor: "inputs-analise",
    meaning:
      "Os dados que a IA usa: forma recente (últimos 5 jogos), confrontos diretos (H2H), classificação, desfalques (lesão/suspensão) e escalação provável. Dado faltante reduz a confiança e empurra pro PASS.",
    group: "numeros",
  },
];
