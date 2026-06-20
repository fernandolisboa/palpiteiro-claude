# ADR 0035 — Compartilhamento público de palpite: snapshot read-only manchete-only

## Status

Accepted (2026-06-20) — primeira superfície PÚBLICA de **conteúdo** além da landing estática (#373).
Decidida no grill 2026-06-19 (#383, esta ADR; build em #384). **Não cria mercado, liga nem provider
novo** (fora do gate do CLAUDE.md). Complementa os ADRs 0030/0031/0032 (manchete congelada + firewall
de linguagem de valor + `sources` citáveis) e **emenda** a decisão "só landing estática pública" da
discovery de perf/custo (`docs/discovery/perf-cost-scaling.md:62-68`, §1) — passa a ter uma 2ª exceção.

> **Escopo:** uma página pública `/p/[id]` que renderiza um **snapshot read-only, imutável e
> manchete-only** de um palpite, + a imagem Open Graph do unfurl. SEM odds/EV/edge/stake/detalhe de
> análise; SEM campos de proveniência. Conteúdo, projeção de campos, hardening de `sources`, postura
> regulatória e a emenda ao escudo de auth ficam fixados aqui pra #384 não re-derivar.

## Contexto

A manchete palpite-first (ADR 0030 / #353) é gravada **uma vez** na síntese, no jsonb
`palpite_sets.headline` (`db/schema.ts:419-430`), e é **imutável** — revisão = novo set
(`db/schema.ts:404-414`). É **firewall-clean por construção** PARA LINGUAGEM DE VALOR: o gerador roda
`containsValueLanguage` sobre os campos de texto GERADOS pela LLM que cruzam pra view (`verdict`,
`narrative`, o `text` de cada linha settleable, e cada `citedMarkets`) ANTES de persistir; qualquer hit
lança e degrada pra `palpite:null` (`lib/ai/palpites/index.ts:316-320`, `value-language-guard.ts`).
Esse guard pega edge/EV/odd/stake/Yield/R$ — e SÓ isso. **Não** policia: (a) `sources` (`{title,url}`
é tool output, NUNCA cruza o guard — `palpites-headline.ts:43-46`); (b) linguagem de **seleção** de
aposta (uma `citedMarkets` pode ser literalmente `"Mais de 2.5"` — o exemplo canônico do próprio código,
`cartridge.ts:95` — que é uma LINHA de aposta, não uma categoria de mercado, e passa o guard de valor
ileso). Essa distinção é load-bearing pra esta ADR (§Decisão 2).

Hoje o app inteiro é gateado pelo middleware (`middleware.ts:34-36`): visitante anônimo → 307 pra
`/signin`. As únicas exceções são `/`, `/signin`, `/como-funciona`, `/api`, `/monitoring`, assets.
A discovery de perf/custo decidiu "SÓ LANDING ESTÁTICA pública" (`perf-cost-scaling.md:62-68`) — o
escudo de auth protege os **caminhos caros** (Odds-API bloqueante via `ensureOddsSnapshotsFresh` e
IA via `analyzeBestBet`, ambos no load de `/match` — `app/match/[id]/page.tsx:64-110`).

O pedido (#383) é deixar o usuário **compartilhar um palpite** num link público que dá unfurl no
zap/redes. Isso cria a **primeira superfície pública de conteúdo** — e com ela, decisões novas: qual
subconjunto da manchete vaza, como não vazar proveniência, como tratar `sources`/`citedMarkets` numa
superfície anônima, e qual a postura regulatória de uma página que um anônimo (inclusive menor) pode
abrir sem o footer/login que normalmente carregam o contexto 18+/não-operador
(`docs/ops/05-legal-compliance.md:11-15`, `:37-67`, `:92-118`, `:251-256`).

A view autenticada já resolve a maior parte: `toPalpiteHeadlineViewFromSet` (`palpites-headline.ts:114`)
mapeia o set persistido pra `PalpiteHeadlineView` (`:27-48`), que **hand-picka** só os campos da
manchete e **nunca** copia `sourcePredictionIds` nem qualquer coluna de proveniência (`:62-65`). O
placar provável **não mora** no headline jsonb — vira a linha `palpites` com `type='exact_score'`,
`params={home,away}` (`db/schema.ts:417-418`, `:478-483`); o mapper lê dela via `safeParse` e retorna
`null` (prefer-skip) quando falta (`palpites-headline.ts:117-121`). Mas a entrada do mapper é a row
CRUA `PalpiteSetWithLines` (= `$inferSelect`, `palpites.ts:33-50`), que ainda carrega `userId` e o
jsonb com `sourcePredictionIds` — a anonimidade só vale se a projeção acontecer ANTES de cruzar pro
cliente, e se a MESMA projeção alimentar tanto o corpo quanto o `generateMetadata`/OG (§Decisão 3).

## Decisão

**1. Superfície: `/p/[id]` servida pelo UUID do `palpite_set`, read-only.** O `id` é
`uuid().primaryKey().defaultRandom()` (`db/schema.ts:435`) — v4 aleatório, **não-enumerável**, sem
tabela de token. A rota é um **read puro de DB**: NÃO chama `auth()` (o dado é lido por id, não por
viewer), NÃO toca Odds-API, NÃO dispara IA — uma `palpite_set` row por id + suas linhas `palpites`
(a `exact_score` pro placar) + a `matches` row pros nomes/liga/placar final. Precisa de uma **query
nova, narrow, por `setId`** — a existente `getPalpiteSetsForMatch` (`lib/db/queries/palpites.ts:87-100`)
é escopada por `(matchId AND userId)` e traz histórico/userId; reusá-la vazaria/exigiria userId. Times +
crest/bandeira são derivados por **função pura** sobre `homeTeam`/`awayTeam`/`league`
(`lib/view/team.ts:155-165`) — NÃO há coluna de crest no DB; bandeiras de Copa são SVG vendorizado local
(`public/flags/wc/*.svg`), zero fetch externo.

**2. Conteúdo: manchete-only — exatamente os campos de `PalpiteHeadlineView`, com `citedMarkets`
normalizado.** A página pública roda o **mesmo** `toPalpiteHeadlineViewFromSet` e renderiza só:
   - **(a)** veredito (`verdict`), confiança qualitativa (`baixa`/`media`/`alta` — NUNCA dígito/%),
     narrativa (`narrative`), placar provável (`probableScore`, lido da linha `exact_score`), times
     (nome + short + hue + flag), e — quando o jogo está liquidado — o badge acertou/errou (`won`/`lost`)
     + o **placar final real** (`matches.homeScore`/`awayScore`, `db/schema.ts:239-240`; placar é fato,
     não previsão, firewall-safe). A "ficha" `dimensions` (`palpites-headline.ts:39`) **ENTRA**: os
     rótulos são templates fixos, firewall-clean por construção (mesma garantia de `citedMarkets`).
   - **(b)** `citedMarkets` **ENTRAM, mas NORMALIZADOS pra CATEGORIA de mercado na fronteira pública.**
     O valor cru pode ser uma LINHA de aposta (`"Mais de 2.5"`, `"Ambas marcam: Sim"` —
     `cartridge.ts:95`), que numa superfície anônima lê como "aqui está a aposta", não como sinal de
     contexto. Um normalizador **público-only** na projeção mapeia linha→categoria (`"Mais de 2.5"` →
     `"Total de gols"`; `"Ambas marcam: Sim"` → `"Ambas marcam"`); rótulos que já são categoria passam
     verbatim. Preserva o sinal "o palpite olhou estes mercados" e **mata a leitura "place esta aposta
     exata"**. (O HERO autenticado segue exibindo o rótulo cru — `palpite-hero.tsx:189-193` — porque ali
     o usuário já clicou "Analisar" e vê a análise; a superfície pública é tier mais alto, §Decisão 5.)
   - **(c)** `sources` (notícias `{title,url}`, ADR 0032) **ENTRAM na PÁGINA, hardened** (§Decisão 4) —
     **NUNCA na imagem OG**. São tool output não-guardado; numa superfície pública precisam de
     saneamento explícito antes de virar link clicável.
   - **(d)** **FORA, sempre:** odds, EV, edge, stake, Yield, R$, %, e todo o detalhe de análise por
     mercado (`predictions`/`analysis-result.tsx` — a página pública não toca essas tabelas), o CTA
     "Analisar com IA" (a ação paga), e qualquer timestamp de geração/criação (sem "gerado em…" — o
     `createdAt` é metadado de comportamento do usuário; a view já o omite, manter omisso na página E na OG).
   - **(e)** **Fallback gracioso — 404 nos TRÊS gatilhos, nunca 500 nem palpite parcial:** (i) `id`
     reprova um guard de forma UUID (validar via `z.string().uuid()` ANTES da query — um `WHERE id =
     'lixo'` numa coluna `uuid` lança `22P02` = 500); (ii) UUID válido sem row correspondente; (iii)
     `toPalpiteHeadlineViewFromSet` retorna `null` (set pré-#353 sem headline OU sem `exact_score` válido
     — `palpites-headline.ts:117-121`). Qualquer um dos três → `notFound()`. Mesma garantia prefer-skip
     do HERO.

**3. Projeção de campos seguros (privacy) — projetar no MAPPER, alimentar corpo E metadata da MESMA
projeção.** A invariante real **não** é "a query seleciona só colunas seguras" (a query roda
`$inferSelect` → row crua, pra reusar o mapper verbatim); é **projetar no boundary do mapper e nunca
passar a row crua adiante**. Regras duras pra #384:
   - **(a)** A rota constrói `PalpiteHeadlineView` SERVER-SIDE e **só ela** cruza qualquer fronteira de
     cliente. A row `PalpiteSetWithLines`/`DbPalpiteSet` (que carrega `userId` + o jsonb com
     `sourcePredictionIds`) **NUNCA** é passada a um Server Component como props nem a um boundary
     `'use client'`. `userId`/`aiCallId`/`modelVersion`/`promptVersion` são COLUNAS de `palpite_sets`
     (`db/schema.ts:439-447`), ausentes da view; `sourcePredictionIds` vive DENTRO do jsonb
     (`db/schema.ts:424`) e o mapper nunca o copia (`palpites-headline.ts:62-65`).
   - **(b)** **NUNCA** serializar o `headline` jsonb verbatim (nem `JSON.stringify(headline)`, nem
     `...headline` espalhado num payload OG, nem `?raw=1` de debug). "Strippar `sourcePredictionIds`" é a
     AUSÊNCIA de cópia — protegida só por convenção. Por isso é **MANDATÓRIO um teste de asserção
     negativa**: pra uma fixture cujo `headline` CARREGA `sourcePredictionIds`, nenhum byte da resposta
     pública (HTML + payload OG) pode conter `sourcePredictionIds`/`userId`/`aiCallId`/`modelVersion`/
     `promptVersion`. Esse teste é o que torna "o strip é explícito" verdadeiro.
   - **(c)** O **`generateMetadata`/OG é alimentado dos MESMOS campos de `PalpiteHeadlineView`**
     (`verdict`/`probableScore`/`confidence`/`teams`), NUNCA da row crua. `og:title`/`og:description`/
     `alt`/twitter MUST ter a projeção como fonte única — fechar a fresta onde #384 monta a metadata "à
     mão" e arrasta `userId`/`createdAt`/`set.id` "pra contexto".
   - **(d)** **Anonimato confirmado:** não há campo de texto livre escrito pelo usuário em lugar nenhum
     do pipeline (o usuário só clica "Analisar"); `verdict`/`narrative`/`citedMarkets` são síntese da LLM
     **sobre a partida**, nunca sobre o usuário. O snapshot é anônimo no identificador (UUID) E no conteúdo.
   - **(e)** **Publicação é opt-in por palpite via flag persistida (LGPD).** Tornar um palpite público é
     **novo propósito de tratamento** (divulgação pública) além do "operar o app pro usuário logado".
     A base legal só fica limpa se a publicação for um ESTADO que o usuário ativou — não "a URL sempre
     existiu". Decisão: a rota resolve um set **apenas se uma coluna nullable `shared_at` (timestamptz)
     em `palpite_sets` estiver setada**; sem ela → `notFound()`. O gesto "compartilhar" seta
     `shared_at` (e revela a URL). Isso (i) torna o opt-in um estado real, não obscuridade-por-UUID;
     (ii) dá um **kill-switch** (limpar `shared_at` despublica). Requer **migration** (coluna nullable
     aditiva, sem backfill — nenhum set é público por default). #384 a roda.

**4. Hardening de `sources` na fronteira pública (não viaja pra OG).** `sources` é tool output que
NUNCA passou pelo firewall de valor nem por validação de URL (`url` é só `z.string().min(1)`,
`cartridge.ts:154`). Numa superfície anônima isso é (i) um `title` livre que pode conter linguagem de
valor/nome de operador ("Bet365 paga 3.5 no over"), e (ii) um `href` pra domínio arbitrário escolhido
por LLM, sob a marca Palpiteiro. Regras duras pra #384:
   - **(a)** Rodar `containsValueLanguage` sobre cada `sources[].title` na projeção pública; **título com
     hit é DROPADO** (skip-não-vaza, zero infra nova). Recomendado também um denylist mínimo de nome de
     operador.
   - **(b)** Validar `url` é **`https:`**; **strippar query/fragment**; renderizar **hostname-only** ou
     título-only; `rel="noopener noreferrer nofollow"` (hoje só `noopener noreferrer` —
     `palpite-hero.tsx:493`). URL que não case → fonte vira texto não-linkado.
   - **(c)** A imagem OG **NUNCA** inclui `sources` (nem título nem URL).
   - **(d)** A resposta de `/p/[id]` define **`Referrer-Policy: no-referrer`** (ou `same-origin`) — sem
     isso, um clique numa `source` vaza a própria URL `/p/[id]` no header `Referer` pro site de notícia.

**5. Disclaimer + firewall viajam com a página E com a imagem OG; a OG tem guard MECANIZADO.** A manchete
pública herda o firewall do ADR 0030 (sem linguagem de valor) e re-renderiza um subconjunto estrito de
campos já guardados. O único lugar onde uma superfície nova PODE reintroduzir linguagem de valor é a
**geração da imagem OG** (texto rasterizado em PNG é invisível a guard de string) — então a regra "OG é
firewall-bound" precisa de **mecanismo, não promessa**:
   - **(a)** Os textos compostos na imagem OG vêm de uma **constante tipada `OG_TEXT_PIECES`** (array das
     strings exatas que entram no `ImageResponse`), todas oriundas de `PalpiteHeadlineView` (sem nova
     interpolação). Um **teste** (i) roda `containsValueLanguage` sobre cada peça e (ii) asserta que o
     token de disclaimer (§b) é membro do array. Guarda os INPUTS da imagem mesmo sem poder inspecionar
     o PNG — mesma disciplina do teste de HTML do HERO (`palpite-hero.test.tsx:186,208-209`).
   - **(b)** A OG renderiza SÓ campos firewall-clean: veredito, placar provável **como placar, nunca como
     valor/odd/payout**, confiança qualitativa, badge. NÃO puxa de `predictions`/edge/EV/odd/stake, NÃO
     inclui `sources`.
   - **(c)** O **disclaimer** viaja com AMBOS. Na página (o anônimo/unfurl-clicker chega sem o footer
     autenticado): o `PALPITE_DISCLAIMER` ("É só um palpite, não é recomendação de aposta." —
     `palpites-headline.ts:16-17`, invariante ADR 0031 §5) + o aviso de risco/jogo responsável do §3 legal
     ("Aposta não é investimento… não garantem resultado… aposte com responsabilidade…" —
     `05-legal-compliance.md:102-105`) + o contexto não-operador/18+/CVV que o footer normalmente carrega
     ("ferramenta de análise, não é casa de apostas", selo 18+, CVV 188 — `:251-256`). Na imagem OG: um
     strip persistente **"18+ · não é recomendação de aposta"** + a marca enquadrada como análise
     (derivado de `PALPITE_DISCLAIMER` + token 18+, fonte única — sem literal solto que possa driftar).
     A OG é o que mais gente vê (preview do zap/Twitter); dropar o disclaimer ali é a maior exposição.
   - **(d)** **Contrato de render testado na página pública** (nova superfície, sem cobertura): um teste
     `toContain` asserta que os três blocos de disclaimer (PALPITE_DISCLAIMER + risco §3 + não-operador/
     18+/CVV) estão no HTML renderizado — mesma disciplina de `landing-page.test.tsx:34-36`.

**6. Postura de indexação: `noindex` (meta + header) + card OG completo, veredito como imagem.** A página
define `robots: { index: false, follow: false }` no `generateMetadata` **E** envia
**`X-Robots-Tag: noindex`** como header HTTP (o meta-tag só vale se o crawler renderizar; o header é o
sinal forte pros bots que só fazem fetch) — aplicado tanto a `/p/[id]` quanto à rota OG (a própria
imagem não deve ser indexável como URL avulsa que expõe o veredito). Mas com `openGraph`/`twitter`
completos: scrapers de unfurl leem OG e ignoram `robots` → **share viral 100% preservado**, página fora
do índice. Para não recriar via OG o corpus pesquisável que o `noindex` evita, o **veredito textual NÃO
vai em `og:description`** (texto de card é o que um scraper armazena/indexa) — `og:description` carrega
um enquadramento neutro ("Um palpite no Palpiteiro — análise, não recomendação"); o veredito/placar
aparecem **só na imagem OG** (não indexável como texto). Indexar tips individuais criaria um corpus de
aposta pesquisável por anônimos (inclusive menores via busca) — o salto pra "broadcast público" que o
legal sinaliza como mudança de patamar (`05-legal-compliance.md:11-15`). Indexabilidade fica **diferida**
pra decisão explícita de Fase 3 com revisão jurídica. **Emenda ao escudo:** `/p/[id]` + sua rota OG
entram na allowlist do middleware com anchoring seguro (§Consequências detalham o regex); `/match`,
palpites, dashboard e `/perfil` seguem **gated**.

## Consequências

- **(+)** Adiciona superfície de **share viral** (unfurl no zap/redes via OG) **sem reabrir o gargalo
  #1 (Odds-API) nem o gasto de IA**: o snapshot é read-only, imutável e **sem caminho caro no load**
  (zero `auth()`/Odds/IA) — mesma classe de custo da landing estática, não da classe de `/match`. A ação
  paga gateia INDEPENDENTE da página (`perf-cost-scaling.md:48`); a página pública não tem ação paga
  alguma. As defesas de spend (§5 da discovery) seguem não-urgentes.
- **(+)** **Reuso máximo, infra nova mínima:** a projeção pública É `PalpiteHeadlineView` via o mapper
  existente — `sourcePredictionIds`/`userId`/proveniência caem de graça; o firewall de valor já é
  garantido a write; crest/flag é função pura. Falta: a **query narrow por setId** (retorna
  `PalpiteSetWithLines` pra reusar o mapper), a rota `app/p/[id]/page.tsx`, a rota OG (`next/og`,
  built-in do Next 15, zero dep nova), o normalizador público de `citedMarkets`, o hardening de
  `sources`, o disclaimer composto, a coluna `shared_at` (migration) + gesto opt-in, e a emenda ao matcher.
- **(+)** Postura `noindex` (meta + `X-Robots-Tag`) + OG mantém o Palpiteiro do lado "ferramenta de
  análise" (não "publisher de tips indexados") sem advogado agora — o gate jurídico de Fase 3 destrava a
  indexação, não um default de engenheiro.
- **(−)** **A página pública é dinâmica + uncacheable por default** — o bloco de headers
  (`next.config.ts:36`) hoje aplica `Cache-Control: no-cache, must-revalidate` a `/p/*`, então cada scrape
  de unfurl e cada pageview re-bate no Postgres, e a rota OG roda `ImageResponse` (CPU Satori) toda vez,
  sem teto (sem rate-limit no caminho público — `lib/rate-limit.ts` só protege as ações pagas autenticadas).
  Individualmente é barato (Neon HTTP, SELECT indexado), mas um link viral é um flood anônimo sem freio.
  **Mitigação (parte do #384):** como o snapshot é IMUTÁVEL, ele é candidato ideal a cache de CDN —
  `export const revalidate = <N longo>` na página E na rota OG, e **excluir `/p/` do bloco `no-cache`**
  (adicionar `|p/` ao lookahead negativo de `next.config.ts:36`, espelhando `_next/`/`api/`/`monitoring`).
  Servir um snapshot congelado como `no-cache` é o erro de custo real; a OG vai `public, immutable`.
- **(−)** O escudo de auth ganha uma 2ª exceção pública — exige anchoring cuidadoso no matcher
  (`/perfil` compartilha o prefixo `/p`) **e** cobertura das rotas de imagem do Next 15. As convenções
  de metadata geram rotas SEPARADAS `opengraph-image` E `twitter-image` (e, com `generateImageMetadata`,
  um segmento extra `/0`). **Decisão pra fixar a âncora estreita:** o #384 usa **uma única imagem OG via
  o arquivo `app/p/[id]/opengraph-image.tsx`** (sem `generateImageMetadata`, sem `twitter-image`
  separado) e configura Twitter como `summary_large_image` apontando pro mesmo `og:image` (Twitter cai no
  `og:image` quando `twitter:image` falta). Com isso a âncora estreita basta:
  `p/[^/]+(?:/opengraph-image[^/]*)?$` (a `/` força passar de `/perfil`; `[^/]+` exige id não-vazio; o
  `$` impede filhos como `/p/x/edit`). Re-simulado com o conjunto completo — PÚBLICO: `/p/abc`,
  `/p/abc/opengraph-image`, `/p/abc/opengraph-image-a1b2c3?v=1`; GATEADO: `/perfil`, `/perfil/foo`, `/p`,
  `/p/abc/edit`, `/p/abc/delete`, `/p-foo`, `/perfilX`. **Gate de verificação no build:** conferir no
  output buildado que o path emitido da OG casa a âncora; se #384 precisar de `twitter-image`/
  `generateImageMetadata`, alargar pra `p/[^/]+(?:/(?:opengraph|twitter)-image(?:[^/]*|/[^/]+))?$` e
  re-simular os negativos — um miss = 307→/signin silencioso no scrape (mesmo modo de falha que o comentário
  de `/monitoring` documenta em `middleware.ts:13-16`). Os ADRs 0023/0007 (escudo de auth) seguem válidos
  — só a allowlist cresce.
- **(−)** Publicar um palpite vira **novo propósito de tratamento LGPD** (divulgação pública) — mitigado
  por: opt-in por palpite via `shared_at` (estado real + kill-switch) + projeção anônima (sem userId/PII,
  sem texto de usuário no conteúdo).
- **(±)** O disclaimer/firewall passam a ter superfícies a mais pra cobrir (a imagem OG, os textos de
  `sources`) — a OG é a de **maior exposição** (o que circula no zap), então o firewall é *mais*
  load-bearing aqui, não menos. A regra "OG é firewall-bound, com guard mecanizado sobre `OG_TEXT_PIECES`"
  e o hardening de `sources` são inegociáveis.

## Alternativas consideradas

1. **Servir o `headline` jsonb verbatim na rota pública** — **rejeitado**: vazaria
   `sourcePredictionIds` (proveniência interna, `db/schema.ts:424`). A projeção tem que passar pelo
   mapper/`PalpiteHeadlineView`, que descarta proveniência por construção — e alimentar TAMBÉM o
   `generateMetadata`/OG (§Decisão 3c), não só o corpo.
2. **Tabela de token de share (slug curto opaco)** — **rejeitado**: o UUID `defaultRandom` já é
   não-enumerável; a coluna `shared_at` (§Decisão 3e) dá o opt-in/kill-switch sem uma tabela nova de
   token/lifecycle.
3. **Página pública indexável (full SEO)** — **rejeitado por ora**: indexar tips individuais cruza pra
   broadcast público que o legal sinaliza como salto de patamar (`05-legal-compliance.md:11-15`); o valor
   viral é 100% OG. Diferido pra decisão de Fase 3 com advogado. (Daí também o veredito ficar na IMAGEM
   OG, não em `og:description` — pra não vazar o corpus pesquisável pelo texto do card.)
4. **Incluir `citedMarkets` cru / incluir `sources` sem saneamento por "passam o firewall de valor"** —
   **rejeitado**: o firewall de valor não cobre linguagem de SELEÇÃO de aposta (`"Mais de 2.5"`,
   `cartridge.ts:95`) nem conteúdo externo (`sources`, `palpites-headline.ts:43-46`). Na superfície
   anônima ambos precisam de tratamento: `citedMarkets`→categoria, `title` guardado + `url` validado/
   hostname-only/`nofollow`, `sources` fora da OG. Tirá-los inteiros empobreceria sem necessidade; o
   saneamento (§Decisão 2b/4) preserva o sinal e fecha o buraco.
5. **Opt-in = "só revelar a URL `/p/[setId]` que já existe" (sem flag)** — **rejeitado**: faria TODO
   palpite público no instante da geração, gateado só por obscuridade — não é opt-in (o usuário nunca
   "escolheu publicar") e qualquer set-id já exposto (log, URL antiga) viraria conteúdo público
   retroativo, sem revogação. A coluna `shared_at` torna a publicação um estado real e reversível.
6. **Reusar `getPalpiteSetsForMatch`** — **rejeitado**: escopada por `(matchId AND userId)`, traz
   histórico/userId (`palpites.ts:87-100`); precisa de query narrow por `setId` que retorna o mesmo shape
   `PalpiteSetWithLines` (pra reusar o mapper) mas não depende de userId.
7. **Tornar `/match` público (preview do jogo inteiro)** — **rejeitado**: o load roda
   `ensureOddsSnapshotsFresh` (Odds-API bloqueante) + `analyzeBestBet` (IA) — abri-lo re-exporia os
   caminhos caros que o escudo protege (`perf-cost-scaling.md` §2/§5). O snapshot `/p/[id]` é
   estruturalmente diferente: zero caminho caro.
8. **OG "firewall-bound" como requisito de prosa (sem teste)** — **rejeitado**: o PNG é invisível a
   `toContain`/guard de string; uma edição futura dropa o disclaimer ou compõe valor sem quebrar o build.
   `OG_TEXT_PIECES` + teste sobre os inputs dá teeth (§Decisão 5a).

## Referências

#383 (esta ADR) → #384 (build: `app/p/[id]/page.tsx` + `opengraph-image.tsx` + query narrow por setId +
coluna `shared_at`/migration + normalizador de `citedMarkets` + hardening de `sources` + emenda ao
matcher); ADR 0030 (palpite-first, manchete-only, headline congelado firewall-clean), 0031 (value-aware +
disclaimer invariante + firewall de linguagem de valor), 0032 (`sources` citáveis — decididos hardened
DENTRO do snapshot), 0023/0007 (escudo de auth via middleware), 0028 (palpite separado das recomendações
de valor). Código: `db/schema.ts:239-240` (placar final real), `:419-430` (PalpiteHeadline jsonb,
`sourcePredictionIds` a esconder em `:424`), `:435-447` (palpiteSets: UUID `defaultRandom` +
`userId`/`aiCallId`/`modelVersion`/`promptVersion` a NÃO projetar; `shared_at` a adicionar),
`:478-483` (params union do exact_score), `lib/view/palpites-headline.ts:16-17` (PALPITE_DISCLAIMER),
`:27-48` (PalpiteHeadlineView — a projeção anônima), `:39` (`dimensions`), `:43-46` (`sources` fora do
guard), `:62-85`/`:114-128` (mapper que descarta proveniência + prefer-skip null),
`lib/db/queries/palpites.ts:33-50` (`PalpiteSetWithLines`/`$inferSelect` — entrada CRUA do mapper),
`:87-100` (query userId-scoped a NÃO reusar), `lib/view/team.ts:155-165` (crest/flag pura, sem coluna de
DB) + `public/flags/wc/*.svg`, `lib/ai/palpites/index.ts:316-320` + `value-language-guard.ts` (firewall a
write — NÃO cobre `sources` nem seleção de aposta), `lib/ai/palpites/cartridges/cartridge.ts:95,154`
(`citedMarkets` pode ser linha `"Mais de 2.5"`; `url` só `min(1)`), `components/palpites/palpite-hero.tsx:189-193`
(citedMarkets cru no HERO authed), `:466-503` (CitedSources — `rel` a endurecer com `nofollow`),
`palpite-hero.test.tsx:186,208-209` (disciplina de teste de disclaimer a espelhar), `lib/rate-limit.ts`
(só ações pagas autenticadas — sem teto no caminho público), `middleware.ts:34-36` (matcher a emendar;
âncoras `$`/`(?:/|$)`), `next.config.ts:36` (bloco `no-cache` — excluir `/p/`; adicionar `X-Robots-Tag`),
`app/match/[id]/page.tsx:64-110` (caminhos caros que o snapshot OMITE). Docs:
`docs/discovery/perf-cost-scaling.md:62-68` (§1 escudo — **EMENDADO** com a 2ª exceção) + `:48` (a ação
paga gateia INDEPENDENTE da página), `docs/ops/05-legal-compliance.md:11-15` (gate de Fase 3/advogado),
`:37-67` (§1 não-operador / Lei 14.790), `:71-88` (§2 18+), `:92-118` (§3 jogo responsável + risco),
`:251-256` (footer: 18+/não-operador/CVV). CONTEXT.md (termo "Palpite compartilhado (snapshot público)"
— **adicionado nesta leva**). `next/og` (ImageResponse) é built-in do Next 15 — file-based
`app/p/[id]/opengraph-image.tsx`, zero dep nova; implementação (fontes/crest na OG) fica pro #384.
