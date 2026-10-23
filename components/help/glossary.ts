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
 *  - o significado de `edge` cita `${MIN_EDGE_PP} pontos` (não hardcode) pra não
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
    term: "total de gols (mais de / menos de 2,5)",
    anchor: "over-under-2-5",
    meaning:
      "Mercado de total (over/under): a aposta é se o TOTAL de uma métrica do jogo fica ACIMA (mais de) ou ABAIXO (menos de) de uma linha. A linha define o corte.",
    markets: {
      over_under:
        "Aposta no TOTAL de gols do jogo (os dois times somados). Mais de 2,5 = 3 gols ou mais. Menos de 2,5 = 0, 1 ou 2 gols. A linha 2,5 nunca empata — sempre dá um dos dois.",
    },
    group: "conceitos",
  },
  {
    term: "Palpite da IA (a manchete)",
    anchor: "palpite",
    meaning:
      "A previsão do jogo no topo da página, escrita como um amigo daria: quem leva, o placar provável e o porquê. É o registro brincalhão do app, sintetizado das análises de mercado — mas SEM nenhum número de valor (odd, vantagem, stake, %). É previsão informada e diversão, NÃO recomendação de aposta.",
    group: "conceitos",
  },
  {
    term: "confiança do palpite (palavra)",
    anchor: "confianca-palpite",
    meaning:
      "A convicção do palpite, dita em PALAVRA — baixa, média ou alta. Nunca porcentagem, barra ou dígito. Não confundir com a prob. do modelo do motor de valor: aqui é só o tom da manchete.",
    group: "conceitos",
  },
  {
    term: "placar provável",
    anchor: "placar-provavel",
    meaning:
      "O palpite de placar do jogo (ex.: 2–1). É um palpite de resultado, NÃO uma odd — um placar não é uma cotação. Quando o jogo acaba, vira o selo Acertou/Errou da manchete.",
    group: "conceitos",
  },
  {
    term: '"e ainda" (dimensões do palpite)',
    anchor: "e-ainda",
    meaning:
      "Os palpites secundários do jogo, abaixo do placar: a margem, o placar do primeiro tempo, quem marca primeiro, o time que não sofre gol. Cada um vira acertou/errou quando dá pra conferir, ou fica “só por diversão” quando não dá.",
    group: "conceitos",
  },
  {
    term: "acertou / errou / só por diversão",
    anchor: "acertou-errou",
    meaning:
      "Como o palpite presta contas depois do jogo. Acertou/errou = a previsão dava pra conferir no placar final (fica “em aberto” até o apito). “Só por diversão” = não dá pra cravar de forma justa (ex.: cartão vermelho, escanteios) — nunca vira acertou/errou. O palpite não mente sobre o próprio retrospecto.",
    group: "conceitos",
  },
  {
    term: '"o palpite leu" (fontes)',
    anchor: "fontes-palpite",
    meaning:
      "As notícias reais que a IA leu pra montar o palpite, mostradas como links clicáveis (o título leva à matéria). São fontes de verdade e verificáveis, nunca inventadas — pra você checar de onde veio a informação.",
    group: "conceitos",
  },
  {
    term: '"não é recomendação de aposta"',
    anchor: "nao-e-recomendacao",
    meaning:
      "O rótulo fixo no rodapé do palpite. Literal: o palpite é entretenimento e previsão informada, não orientação pra apostar. Quem trata de valor é a parte sóbria do app — as recomendações de mercado.",
    group: "conceitos",
  },
  {
    term: "mercado",
    anchor: "mercado",
    meaning:
      "O tipo de aposta. Os mercados do app: total de gols, resultado (1X2), ambas marcam e dupla chance. Cada mercado tem suas seleções e, às vezes, uma linha. O app recomenda UM mercado por análise.",
    group: "conceitos",
  },
  {
    term: "seleção",
    anchor: "selecao",
    meaning:
      "Uma opção dentro de um mercado. O número de seleções muda por mercado. O app recomenda UMA seleção por análise — ou nenhuma (sem aposta).",
    markets: {
      over_under: "O total de gols tem 2: mais de e menos de.",
      match_result: "1X2 tem 3: mandante, empate e visitante.",
      btts: "BTTS tem 2: sim e não.",
      double_chance:
        "Dupla chance tem 3: mandante ou empate, empate ou visitante e mandante ou visitante.",
    },
    group: "conceitos",
  },
  {
    term: "combinada",
    anchor: "combinada",
    meaning:
      "Duas ou mais seleções numa aposta só, com uma odd total. Só acerta se todas as seleções acertarem; uma que erra derruba a combinada inteira.",
    group: "conceitos",
  },
  {
    term: "linha",
    anchor: "linha",
    meaning:
      "O corte numérico de um mercado, quando ele tem um (ex.: 2,5 no total de gols). Linhas inteiras podem dar devolução (push) se o resultado bater exatamente nelas; a 2,5 nunca empata.",
    group: "conceitos",
  },
  {
    term: "odd decimal",
    anchor: "odd-decimal",
    meaning:
      "O multiplicador do retorno. Odd 1,92 = aposta 1u, recebe 1,92u se ganhar (1u de volta + 0,92u de lucro). Se perder, você perde a 1u apostada (−1u).",
    group: "conceitos",
  },
  {
    term: "mais de / menos de / sem aposta",
    anchor: "recomendacao",
    meaning:
      "O app sugere UMA seleção do mercado, ou sem aposta. Sem aposta = não apostar, porque não há vantagem suficiente. Não é erro — é disciplina; ter muitos jogos sem aposta (30–60%) é BOM.",
    markets: {
      over_under: "As seleções do total de gols são mais de e menos de.",
      match_result: "No 1X2, são mandante, empate e visitante.",
      btts: "No BTTS, são sim e não.",
      double_chance:
        "Na dupla chance, são mandante ou empate, empate ou visitante e mandante ou visitante.",
    },
    group: "decisao",
  },
  {
    term: "o app não aposta por você",
    anchor: "app-nao-aposta",
    meaning:
      "O Palpiteiro só recomenda e acompanha. As apostas são entre você e seus amigos; o app só anota e faz a conta. O app não movimenta dinheiro nenhum.",
    group: "decisao",
  },
  {
    term: "pote do bolão",
    anchor: "pote",
    meaning:
      "Num bolão com valor combinado: valor por pessoa × número de apostas. Quem acerta divide o pote; se ninguém acerta, o grupo decide. O app só faz a conta: não recebe, não guarda e não repassa dinheiro.",
    group: "decisao",
  },
  {
    term: 'prob. do mercado (também chamada "normalizada")',
    anchor: "prob-implicita",
    meaning:
      "A chance que a odd embute, JÁ descontada a margem embutida na odd. Normaliza TODAS as seleções: (1/odd da seleção) ÷ Σ(1/odd de todas as seleções). NUNCA é 1/odd cru — isso ignoraria a margem.",
    markets: {
      over_under:
        "No total de gols (2 seleções): (1/odd do lado) ÷ (1/odd de mais de + 1/odd de menos de).",
      match_result:
        "No 1X2 (3 seleções): (1/odd da seleção) ÷ (soma dos três 1/odd).",
      btts: "No BTTS (2 seleções): (1/odd do lado) ÷ (1/odd_sim + 1/odd_não).",
      double_chance:
        "Na dupla chance, as três opções cobrem dois resultados cada, então a soma alvo é 200% (não 100%) — a normalização usa esse alvo.",
    },
    group: "decisao",
  },
  {
    term: "overround / margem do mercado",
    anchor: "overround",
    meaning:
      "A margem embutida na odd. Por isso, no cru, as probabilidades de todas as seleções somam mais de 100% — o excedente é a margem. Fórmula: Σ(1/odd) − 1.",
    markets: {
      over_under:
        "No total de gols: mais de % + menos de % somam mais de 100%; (1/odd de mais de + 1/odd de menos de) − 1.",
      match_result: "No 1X2: a soma dos três (1/odd) − 1.",
      btts: "No BTTS: (1/odd_sim + 1/odd_não) − 1.",
      double_chance:
        "Na dupla chance: a soma dos três (1/odd) − 2 (o alvo é 200%, não 100%).",
    },
    group: "decisao",
  },
  {
    term: "prob. do modelo (confiança)",
    anchor: "prob-modelo",
    meaning:
      "A chance que a IA dá ao lado recomendado. É a estimativa do modelo, comparada com a prob. do mercado pra medir a vantagem.",
    group: "decisao",
  },
  {
    term: "leitura do modelo",
    anchor: "leitura-modelo",
    meaning:
      "A chance de cada resultado do jogo calculada em código pelo modelo de placar (Dixon-Coles, ou um modelo mais simples a partir da tabela quando falta histórico), ajustada pela análise perto do jogo (desfalques, escalação, notícias). A conta sai sem a IA e sem olhar as odds: não é recomendação nem mede vantagem. A odd justa é 100 ÷ probabilidade.",
    group: "numeros",
  },
  {
    term: "odd justa",
    anchor: "odd-justa",
    meaning:
      "100 ÷ a chance do modelo (em %): a odd que o modelo acha que a seleção deveria pagar, sem margem. Ex.: chance de 50% → odd justa 2,00.",
    group: "numeros",
  },
  {
    term: "vantagem (edge)",
    anchor: "edge",
    meaning: `Quanto a prob. do modelo supera a prob. do mercado, em PONTOS percentuais (prob. do modelo − prob. do mercado normalizada). O app só recomenda com vantagem de pelo menos ${MIN_EDGE_PP} pontos.`,
    group: "decisao",
  },
  {
    term: "retorno esperado",
    anchor: "retorno-esperado",
    meaning:
      "Ganho médio por aposta, no longo prazo, se a estimativa do modelo estiver certa: (confiança ÷ 100) × odd − 1. Usa a odd crua (é ela que paga). Ex.: 58% e odd 1,92 → +0,1136 (≈ +11%).",
    group: "numeros",
  },
  {
    term: 'odd mínima ("vale a pena se odd ≥")',
    anchor: "odd-minima",
    meaning: `A menor odd em que a aposta ainda mantém vantagem de pelo menos ${MIN_EDGE_PP} pontos sobre o mercado, com as outras odds do mercado paradas. No motor em código é calculada com a mesma conta da vantagem; nas análises antigas decididas pela IA, era a IA que informava. Se a odd cair abaixo disso, a vantagem some.`,
    group: "numeros",
  },
  {
    term: "odd na análise (congelada)",
    anchor: "odd-na-analise",
    meaning:
      "A odd que valia no momento em que a análise rodou, registrada na predição. A odd de mercado pode ter mudado depois — por isso o card de odds pode mostrar outro número.",
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
      "O tamanho da aposta varia com a força do sinal (vantagem × confiança): 1u, 2u ou 3u. Mais vantagem → mais unidades. O histórico antigo permanece tudo 1u.",
    group: "numeros",
  },
  {
    term: "liquidação (conferência)",
    anchor: "liquidacao",
    meaning:
      "A resolução da aposta depois do jogo: Acertou, Errou, Devolvida ou Anulada. Não é instantâneo — roda algumas horas depois do apito final.",
    group: "numeros",
  },
  {
    term: "devolvida (push)",
    anchor: "push",
    meaning:
      "Resultado nulo: a aposta é devolvida (lucro 0), sem ganho nem perda. Acontece em linhas inteiras quando o placar bate exatamente nelas — não acontece no total de gols 2,5, que nunca empata. Como a anulada, fica FORA do retorno e da taxa de acerto.",
    group: "numeros",
  },
  {
    term: "em aberto vs liquidada (pendente)",
    anchor: "pendente-liquidada",
    meaning:
      "Em aberto = jogo não terminou ou resultado não processado ainda. Liquidada = já resolvida (Acertou/Errou/Devolvida/Anulada) e contando nas métricas.",
    group: "numeros",
  },
  {
    term: "retorno (yield)",
    anchor: "yield",
    meaning:
      "A métrica-mãe: lucro ÷ total apostado × 100. Conta só apostas liquidadas que acertaram ou erraram (exclui jogos sem aposta e anuladas). Mede eficiência, não tamanho.",
    group: "numeros",
  },
  {
    term: "taxa de acerto (win rate)",
    anchor: "win-rate",
    meaning:
      "Parcela das apostas liquidadas que acertaram: acertos ÷ (acertos + erros). Exclui jogos sem aposta e anuladas. Taxa de acerto alta não garante lucro — o que paga é o retorno.",
    group: "numeros",
  },
  {
    term: "jogos sem aposta (pass rate)",
    anchor: "pass-rate",
    meaning:
      "% de jogos em que o app não recomendou aposta, sobre TODAS as predições. Alvo saudável: 30–60%. Muitos jogos sem aposta é disciplina, não fraqueza.",
    group: "numeros",
  },
  {
    term: "saldo (lucro total)",
    anchor: "lucro-total",
    meaning:
      "Soma de lucro/prejuízo acumulado em unidades das apostas já liquidadas (acertos e erros), em dinheiro hipotético. Diferente do bankroll (que é a trajetória no tempo) e do retorno (que é eficiência em %).",
    group: "numeros",
  },
  {
    term: "bankroll",
    anchor: "bankroll",
    meaning:
      "O gráfico do saldo acumulado ao longo do tempo (em unidades), começando em zero. Dinheiro hipotético — serve pra ver a trajetória, não é dinheiro de verdade.",
    group: "numeros",
  },
  {
    term: "amostra pequena",
    anchor: "amostra-pequena",
    meaning:
      "Menos de 20 apostas liquidadas. Com tão poucas, os números (retorno, taxa de acerto) são ruído de sorte, não habilidade. O app sinaliza pra você não concluir cedo demais.",
    group: "numeros",
  },
  {
    term: "cenários (lado alternativo)",
    anchor: "cenarios",
    meaning:
      'As seleções do mercado com os números congelados da análise. A seleção recomendada é a aposta; as demais são só informativas, NUNCA segundas recomendações. A frase "só sai do zero com odd ≥" é o break-even daquela seleção.',
    markets: {
      over_under:
        'No total de gols, são os dois lados (mais de e menos de); o lado não-recomendado aparece como "cenário alternativo".',
      match_result:
        "No 1X2, são as três seleções (mandante, empate, visitante); as não-recomendadas aparecem como cenário alternativo.",
      btts: "No BTTS, são sim e não.",
      double_chance: "Na dupla chance, são as três opções de par.",
    },
    group: "numeros",
  },
  {
    term: "inputs da análise",
    anchor: "inputs-analise",
    meaning:
      "Os dados que a IA usa: forma recente (últimos 5 jogos), confrontos diretos (H2H), classificação, desfalques (lesão/suspensão) e escalação provável. Dado faltante reduz a confiança e empurra pro sem aposta.",
    group: "numeros",
  },
];
