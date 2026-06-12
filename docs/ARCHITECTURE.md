# Architecture — Palpiteiro

## Stack

| Camada | Escolha | Por quê (resumido) |
|---|---|---|
| Frontend | Next.js 15 (App Router) | Familiar; Server Actions; SSR útil |
| Hosting | Vercel | Zero-config; CI/CD; free tier |
| Database | PostgreSQL (Neon) | Serverless; analytics via SQL; ver `decisions/0002` |
| ORM | Drizzle | TS-first; SQL transparente |
| Auth | Auth.js v5 (magic link) | Whitelist Fase 2; ver `decisions/0004` |
| Cache/KV | Vercel KV | Cache de odds e match data |
| AI | Claude Sonnet 4.5 | Único provider no MVP; ver `decisions/0001` |
| Validação JSON | Zod | Garantir output válido do LLM |
| Cron | Vercel Cron | Sync de jogos + settlement |
| Observabilidade | Sentry (free) + Vercel Analytics | Suficiente pra MVP |

ADRs em `docs/decisions/` documentam decisões críticas com contexto e alternativas.

## Provedores externos

| Serviço | Uso | Limite (free) |
|---|---|---|
| API-Football | Jogos, escalações, lesões, forma, H2H, classificação, resultados | 100 req/dia (free) |
| The Odds API | Odds atuais por mercado (1X2 / over-under / BTTS / dupla chance) na região `eu` — featured (`h2h`/`totals`) + additional (`btts`/`double_chance`) | 500 req/mês |
| Anthropic API | Inference do LLM | Pay-as-you-go |
| Resend | E-mail transacional (magic link) | 100 e-mails/dia (free) |

## Fluxo principal

```
[Cron diário 06:00 UTC]
  └→ sync de jogos das próximas 72h via API-Football
     └→ upsert em matches table

[Usuário abre /match/[id]]
  └→ fetch dados estruturados do jogo (cache 1h em Vercel KV)
     └→ fetch odds atuais (cache 5min em KV)
        └→ render "Analisar com IA"

[Click "Analisar"]
  └→ server action → lib/ai/predict()
     ├→ monta prompt com dados injetados
     ├→ chama Claude Sonnet com structured output
     ├→ valida JSON com Zod
     ├→ persiste em predictions + ai_calls
     └→ retorna predição pra UI

[Cron horário]
  └→ pra cada predição com status pendente:
     └→ fetch resultado do jogo via API-Football
        └→ se finalizado: atualiza prediction_outcomes (won/lost/void/profit)
```

## Modelo de dados (resumo)

Tabelas principais:

- `users` — whitelist + dados básicos
- `matches` — jogos com dados estruturais (times, liga, data, status)
- `match_odds_snapshots` / odds por seleção (`selection_odds_snapshots`) — snapshots de odds genéricos **por seleção** ao longo do tempo (histórico de movimento); substitui o par fixo over/under (ADR 0015)
- `predictions` — palpites gerados pela IA
- `prediction_outcomes` — resultado real (preenchido pelo cron de settlement)
- `ai_calls` — auditoria de cada chamada LLM (input, output, tokens, custo, latência, prompt_version)

Schema completo em `db/schema.ts`. Decisões de modelagem com tradeoffs ficam em ADRs específicos quando relevantes.

### Campos críticos em `predictions`

- `match_id`, `user_id`, `created_at`
- `market_id` (FK → `markets`) + `selection_id` (FK → `market_selections`, nullable em `pass`) + `market_params` jsonb (forma do mercado, ex. `{ "line": 2.5 }`) — substitui os enums `market`/`recommendation` (ADR 0015 D4)
- `confidence_pct` (probabilidade estimada pelo LLM)
- `odd_at_recommendation`, `bookmaker`
- `implied_prob_pct` (= 1/odd da seleção normalizado pelo overround do mercado completo)
- `edge_pct` (= confidence_pct − implied_prob_pct, por seleção)
- `stake_units` (1–3u por confiança — ADR 0019)
- `result`, `profit_units` (colunas tipadas pro agregável; **nunca** em JSONB)
- `model_version`, `prompt_version`
- `ai_call_id` (FK pra `ai_calls` — auditoria completa)

Colunas **tipadas** pra tudo que é agregável/consultável (acima); JSONB **só** pra `market_params` e `result_data` (fatos do jogo), validados por Zod no boundary (ADR 0015 D4).

## Versionamento de prompts

Versionamento **por cartucho de mercado** (ADR 0017): cada prompt tem `prompt_version` própria, semver-like (ex: `over_under_v1.3`, `match_result_v1`, `btts_v1`).

- Prompts ficam em `lib/ai/prompts/` como TypeScript versionado, um cartucho por mercado
- Cada predição salva qual versão de prompt usou
- Permite análise retrospectiva: "predições com `over_under_v1.3` tiveram X% de Yield vs `over_under_v1.2` com Y%"
- Mudanças de prompt → bump de versão **daquele cartucho** → mensagem de commit explícita

## Segurança

- **Secrets**: Vercel env vars; nunca commitadas
- **Auth**: magic link via Resend; sessões em cookie HTTP-only, secure, sameSite=lax
- **Rate limit**: por usuário/dia (Upstash Ratelimit via Vercel KV) — protege contra custo descontrolado de tokens
- **Whitelist**: usuários precisam ser adicionados manualmente à tabela `users` na Fase 2
- **CSP**: política mínima de Content Security Policy
- **PII**: e-mail é o único PII; LGPD-friendly por design (sem nome, CPF, etc.)

## Observabilidade

- Logs estruturados (JSON) em todas as server actions
- Erros enviados pro Sentry (free tier)
- Dashboard interno (`/admin/costs`) com gasto agregado de tokens (vindo de `ai_calls`)
- Alerta por e-mail se gasto diário > R$ X (configurável em env var)

## Decisões em aberto

A serem cobertas em ADRs futuros conforme evoluem:

- Estratégia exata de cache invalidation pra odds (TTL fixo vs invalidate em snapshot novo)
- Settlement pra jogos anulados/adiados (regra de negócio pra `void`)
- Política de retenção de dados pra `ai_calls` (cresce rápido)
