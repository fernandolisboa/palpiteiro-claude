# HANDOFF — #246: polish visual da página do jogo (ÚLTIMA do pós-pivot)

> Snapshot 2026-06-17. LEAN — aponta pro código real, não duplica a issue. Snapshot de um ponto no tempo, não spec viva.

## TL;DR

Com a wave multi-AI (#229→#230→#231) mergeada, **#246 é a ÚNICA issue do pós-pivot restante**. É um **pass de design dedicado** (skill **`/impeccable`** e/ou Claude Design) na **página do jogo** e telas correlatas, sobre a estrutura funcional FINAL (que já aterrissou: seções colapsáveis + rodapé por seção + multi-mercado + cenários). **Só apresentação — ZERO mudança funcional.** O dono pediu explicitamente que o polish viesse **por último**, com calma ([[separate-functional-from-visual-polish]]).

## Ler primeiro

1. A issue: `gh issue view 246` (escopo, critério de aceite, fora-de-escopo).
2. A skill: invocar **`/impeccable`** (auditoria de hierarquia/espaçamento/alinhamento/densidade; trata empty/error/loading com o mesmo cuidado).
3. Memória: [[separate-functional-from-visual-polish]] (separar restruturação funcional do de-slop — o design pass é o último passo) e [[work-order-post-pivot]] (a ordem cravada pelo dono).

## Superfície (a polir — só presentation)

- **`app/match/[id]/page.tsx`** — a página do jogo (server component; é `ƒ` dinâmica, não pré-renderizada).
- **`AnalysisResult`** + seções de mercado colapsáveis + **rodapé por seção** (reanálise + dropdown de modelo inline, #244) + **multi-select de mercados** (#245) + **cenários** colapsados (`<details>` nativo, #242) + **"análises anteriores"** (#204).
- Estados **empty / error / loading** com o mesmo cuidado visual.
- Componentes correlatos em `components/` / `app/match/`.

## Princípios inegociáveis

- **NENHUMA mudança funcional** (fluxo, queries, seleção de mercado, settlement) — só apresentação/estilo (Tailwind + shadcn/ui).
- **Paridade de dados do over/under preservada** (não tocar a lógica de edge/staking/persistência).
- **Sem regressão** do que as issues #204/#242–#245/#288–#290 entregaram.
- Lógica de negócio fica em `lib/` — não migrar lógica pra componentes (CLAUDE.md).
- Tokens de espaçamento/typography consistentes; remover ruído/"slop de IA"; alinhar grid.

## Critério de saída

- Revisão antes/depois de hierarquia + alinhamento + densidade aprova.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` verdes; preview Vercel sobe.
- Sem diff funcional (só JSX/estilo/copy de UI).
- "Fecha #246" PT-BR NÃO auto-fecha → fechar manual no merge ([[github-fecha-not-autoclose]]).

## Gotchas de ambiente

- `pnpm test` flaka pglite em 8-core → `--no-file-parallelism` ([[pglite-suite-high-core-flake]]). (vitest 4 NÃO aceita `--poolOptions.forks.maxForks=`.)
- CI = typecheck+lint+test; **preview Vercel é onde dá pra VER o polish** (e roda migration, mas #246 não tem migration).
- `/impeccable` rende melhor com iteração ao vivo no browser (Playwright MCP disponível).

## Depois do #246

Pós-pivot fecha. Próximo arco (novo): **palpites de engajamento #313→#314→#315→#316** ([[palpites-engajamento-arc]]) — só DEPOIS do #246.
