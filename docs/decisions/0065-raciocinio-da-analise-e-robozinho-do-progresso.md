# ADR 0065 — "Ver raciocínio" da análise e o robozinho do progresso

## Status

Accepted (2026-10-23). Pedido do Fernando no thread "Progresso da análise com IA", depois do ADR 0064.

## Contexto

O ADR 0064 mostra as etapas do run do HERO ao vivo, mas só a frase de cada uma ("Chances calculadas pelo Dixon-Coles"). O pedido: deixar ver também o RESULTADO de cada etapa, num "ver linha de raciocínio" que abre um modal. E o progresso parecia parado em produção: o ícone não girava.

O ícone não girar não era CSS: a regra global de `prefers-reduced-motion` (`app/globals.css`, ADR 0029) zera toda animação quando o sistema pede menos movimento (no Windows, "Efeitos de animação" desligado). Conferido num navegador com e sem a preferência: sem ela o ícone gira; com ela tudo para, e o run parece travado.

## Decisão

1. **Cada etapa leva o que encontrou** (`detail`, linhas curtas). As frases saem do código, em `lib/ai/progress/details.ts`, a partir do que o pipeline já tem em mãos: forma recente, confrontos, posição na tabela, contagem de desfalques e se a escalação saiu (dados dos times); os mercados cujos preços foram lidos; gols esperados, placar mais provável e a fonte do modelo; os fatores do JEV que mexem nas chances (as mesmas frases sem número do narrador); se o contexto extra mexeu nas chances; quantas notícias entraram; a confiança do palpite e o que cada análise escolheu. Nada de LLM novo, nada de chamada nova.
2. **Mesmo firewall da copy das etapas.** Sem termo de valor (nem "odds"), sem % e sem nome de casa de aposta. `stepDetail` passa cada linha pelo `containsValueLanguage` e derruba a que tiver % antes de mandar; testado contra o guard. Desfalques vão em contagem, nunca com nome de jogador. Números de jogo (gols esperados, posição, placar) podem: não são número de valor.
3. **Protocolo.** `ProgressEvent.detail?: string[]`, validado no cliente (`parseStreamLine`: só strings, teto de linhas e de tamanho). O agregador junta as linhas das instâncias da mesma etapa sem repetir, inclusive depois de "done" (o mercado seguinte que lê preços acrescenta o nome dele e a linha é reenviada).
4. **Gravado com o palpite.** Na gravação do set (`runSynthesis`), as etapas terminadas do run vão em `palpite_sets.headline.reasoning` (jsonb que já existe, sem migration, como `sources` no ADR 0032), com a síntese contada como pronta. Lido de volta por `parseReasoning` (o jsonb não tem schema no banco). Sets antigos e os gerados fora do HERO (cron, script) não têm: sem botão. O envio sem JS também grava (a action abre um contexto de progresso próprio quando não há um). A página pública `/p/[id]` não leva o raciocínio: ele pode citar o contexto extra do dono.
5. **UI.** Botão "Ver raciocínio" no HERO (durante o run, abaixo da linha do tempo; depois, ao lado de "Analisar de novo") abre um diálogo só, montado fora do corpo do HERO: segue aberto quando o run termina e troca as etapas ao vivo pelas gravadas. O diálogo lista cada etapa com o ícone de estado e as linhas do que ela encontrou, e aponta pra aba Mercados para os números completos.
6. **Robozinho.** _(Continua o padrão; a ADR 0068 deixa trocar pelo papagaio mascote em /admin/ia.)_ SVG inline nas cores `palpite-*` ao lado do título do progresso: flutua, olha de um lado pro outro, pisca, a bola da antena gira, e dá um pulinho a cada etapa pronta (a animação acompanha o progresso de verdade). Exceção deliberada ao "sem pulsar" do DESIGN.md, a pedido do dono.
7. **Movimento reduzido.** _(Emenda da ADR 0068: o spinner da etapa em andamento agora gira também com movimento reduzido, em vez de respirar.)_ Continua respeitado: nada se desloca. O que leva a classe `palpite-calm` (olhos e bola do robô, ícone da etapa em andamento) respira só na opacidade, um ciclo lento de 2,4 s, pra o run não parecer travado. É a única exceção à regra global, e não é piscar.

## Alternativas rejeitadas

1. **Mostrar o resultado inline em cada linha da linha do tempo.** Rejeitada: a linha do tempo fica longa demais no celular; o pedido foi um modal.
2. **Montar o raciocínio a partir das predições salvas** (julgamentos, λ, fontes). Rejeitada: não sabe o que falhou ou foi pulado no run, e cada etapa nova pediria um leitor novo. O rastro do próprio run é exato e já existe.
3. **Coluna nova em `palpite_sets`.** Rejeitada: o `headline` jsonb já guarda o que o HERO mostra, e o raciocínio é parte disso.
4. **Ignorar o `prefers-reduced-motion` no robô.** Rejeitada: é uma preferência de acessibilidade do sistema. A respiração em opacidade é a alternativa de movimento reduzido.

## Consequências

- Sem tabela, flag ou chamada paga nova. O `headline` cresce alguns KB por set.
- Etapa nova entra com a frase em `steps.ts` e, se tiver resultado, uma função em `details.ts` chamada por `stepDetail`/verdict onde a etapa roda.
