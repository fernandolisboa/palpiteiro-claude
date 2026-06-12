# CLAUDE.md

Documento lido por Claude Code (e similares) ao iniciar sessões neste repositório. Convenções, comandos e gotchas do projeto.

## Visão rápida

**Palpiteiro** é um web app que usa LLM pra gerar recomendações de aposta em over/under 2.5 gols, com tracking obsessivo de Yield e racional. Side project solo, foco em uso pessoal e aprendizado de IA.

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
- Cada prompt tem `version` semver-like (ex: `over_under_v1.2`)
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

## Gotchas

- **Custo de tokens**: cada chamada de LLM custa dinheiro real. Cache agressivo em `match` data. Se rodar análise N vezes num jogo só pra debug, mencione isso no PR
- **Edge calculation**: NUNCA usar `1 / odd` direto como probabilidade implícita — bookmakers embutem margem (overround). Sempre normalizar pelo overround do mercado completo
- **Settlement**: jogos podem ser anulados, adiados ou ter score corrigido após o fato. Settlement deve ser idempotente e suportar override manual
- **Free tier de The Odds API é 500 req/mês** — cache e batching são obrigatórios; rodar em loop pode estourar em horas
- **Neon cold start**: primeira query depois de inatividade tem latência ~1s. Não bloqueie UI esperando — use loading states
- **Magic link em spam**: e-mails de Resend ocasionalmente caem em spam no Gmail; documentar pros usuários da Fase 2

## O que NÃO fazer

- ❌ Adicionar mercado novo, liga nova ou provider novo de IA sem ADR
- ❌ Commit de secrets ou API keys (mesmo que de teste)
- ❌ Skip de Zod validation em output de LLM ("vai dar certo dessa vez")
- ❌ Lógica de negócio complexa em components React — mover pra `lib/`
- ❌ Mutar predições passadas — sempre criar nova predição com referência à anterior se for revisão
- ❌ Suprimir erro de tipo com `// @ts-ignore` sem comentário explicando o porquê
- ❌ Quebrar a fronteira de `lib/ai/predict.ts` chamando Anthropic SDK direto de outros lugares

## Fronteiras de abstração importantes

- `lib/ai/predict.ts`: única porta de entrada pra LLM. Tudo passa por aqui pra garantir logging em `ai_calls`
- `lib/providers/`: clientes pra APIs externas (api-football, odds-api). Nunca chamar `fetch` direto pra esses serviços fora desses módulos
- `lib/db/queries/`: queries reusáveis ao DB. Se uma query aparecer em 2+ lugares, mover pra cá

## Quando estiver em dúvida

- Decisões de produto → consultar `docs/PRD.md`
- Decisões técnicas registradas → consultar `docs/decisions/`
- Decisão técnica relevante nova → propor ADR antes de implementar (mesmo que curto)
