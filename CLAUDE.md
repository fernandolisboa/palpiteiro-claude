# CLAUDE.md

Documento lido por Claude Code (e similares) ao iniciar sessões neste repositório. Convenções, comandos e gotchas do projeto.

## Visão rápida

**Palpiteiro** é um web app que usa LLM como **motor de seleção de edge multi-mercado** (1X2, over/under, BTTS, dupla chance): dada uma partida + mercados candidatos, emite **uma** recomendação por análise (mercado + seleção + linha + stake) ou `pass`, sempre com racional e Yield **segmentado por mercado**. Over/under 2.5 é o **primeiro mercado** do Tier 1, não o único. Side project solo, foco em uso pessoal e aprendizado de IA.

Documentação primária:
- [`docs/PRD.md`](./docs/PRD.md) — produto e escopo
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — stack e fluxos
- [`docs/ROADMAP.md`](./docs/ROADMAP.md) — fases e tarefas
- [`docs/decisions/`](./docs/decisions/) — ADRs de decisões críticas

## Stack

- Next.js 15 (App Router) + TypeScript strict
- PostgreSQL via Neon + Drizzle ORM
- Auth.js v5 (magic link via Resend)
- Anthropic SDK (Claude Sonnet 4.5)
- Tailwind + shadcn/ui
- Vercel (hosting + cron + KV)

## Comandos comuns

```bash
pnpm install           # instalar deps
pnpm dev               # dev server
pnpm db:generate       # gerar migration a partir de schema
pnpm db:migrate        # aplicar migrations
pnpm db:studio         # Drizzle Studio (GUI pro DB)
pnpm test              # rodar testes (Vitest)
pnpm lint              # ESLint
pnpm typecheck         # tsc --noEmit
pnpm build             # build de produção
```

## Convenções

### TypeScript
- `strict: true` sempre — nada de `any` sem comentário justificando
- Prefira `type` sobre `interface`, exceto pra extensão de classes
- Imports absolutos via `@/` (configurado em `tsconfig.json`)

### Next.js
- Server Components por padrão; só usar `"use client"` quando necessário (state, eventos, hooks)
- Server Actions pra mutações; evite criar API routes a menos que precise REST público
- Loading e error states explícitos em rotas (`loading.tsx`, `error.tsx`)

### Estilo de código
- Formatação via Prettier (config padrão do projeto)
- Nomes de arquivos: `kebab-case.ts` exceto componentes React (`PascalCase.tsx`)
- Funções pequenas, side-effects explícitos, sem mutação compartilhada
- Comentários só quando o "porquê" não é óbvio do código

### Banco de dados
- Schemas em `db/schema.ts`
- Migrations versionadas em `db/migrations/`
- **Nunca** rodar `db push` em produção — só `db migrate`
- Use transações pra operações compostas (predição + ai_call por exemplo)
- Queries pesadas pro dashboard ficam em `lib/db/queries/` como funções tipadas

### IA / Prompts
- Prompts em `lib/ai/prompts/` como TS versionado
- Versionamento **por cartucho** de mercado (ADR 0017): cada prompt tem `version` semver-like própria (ex: `over_under_v1.3`, `match_result_v1`, `btts_v1`)
- Mudanças em prompt → bump de versão → registrar no commit
- Toda chamada de LLM passa por `lib/ai/predict.ts`, que loga em `ai_calls`
- Output do LLM é **sempre** validado por Zod antes de uso

### Commits
- Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `prompt:`
- Português ou inglês, mas consistente dentro de cada commit
- Mensagens descritivas; o "porquê" no body se relevante
- Tipo extra `prompt:` pra mudanças de versão de prompt (importante pra rastreabilidade)

## Fluxo de trabalho (features e melhorias)

Flow padrão pra qualquer melhoria/feature não-trivial neste repo. Quando o pedido encaixar aqui, **siga sem precisar repetir estas instruções**:

1. **Sanity-check primeiro**: avalie se a melhoria faz sentido. Se **não** fizer, diga isso e **abandone a ideia** — não execute no piloto automático.
2. **Plano → issues**: trace um plano e, a partir dele, **crie uma ou mais issues no GitHub** (`gh issue create`) pra efetuar o trabalho de verdade. Issues no GitHub são o default deste projeto — não pergunte onde criar.
3. **Um subagent de contexto fresco por passo**, nesta ordem: exploração → plano → review do plano → ajustes no plano → implementação → code review → correções vindas do code review.
4. **Fechamento**: vá mergeando/completando os PRs e fechando as issues conforme cada um fica **verde e passando** (build/lint/typecheck/testes + checks do PR).

### Handoffs entre sessões

Trabalho grande roda em **várias sessões** (ex.: o pivot multi-mercado, uma fase por sessão). Ao **encerrar uma sessão** que produz um handoff:

- **Escreva/atualize o handoff em [`docs/handoffs/HANDOFF-<issue|fase>.md`](./docs/handoffs/)** (versionado — auto-suficiente: escopo, o que ler primeiro, ordem/dependências, princípios inegociáveis, landmines, critério de saída, gotchas de ambiente — aterrado no CÓDIGO real, não no doc). São **snapshots de um ponto no tempo**, não specs vivas (ver o README do diretório).
- **Logo em seguida, emita um _prompt de kickoff_ pronto pra colar** (LEAN — aponta pro handoff, não o duplica), pra o usuário iniciar a próxima sessão sem re-derivar contexto. Bloco copiável, no fim da resposta.
- Planos de implementação pré-issue vão em [`docs/plans/PLAN-<issue>.md`](./docs/plans/) (mesma natureza de arquivo histórico).
- **Artefatos locais NÃO versionados** (gitignored): `.playwright-mcp/` (snapshots/logs do Playwright MCP) e `pnpm-workspace.yaml` (stub auto-gerado do pnpm — committar quebra `pnpm install` em CI; rodar `pnpm install --ignore-workspace` localmente).

## Gotchas

- **Custo de tokens**: cada chamada de LLM custa dinheiro real. Cache agressivo em `match` data. Se rodar análise N vezes num jogo só pra debug, mencione isso no PR
- **Edge calculation**: NUNCA usar `1 / odd` cru como probabilidade implícita — bookmakers embutem margem (overround). Sempre normalizar pelo overround do **mercado completo** (`Σ 1/odd` sobre **todas** as seleções). Em N=2 (over/under) é o caso binário; em N≥3 (1X2) cada seleção tem seu próprio edge `modelProb_i − implied_i` (ADR 0018)
- **Settlement**: jogos podem ser anulados, adiados ou ter score corrigido após o fato. Settlement deve ser idempotente e suportar override manual
- **Free tier de The Odds API é 500 req/mês** — cache e batching são obrigatórios; rodar em loop pode estourar em horas
- **Neon cold start**: primeira query depois de inatividade tem latência ~1s. Não bloqueie UI esperando — use loading states
- **Magic link em spam**: e-mails de Resend ocasionalmente caem em spam no Gmail; documentar pros usuários da Fase 2

## O que NÃO fazer

- ❌ Adicionar mercado de **Tier 3** (correct score, escanteios, cartões, player props, handicap asiático), liga nova ou provider novo de IA sem ADR. Os mercados do MVP (Tier 1: 1X2 + over/under; Tier 2: BTTS + dupla chance) são **fluxo suportado** pelos ADRs 0015–0019 — entram via migration seguindo o modelo de `markets`/`market_selections`, sem ADR novo. Liga nova continua exigindo o checklist; provider de IA novo continua exigindo ADR.
- ❌ Commit de secrets ou API keys (mesmo que de teste)
- ❌ Skip de Zod validation em output de LLM ("vai dar certo dessa vez")
- ❌ Lógica de negócio complexa em components React — mover pra `lib/`
- ❌ Mutar predições passadas — sempre criar nova predição com referência à anterior se for revisão
- ❌ Suprimir erro de tipo com `// @ts-ignore` sem comentário explicando o porquê
- ❌ Quebrar a fronteira de `lib/ai/predict.ts` chamando Anthropic SDK direto de outros lugares

## Fronteiras de abstração importantes

- `lib/ai/predict.ts`: única porta de entrada pra LLM. Tudo passa por aqui pra garantir logging em `ai_calls`
- `lib/providers/`: clientes pra APIs externas (api-football, odds-api). Nunca chamar `fetch` direto pra esses serviços fora desses módulos
- `lib/providers/absences/`: cascata DEDICADA de desfalques (`AbsencesProvider` estreito, ADR 0026/#227), separada da `SportsDataProvider` gorda. `predict.ts` step 3 puxa desfalques daqui (`getAbsencesProvider()`); o resto (form/h2h/standings/lineups) segue na `SportsDataProvider`. Fallback SportMonks é **key-gated** (`SPORTMONKS_API_TOKEN`): sem token, `supportsAbsences=false` → filtrado no gate (inerte). Schema/endpoints do SportMonks são inferidos dos docs — validar ao vivo quando houver key
- `lib/db/queries/`: queries reusáveis ao DB. Se uma query aparecer em 2+ lugares, mover pra cá

## Quando estiver em dúvida

- Decisões de produto → consultar `docs/PRD.md`
- Decisões técnicas registradas → consultar `docs/decisions/`
- Decisão técnica relevante nova → propor ADR antes de implementar (mesmo que curto)
