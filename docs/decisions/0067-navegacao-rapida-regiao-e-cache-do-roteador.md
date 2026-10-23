# ADR 0067 — Navegação rápida: funções em São Paulo e cache do roteador com releitura em segundo plano

## Status

Accepted (2026-10-23). Pedido do Fernando no thread "Navegação mais rápida entre páginas" (#639).

## Contexto

Voltar pro desempenho ou pra /jogos, ou reabrir um jogo já visto, sempre esperava o servidor. Três causas, medidas:

1. **Região.** As funções da Vercel rodavam em `iad1` (Washington, padrão do projeto) e o banco Neon e o Upstash KV estão em `gru1` (São Paulo). O driver do Neon é HTTP: cada query é uma ida e volta de ~120 ms entre os continentes. Medição local (Postgres local atrás de um proxy Neon-HTTP com latência simulada, build de produção, request RSC de navegação):

   | página | queries (máx. em paralelo) | 120 ms por query | 3 ms por query |
   |---|---|---|---|
   | /jogos | 11 (4) | 0,57 s | 0,08 s |
   | /dashboard | 4 (2) | 0,46 s | 0,06 s |
   | /match (pré-jogo) | 22 (6) | 0,68 s | 0,08 s |
   | /match (encerrado) | 15 (6) | 0,54 s | 0,12 s |
   | /apostas | 3 | 0,27 s | 0,03 s |
   | /bolao | 6 (2) | 0,43 s | 0,06 s |

   O usuário está no Brasil: navegador → função em Washington também cruzava o continente a cada navegação.
2. **Cache do roteador desligado.** No Next 15, `staleTimes.dynamic` padrão é 0: toda navegação pra página dinâmica (todas as logadas são: sessão, cookie de fuso, CSP com nonce) refaz o render no servidor, até voltar pra página vista há segundos.
3. **Prefetch parcial.** O `Link` só busca o esqueleto (`loading.tsx`) de página dinâmica; o clique ainda espera os dados.

## Decisão

1. **Funções em `gru1`** (`vercel.json` `regions`), junto do banco e do KV. Vale pra páginas, actions, rotas e crons. O middleware segue no edge.
2. **Cache do roteador ligado** (`experimental.staleTimes`): `dynamic: 300` (página visitada nos últimos 5 min reabre na hora, do cache) e `static: 60` (página buscada inteira pelo `IntentLink` vale 60 s).
3. **Releitura em segundo plano** (`components/revisit-refresh.tsx`, em toda página logada; `__tests__/revisit-refresh-coverage.test.ts` trava). Cada render do servidor manda um id novo; o cliente anota quando viu o id pela 1ª vez (`lib/nav/router-cache.ts`). Montar de novo um id já visto = veio do cache: se passou de 30 s, `router.refresh()` numa transição (a tela fica como está, só o que mudou troca, estado local preservado). Também ao voltar pra aba. Jogo ao vivo (`RevisitRefresh live`): relê sempre, e o "Atualizar placar" perdeu o próprio listener de aba (era o mesmo refresh duas vezes). A idade é medida só no relógio do navegador: relógio do celular errado não decide nada.
4. **`IntentLink` é o link do app** (`components/intent-link.tsx`; `next/link` direto é barrado no ESLint). Dois furos do cache do roteador do Next 15.5 (sem o `clientSegmentCache` experimental), achados medindo no navegador e conferidos no código do Next:
   - o prefetch automático do `Link` guarda, pra página dinâmica, só o esqueleto (`loading.tsx`) na entrada da URL. A navegação usa essa entrada, busca os dados à parte e não guarda: com um link visível pra URL, reabrir a página ia sempre ao servidor. O `IntentLink` desliga o prefetch automático (`prefetch={false}` por padrão);
   - a navegação sem prefetch é guardada com a chave SEM a query. URL com query (`/match/x?back=…`, todo jogo aberto de uma lista) cai na entrada sem query, reaproveita só o esqueleto e busca de novo. No clique, o `IntentLink` pede `router.prefetch(href, { kind: full })` antes da navegação: a fila do roteador roda as duas em ordem, é uma requisição só, e a busca completa é guardada com a query.

   E a **busca por intenção**: mouse parado 120 ms em cima de um link → a mesma busca completa antes do clique. Só com `hover: hover` (no toque o `mouseenter` emulado chega junto do clique). A mesma URL não é buscada de novo por 30 s.
5. **Frescor depois de gravar.** Server action com `revalidatePath` e `router.refresh()` limpam o cache do roteador inteiro (conferido no código do Next 15.5). Auditoria das gravações: só duas não limpavam — o "Analisar meu palpite" (sem `revalidatePath` de propósito) e o run do palpite pela rota de streaming (ADR 0064) quando falha no meio ou a pessoa sai da página. As duas chamam `markRouterCacheStale()`: o que já estava guardado relê quando reaberto, sem re-renderizar a tela atual.

## Medição no navegador

Build de produção local, Chromium, do clique até o conteúdo da página na tela. "Antes" simula a produção de hoje (banco a 120 ms por query, rede navegador↔servidor de 130 ms); "depois", funções em `gru1` (3 ms, 20 ms) com o cache.

| passo | antes | depois |
|---|---|---|
| abrir um jogo pela 1ª vez | ~540 ms | ~410 ms (+ o JS da página na 1ª vez da sessão) |
| voltar pra /jogos pelo menu | ~630 ms | ~60 ms |
| reabrir o mesmo jogo | ~500 ms | ~65 ms |
| abrir um jogo com o mouse parado em cima | ~500 ms | ~65 ms |
| botão voltar do navegador | ~40 ms | ~35 ms |

O que sobra na 1ª abertura de um jogo com o banco perto é render no navegador da página do jogo (a maior do app); fica como próximo passo se incomodar.

## Alternativas rejeitadas

1. **Cache de dados no servidor (`unstable_cache` com tags).** Com banco na mesma região, as queries custam milissegundos; cachear dados por usuário exigiria invalidar em cada gravação e cron (liquidação, odds, ao vivo), e um ponto esquecido mostra dado errado. O ganho não paga o risco.
2. **Releitura a cada reabertura, sem limite de idade.** `router.refresh()` limpa o cache do roteador inteiro no Next 15: reler sempre faria a próxima página voltar a esperar o servidor. Com 30 s, a navegação rápida de ida e volta fica toda no cache.
3. **`prefetch={true}` nos links.** Buscaria a página inteira de cada jogo visível na lista (até 100), com render no servidor e checagem de odds de cada um. Por intenção, só o que a pessoa aponta.
4. **`unstable_dynamicOnHover` do `Link` / `clientSegmentCache`.** Experimentais no 15.5; o `IntentLink` resolve com `router.prefetch`. Ao subir de versão do Next, rever se os dois furos acima continuam (o teste de cobertura e o ESLint seguem valendo).

## Consequências

- Reabrir página visitada nos últimos 5 min é instantâneo; com mais de 30 s ela se atualiza sozinha logo depois.
- Busca por intenção de jogo pré-jogo pode refrescar odds como uma visita faria (mesma janela de 30–60 min por liga, mesmo custo de uma visita). O tempo parado de 120 ms evita disparos de passagem.
- Região `gru1` custa mais por hora de função que `iad1` na tabela da Vercel; no volume de um usuário, centavos. Chamadas à Anthropic e às APIs de futebol saem de São Paulo (alguns ms a mais numa chamada de segundos).
- Página logada nova precisa do `<RevisitRefresh />` (o teste de cobertura cobra); link interno novo usa `IntentLink` (o ESLint cobra).
- Sem o prefetch automático, a lista de jogos não dispara mais uma requisição por linha visível (eram até dezenas por visita a /jogos). No celular, o esqueleto aparece depois da 1ª resposta do servidor (uma ida e volta), não no toque.
- Se o projeto mudar de banco ou região, mova as funções junto.
