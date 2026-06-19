# DISCOVERY — Performance, custo de IA e escala (pré-SEO)

> Documento de followup pra um `/grill-with-docs` → `/to-issues`. Aterrado no código real
> (investigação multi-agente, 2026-06-19) + pricing Anthropic autoritativo. **Não é spec** —
> é o mapa do terreno + as alavancas + as perguntas em aberto. Números marcados *(estimado)*
> têm a fonte da verdade em `ai_calls.costUsd` — **medir antes de decidir** (§0).

## 0. Meça primeiro (a verdade já está logada)

Toda chamada de LLM loga o custo REAL em `ai_calls.costUsd` (`calculateCost(model, in, out)`,
`lib/ai/models.ts`). Antes de qualquer estimativa, rode:

```sql
SELECT model_version,
       count(*)                      AS calls,
       round(avg(cost_usd)::numeric, 5) AS avg_usd,
       round(sum(cost_usd)::numeric, 2) AS total_usd,
       round(avg(input_tokens))      AS avg_in,
       round(avg(output_tokens))     AS avg_out
FROM ai_calls
GROUP BY model_version ORDER BY total_usd DESC;
```

Isso dá o custo/chamada REAL (as estimativas abaixo variam ~3× conforme a suposição de tokens).
Re-análise por jogo (pra ROI do cache, §3): `SELECT match_id, count(*) FROM predictions GROUP BY 1 HAVING count(*) > 1`.

### Resultados — MEDIDO 2026-06-19 (12 dias; 95 chamadas; $1.88 total; 6 usuários)

| modelo | calls | **avg/call** | total | avg_in | avg_out |
|---|---|---|---|---|---|
| Sonnet 4.5 (default) | 43 | **$0.0169** | $0.72 | 3368 | 449 |
| Sonnet 4.6 | 20 | $0.0274 | $0.55 | 1683 | 1488 |
| Opus 4.8 | 9 | $0.0461 | $0.42 | 2802 | 1285 |
| Haiku 4.5 | 22 | **$0.0056** | $0.12 | 3144 | 481 |

- **Custo NÃO é o gargalo.** Haiku ≈ **⅓** do Sonnet 4.5 ($0.0056 vs $0.0169) → Haiku default corta ~⅔. Opus ≈ 2.7× Sonnet. Burn real ≈ **$0.16/dia (~$4.7/mês)** num período PESADO de teste → **$20 dura meses**.
- **Clustering de re-análise (keystone do cache §4):** 16/20 jogos têm >1 predição; **65/69 predições (94%) caem em jogos re-analisados**; máx **14** num jogo só. Na chave estrita `(jogo, modelo, prompt)`: 24 predições → 9 chaves = **~22% seriam cache-hit já hoje, solo.** → **REFUTA o "solo HOJE não ajuda" do §4.** Há clustering massivo (boa parte é teste de modelo/prompt — que a chave do cache segmenta corretamente). ROI existe hoje e CRESCE com público.
- **Override de modelo = 38% das predições** (Opus 13% · Haiku 12% · Sonnet-4.6 12%). Hoje é ruído de teste do dono, MAS o picker é visível a **TODO** usuário (não admin-only) → cache-per-default só rende se o registry encolher OU o override virar admin-only (§6 / grill Q3).

### Correções ao mapa — VERIFICADO no código 2026-06-19

- **Vercel = Pro** (4 crons + `maxDuration=300` no match page + Sentry cron monitors). #2 (concorrência) é real mas o teto Pro é alto.
- **Registry tem 5 modelos** (não "Opus admin-only"): Opus 4.8 · Sonnet 4.6 · **Sonnet 4.5 (default)** · Haiku 4.5 — TODOS `userSelectable` por QUALQUER usuário (#240/#241); só **GPT-5-mini é admin-only**. **Fable-5 foi REMOVIDO (#241).** "Registry mínimo" (§6) = dropar Opus + Sonnet 4.6 + GPT-5-mini.
- **`effort` já é roteado só pros modelos `adaptive`** (Opus, Sonnet 4.6) no `request-builder`; Sonnet 4.5/Haiku usam `temperature` (=0.30). **NÃO há risco de "erro na API"** — o código já trata. Determinismo se ajusta pela temperatura.
- **Fan-out (`analyzeBestBet` — o HERO palpite-first LIVE) cobra 1 slot/run** (até 6 `predict()` pagos) — nuance §3 confirmada. Mas **`analyzeMarkets` (#245) já cobra 1 slot POR mercado.** Logo o lever "cost-proporcional" (§7.7 / Q5) é só sobre `analyzeBestBet`.
- **Quota da Odds API JÁ é rastreada** (`x-requests-remaining`/`x-requests-used` → `getLastOddsApiQuota()`) → o circuit-breaker (§7.3) já tem a fonte de dados.
- **Snapshot de odds NÃO tem coluna de versão/sequência** (só `capturedAt`) → confirma o pré-requisito do cache (§4 item 2 / Q4).
- **A ação de análise gateia INDEPENDENTE da página** (auth + access + rate-limit ANTES do spend) → "preview público sem botão de IA" é barato: tornar a página pública **não** expõe a ação paga (ela tem gate próprio).

## 1. Reframe central — auth é o escudo; SEO o remove

- **Hoje:** o middleware (`middleware.ts`) gatekeepa TUDO exceto `/signin`, `/como-funciona`,
  `/api`, assets. Visitante anônimo → 307 pra `/signin`. **Logo: spike anônimo bate em páginas
  baratas; não toca Odds API / Neon pesado / IA.** O custo de IA é gated por usuário (20/dia).
- **Mas é por isso que não há SEO:** o Google não rastreia páginas gated. Pra ranquear "palpites
  copa do mundo" você precisa de **páginas PÚBLICAS** (landing/preview/jogo). Isso **remove o
  escudo** → tráfego anônimo passa a poder disparar os caminhos caros.
- **Conclusão:** "preparar pra SEO" e "aguentar um spike" são **o mesmo projeto**. As defesas
  (§5) têm que existir ANTES de abrir páginas públicas. Decisão de produto pendente: o que vira
  público (uma landing estática? o jogo inteiro? um preview sem o botão de IA?) — ver §6.

> **DECIDIDO (grill 2026-06-19): SÓ LANDING ESTÁTICA pública.** `/match`, palpites, dashboard
> seguem **gated** — o escudo de auth fica INTACTO. Consequência: o **spike anônimo não toca**
> os caminhos caros (Odds-API / Neon / IA) → as defesas de spike **perdem urgência** e viram
> higiene opcional. O cache compartilhado (§4) perde seu ROI principal (era o spike público-multi-
> usuário-no-mesmo-jogo, que agora não acontece). O que SOBRA de valor real: (a) **latência de load
> p/ usuários LOGADOS** (§5 — o jogo é lento por culpa própria, não por escala), (b) **construir a
> landing**, (c) **higiene de custo** (registry/Haiku §6). SEO = 1 página rankeável, sem long-tail.

## 2. "Quantos acessos derrubam o site?" — ordem de falha

O que quebra PRIMEIRO sob spike de usuários logados carregando jogos (+ alguns apertando o botão):

| # | Gargalo | Limite | Quebra em | Sintoma |
|---|---|---|---|---|
| 1 | **The Odds API (free)** | **500 req/mês** | ~100 req numa janela de spike → exausto em horas | "Nenhum bookmaker oferece este mercado", CTA desabilitada |
| 2 | **Vercel function concurrency** | ~10 concorrentes (Pro), `maxDuration=300` segura o slot | ~200-300 loads concorrentes | p95 de load explode (queue) |
| 3 | **Anthropic rate/budget** | per-user 20/dia; $20 saldo | só sob MUITO fan-out | erro genérico no fan-out; conta sobe |
| 4 | **Neon cold-start** | ~1s 1ª query | >50% cold (spike pós-ociosidade) | load p95 >5s ("lento", não "quebrado") |

**O #1 é o assustador.** Cada carregamento de jogo com odds stale (>30 min,
`ensureOddsSnapshotsFresh`) faz uma chamada à Odds API **e bloqueia o render do hero**. O gate de
freshness (30 min) **deduplica entre usuários concorrentes no MESMO jogo** — então o que liga o
contador é o nº de **jogos únicos** carregados, não o tráfego bruto. Fan-out adiciona até +4
créditos (additional markets). Hoje (círculo pequeno) está folgado (~16 req/dia de teto saudável);
público sem defesa, estoura.

## 3. "$20 da Anthropic — quanto dura?" *(estimado; confirme em §0)*

Pricing: **Haiku 4.5 = $1/$5** · **Sonnet 4.5 = $3/$15** (in/out por 1M tok) · Opus 4.8 = $5/$25.

- **Análise single-market (Sonnet 4.5):** ~$0.007–0.025/chamada (1,2k–5k in, 0,3k–1k out). O
  OUTPUT domina o custo (×5 do input). **Haiku faz a mesma análise por ~⅓.**
- **Síntese do palpite (Haiku):** ~$0.001–0.003 (desprezível).
- **1 run de fan-out (até 6 mercados + síntese):** ~**$0.05–0.15**.
- **$20 ≈** ~130–400 runs de fan-out, OU ~800–2.900 análises single-market.
- **Teto por usuário (rate-limit 20/dia):** 1 slot = 1 run inteiro de fan-out (até 6 predict
  pagos). 1 usuário maxando = ~$0.50–$3/dia. $20 dura **meses** num uso realista; ~1–6 semanas só
  se UM usuário maxar TODO dia (irreal). **Custo bem-controlado pelo cap por-usuário.** O risco é
  N usuários × fan-out simultâneo — e é exatamente o que o cache compartilhado (§4) neutraliza.

> ⚠️ Nuance herdada do handoff (`predictions.ts:404`): **1 slot autoriza um RUN inteiro** (até 6
> predict + créditos de odds), não 1 chamada. O teto 20/dia NÃO foi rederivado pro multiplicador.
> Hoje é o kill-switch (`enable_best_bet_fan_out`, ON). Alavanca: cobrar slots proporcionais OU um
> budget-check em $ no `analyzeBestBet` (§5).

## 4. "Cachear a análise e compartilhar entre usuários"

> **DECIDIDO (grill 2026-06-19): NÃO FAZER agora (dropado).** O ROI principal era o spike
> público-multi-usuário-no-mesmo-jogo. Com Q1 = **só landing estática** (§1), esse spike não
> acontece (escudo intacto). A medição (§0) mostra clustering real (~22% solo) MAS o dono é o
> único usuário real e **custo não é o gargalo** ($20 = meses) → o cache resolve um problema que
> não existe hoje. O seam de versionamento de odds (Q4) fica **moot** junto. Reabrir SE/quando
> jogos virarem públicos. O design abaixo fica registrado como referência pra esse futuro.

Você descreveu exatamente o design certo: *"análise com os mesmos parâmetros, igual pra todos,
só recomputa se o contexto (odds) mudar."* É **viável e de alto impacto**, e o ADR 0012 já
torna a análise **determinística** a partir de inputs IMUTÁVEIS congelados:
`(matchId, marketId, modelVersion, promptVersion, oddSnapshot)`.

**Hoje:** cada usuário que analisa cria uma `predictions` row própria (com `userId`) + dispara uma
chamada PAGA — mesmo que outro usuário tenha gerado a análise idêntica segundos antes. Zero dedup.

**Design (esboço):**
1. Tabela `shared_analyses` `UNIQUE(matchId, marketId, modelVersion, promptVersion, oddSnapshotId)`
   guardando o output (rec/edge/rationale/keyFactors). `predictions` por-usuário vira FK pra ela.
2. **Versionar o snapshot de odds** (coluna `oddSnapshotId`/sequência) — hoje só congela
   `oddAtRecommendation`, sem "número de versão". É o pré-requisito da invalidação determinística.
3. `predict()` consulta `shared_analyses` ANTES do LLM; hit → reusa o output + cria a `predictions`
   row do usuário linkada (preserva settlement/Yield por-usuário). Miss → gera + grava o shared.
4. Feature-flag (igual `enable_best_bet_fan_out`), default OFF, liga após validar hit-rate.
5. Chave inclui `modelVersion` (cache-per-model) OU força modelo default (Sonnet/Haiku) e o override
   vira só display.

**Impacto:** spike de 10 usuários no mesmo jogo (odds estáveis) → **1 chamada paga em vez de 10**
+ 9 inserts e 9 decrementos de rate-limit poupados. O custo passa a escalar com **JOGOS**, não com
**usuários × jogos** — a alavanca que torna o público viável.

**ROI condicional (precisa de telemetria, §0):** só compensa se houver **clustering** de re-análise
(>~40% hit). **Pra você solo HOJE, não ajuda** (você é o único usuário, sem duplicatas) — é uma
alavanca de "construir ANTES de abrir". **Blockers:** versionamento de odds (item 2); ambiguidade
do override de modelo; UI tem que deixar claro "análise compartilhada" (transparência); settlement/
Yield com N usuários → 1 análise.

## 5. "Load do jogo está lento" — por quê (e os fixes)

**O jogo importado SIM carrega do DB** (`getMatchById`). A lentidão é outra coisa:

- **BLOQUEANTE:** `ensureOddsSnapshotsFresh` (`page.tsx:76`) — se as odds estão stale (>30 min),
  chama a **Odds API ao vivo e SEGURA o render do hero**. + `Promise.all` de 5 queries + **Neon
  cold-start ~1s**. Load frio com odds stale ≈ **1–1,6s** até o hero; quente ≈ 50–150ms.
- **Form/H2H/standings/lineups:** vêm de provider (api-football) MAS estão em `<Suspense>` (não
  bloqueiam — streamam) e em cache **in-memory** que **morre a cada cold start** (`lib/cache/
  in-memory.ts` diz literalmente "Swap with Vercel KV in a future issue").
- 2 pares de queries são **sequenciais** (`getPredictionHistoryForMatch`, `getPalpiteSetsForMatch`:
  sets→linhas) — paralelizáveis.

**Fixes (baratos→médios):**
- **(A) Tirar o refresh de odds do request path:** cron a cada 5–10 min pré-aquece as odds dos jogos
  das próximas 48h; a página só LÊ do DB (~100ms), nunca dispara a Odds API no load. *(alto impacto:
  mata o gargalo #1 E o #2 de uma vez)*
- **(B) ISR** (`revalidate=3600`) na home + jogo: 1 pré-warm/hora em vez de por-load. *(baixo esforço,
  alto impacto — 50–80% menos Odds API sob spike)*
- **(C) Vercel KV** pro SportsDataProvider (sobrevive cold start, dedup cross-request).
- **(D) Paralelizar** as 2 queries sequenciais (Promise.all). *(20–50ms)*
- **(E) Alargar a janela de freshness** de 30→45–60 min pra jogos >24h.

## 6. Estratégia de modelo & "modelo free local na Vercel?"

> **DECIDIDO (grill 2026-06-19):** enxugar o registry pra **Sonnet 4.5 (DEFAULT) + Haiku 4.5**;
> **dropar Opus 4.8 + Sonnet 4.6 + GPT-5-mini** (entradas do registry). **Sonnet 4.5 SEGUE
> default — NÃO Haiku-default:** custo não é o gargalo (§0), então defaultar pro modelo mais fraco
> trocaria QUALIDADE de análise (o core value) por uma economia irrelevante. Haiku fica como opção
> selecionável barata/rápida. **Preserva:** o seam `AIProvider` (ADR 0027) intacto (só remove a
> entrada OpenAI do registry — re-adicionar provider depois é barato, esse é o ponto do seam);
> determinismo por `temperature=0.30` (já configurado; 4.5/Haiku não usam `effort`). **Padrão de
> remoção graciosa de modelo já existe** (#241 removeu Fable; predições antigas ainda exibem) —
> seguir o mesmo (predições com opus/sonnet-4.6 antigas continuam exibíveis).

- **"Só Haiku 4.5 + Sonnet 4.5" (mais barato + determinístico):** restringir o registry
  (`lib/ai/models.ts`) a esses dois — dropar Opus e a opção OpenAI admin-only/inerte do seam multi-AI.
  Mudança de config, baixo risco. **Atenção:** 4.5 **não aceita** o parâmetro `effort`/adaptive
  (erro na API) — determinismo se controla pela **temperatura** (`ai_config.temperature=0.30`;
  baixar → mais determinístico E mais cache-friendly no §4). **Haiku como DEFAULT** já corta ~⅔ do
  custo de IA.
- **Outras providers (sem quota/key hoje):** **não adicionar agora.** O seam `AIProvider` (ADR 0027)
  já existe → adicionar depois é barato. Opções FREE/baratas reais quando quiser uma key: **Google
  Gemini Flash** (free tier generoso), **Groq** (Llama free tier, rápido), **OpenAI gpt-5-mini**.
  Decisão por-provider exige ADR (checklist do repo).
- **"Rodar um modelo free LOCAL na Vercel?" → Não, inviável.** Funções serverless/edge não têm GPU,
  têm ~1–3GB RAM, bundle ≤250MB e janela curta. Um modelo real (mesmo pequeno) não cabe nem entrega
  qualidade; um WASM/transformers.js seria fraco, lento e estouraria o bundle. **O "free" realista
  é:** (a) o **cache compartilhado** (§4, elimina a chamada), (b) **Haiku default** (§6), (c) **prompt
  prefix caching** da Anthropic — o contexto match/odds compartilhado entre os N mercados do fan-out
  cacheia o INPUT (~0.1× no trecho repetido; reads 0.1×, writes 1.25×/5min), (d) um **free API tier**
  (Gemini/Groq) via o seam — "free model" rodando na infra DELES, chamado da Vercel, não "local".

## 7. Backlog — PÓS-GRILL (2026-06-19): 8 propostos → 4 sobrevivem

O grill colapsou o backlog. **Cost não é o gargalo + escudo intacto (Q1 = só landing)** dropou
metade. O que vira issue no `/to-issues` (ordenado por impacto ÷ esforço):

> **CRIADAS (2026-06-19):** #371 (prewarm) · #372 (paralelizar+freshness) · #373 (landing) ·
> #374 (registry-trim). Todas AFK, independentes (sem blockers entre si).

1. **`perf`/odds-prewarm-cron** (§5 A) → **#371** (`infra`,`ops`) — cron pré-aquece as odds dos jogos das próximas ~48h; o
   match page só LÊ do DB e **nunca dispara a Odds-API no load** (mata o `ensureOddsSnapshotsFresh`
   bloqueante — o maior ofensor de latência pro logado). *(alto impacto / médio esforço)*
2. **`perf`/paralelizar queries sequenciais + alargar freshness** (§5 D+E) — `Promise.all` nos 2
   pares hoje sequenciais; janela 30→45-60min p/ jogos >24h. *(baixo esforço; tira ~20-50ms +
   menos refresh)*
3. **`product`/construir a landing estática pública** (Q1 / §1) — a superfície pública decidida +
   entregável de SEO. Página estática, sem `auth()`, sem caminho caro. *(decisão do dono → build)*
4. **`ai`/enxugar registry → Sonnet 4.5 (default) + Haiku 4.5** (§6 / Q3) — dropar Opus + Sonnet 4.6
   + GPT-5-mini do registry; manter seam ADR 0027; seguir o padrão de remoção graciosa do #241.
   *(higiene; NÃO mexe no default-Sonnet)*

### Dropados / resolvidos no grill (NÃO viram issue)

- ~~medir (§7.1 original)~~ → **FEITO** nesta sessão (resultados no §0). Não vira issue.
- ~~circuit-breaker Odds-API (§7.3)~~ → **dropado**: sem caminho caro público, sem spike a defender
  (a quota já é rastreada via `getLastOddsApiQuota` se precisar depois).
- ~~Vercel KV pro SportsDataProvider (parte do §7.4)~~ → **dropado**: form/H2H já streamam em
  `<Suspense>` (não bloqueiam); cache in-memory basta p/ ~6 logados. Reabrir se virar público.
- ~~cache compartilhado + ADR (§7.6) + versionar odds (Q4)~~ → **dropado** (ver §4).
- ~~budget-check + fan-out proporcional (§7.7 / Q5)~~ → **dropado**: cap 20/dia já controla; custo
  não é gargalo. (`analyzeMarkets` já cobra por-mercado; só `analyzeBestBet` é 1-slot/run — aceito.)
- ISR (parte do §7.2 original) → **dropado**: páginas de jogo seguem gated (ISR pouco rende em rota
  com `auth()`); a landing é estática pura, não precisa de ISR.

## 8. Perguntas — RESOLVIDAS no grill (2026-06-19)

- **Alvo de SEO?** → **Só landing estática** pública; jogos/palpites seguem gated (escudo intacto).
  §2/§5-spike viram higiene não-urgente; sobra perf-de-load pro logado. *(Q1)*
- **Hit-rate de re-análise real?** → **MEDIDO** (§0): 94% das predições em jogos re-analisados,
  ~22% redundância na chave estrita solo. Mas cache **dropado** (sem público, custo não é gargalo). *(Q2)*
- **Override de modelo é comum?** → **38% das predições** hoje, mas é ruído de teste do dono; o
  picker é visível a todos. Resolvido enxugando o registry (não cache-por-modelo). *(Q3)*
- **Manter Opus?** → **Não.** Registry → Sonnet 4.5 (default) + Haiku 4.5; dropar Opus/Sonnet-4.6/
  GPT-5-mini. *(Q3)*
- **Plano Vercel?** → **Pro confirmado** (4 crons + maxDuration=300 + Sentry monitors). *(verificado)*
- **Reduzir `maxDuration` (300s)?** → **Não agora.** A landing estática não usa o fan-out longo; o
  match page (gated) ainda roda `analyzeBestBet` no caminho. Reavaliar se o prewarm tirar o fan-out
  do request path — fora de escopo deste backlog.
```
