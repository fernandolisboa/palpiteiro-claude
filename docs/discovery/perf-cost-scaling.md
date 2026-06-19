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

## 4. "Cachear a análise e compartilhar entre usuários" — SIM, sua intuição está certa

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

## 7. Backlog proposto (vira issues no `/to-issues`; tracer-bullet)

Ordenado por (impacto ÷ esforço). Cada um é um vertical slice candidato a issue:

1. **`discovery`/medir** — query `ai_calls.costUsd` + re-análise clustering (§0). Sela todas as
   estimativas. *(30 min; desbloqueia o resto)*
2. **`perf`/odds-prewarm-cron + ISR** (§5 A+B) — tira a Odds API do request path. *(alto impacto;
   pré-requisito de qualquer abertura pública)*
3. **`infra`/circuit-breaker da Odds API** — checar quota restante antes do pré-warm; <50 → modo
   degradado (featured-only, TTL 60min). *(crítico antes de público)*
4. **`perf`/Vercel KV** pro SportsDataProvider + paralelizar queries sequenciais (§5 C+D).
5. **`ai`/restringir registry a Haiku+Sonnet 4.5 + Haiku como default + baixar temperatura** (§6).
   *(corte direto de custo)*
6. **`discovery`+`adr`/cache de análise compartilhada** (§4) — exige ADR (modelo de dado +
   versionamento de odds + postura de UI "compartilhada"). *(maior, mas é A alavanca pró-público)*
7. **`infra`/budget-check em $ no `analyzeBestBet`** + slots proporcionais ao fan-out (§3 nuance).
8. **`product`/decidir o que fica público** (landing estática vs jogo vs preview-sem-botão) — gate
   da estratégia de SEO (§1). *(decisão do dono; provavelmente ADR)*

## 8. Perguntas em aberto (pro grill / decisão do dono)

- **Qual o alvo de SEO?** Uma landing pública + jogos gated? Ou jogos públicos (preview sem o botão
  de IA, IA atrás do login)? Isso define se §2/§5 são urgentes ou só boa higiene.
- **Hit-rate de re-análise real** (§0) — sem isso, o cache compartilhado (§4) é especulativo.
- **Override de modelo por-usuário é comum?** Se raro (default Sonnet >95%), cache-per-default é
  simples; se comum, precisa cache-por-modelo.
- **Manter Opus disponível** (admin) ou cortar pro registry mínimo Haiku+Sonnet?
- **Plano Vercel atual** (Hobby/Pro) — define o teto de concorrência real (#2).
- **Aceita reduzir `maxDuration`** (hoje 300s) se o pré-warm cron tirar o fan-out longo do caminho?
```
