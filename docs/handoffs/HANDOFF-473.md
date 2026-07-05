# HANDOFF — Aposta livre Fase 3 (#473, ADR 0036)

> Snapshot de um ponto no tempo (2026-07-05), não spec viva. Aterrado no CÓDIGO das
> Fases 1+2 (PRs #474 + #478, MERGED em main `35768429`). O ADR 0036 (Decisão 4 = a
> combinada) é o contexto de fundo. **Leia o código da Fase 2 antes de estender — a
> Fase 3 ADICIONA a camada de combinada + histórico sobre seams que já existem.**

## O que as Fases 1+2 já entregaram (em main, funcionando)

- **`lib/quant/scoreline-model.ts`** — módulo PURO **completo** (#452 fechada): `estimateLambdas`, `scorelineMatrix` (double-Poisson + Dixon-Coles τ), TODOS os readers (`pScoreline`/`pMarginAtLeast`/`pCleanSheet`/`pOverUnder`/`pBtts`/`p1X2`/`cs16`/`firstToScoreProbs`/`firstHalfScorelineMatrix`), e **`jointProbability(matrix, predicates[])`** — a peça central da combinada, JÁ pronta e testada.
- **`lib/bets/grade-scoreline.ts`** — `computeMatchLambdas({standing, homeTeam, awayTeam, neutral}) → {lambdaHome, lambdaAway, degradedData} | null` (guard B1) e `gradeScorelineLeg`. O `priceLeg` (interno) roteia kind→reader sobre a matriz. **A Fase 3 reusa `computeMatchLambdas` + a matriz pra o joint.**
- **`app/actions/bets.ts`** — `parseBet` + `confirmBet`. O `confirmBet` já: valida o slip (`ConfirmedSlipSchema`, que JÁ aceita `comboUserOdd` opcional), roteia cada perna A/B/none, persiste via `insertBetSlipWithLegs`. **A Fase 3 estende o confirm pra computar+persistir o joint, e a UI pra mostrar o card de combinada.**
- **DB** (`db/schema.ts`, migration 0041) — `bet_slips.comboUserOdd` e `bet_slips.jointProbPct` **já existem** (nullable, inertes hoje). **Sem migration nova** (a menos que precise de coluna extra).
- **`lib/db/queries/user-bets.ts`** — `insertBetSlipWithLegs`, `getUserBetSlipsForMatch` (leitura por match), tipos `DbBetSlip`/`DbBetLeg`/`UserBetSlipRow`. **A Fase 3 adiciona a query de histórico paginado.**
- **UI** (`components/free-bet.tsx`) — chips multi-kind + render por rota (`CartridgeResult`/`ModelResult`/`Notice`). **A Fase 3 adiciona o card de combinada + a seção/página "Minhas apostas".**

## Escopo da Fase 3 (issue #473)

1. **Combinada same-game via joint-sum** (Decisão 4). No `confirmBet`, quando o slip tem ≥2 pernas de PLACAR gradeadas:
   - Construir 1 predicado `(h,a)=>boolean` por perna que é predicado sobre o **placar final** (`exact_score`/`margin`/`clean_sheet`/`over_under`/`match_result`/`btts`/`double_chance`). `jointProbPct = jointProbability(matrix, predicates) × 100`, sobre a MESMA matriz do `computeMatchLambdas` do slip.
   - Persistir `jointProbPct` (+ `comboUserOdd` que já viaja no slip) — congelado no confirm.
   - EV da combinada = `computeEvPerUnit(jointProbPct, comboUserOdd)` **só** quando o usuário deu `comboUserOdd` E o joint é computável; senão, só a prob conjunta ou "combinada não avaliada" — **nunca EV parcial** (Decisão 4c).
2. **Odd combinada** — já parseada pelo boundary (`ConfirmedSlipSchema.comboUserOdd`, PT-BR); a UI precisa de um campo pra o usuário digitá-la.
3. **Seção "Minhas apostas"** — histórico: **paginação cursor por `createdAt desc`, ~20 por página**, status derivado no SELECT via agregação das outcomes das pernas (won = todas won; lost = alguma lost; pendente = resto; pernas `settleable=false` deixam a combinada "não conferida").

## Princípios inegociáveis / landmines (Decisão 4 + Consequências)

- **O joint vem SEMPRE de UMA única distribuição coerente — a matriz do modelo simplificado** — mesmo quando uma perna foi gradeada pelo CAMINHO A (cartucho). Misturar marginal de cartucho com célula Poisson somaria medidas diferentes. A linha da combinada é portanto SEMPRE rotulada "modelo simplificado".
- **Invariante de coerência de tela (PINADO)**: o card da combinada exibe o joint **E as marginais Poisson das pernas participantes** — todas lidas da MESMA matriz → `joint ≤ min(marginais)` garantido. Cada chip de perna mantém o número da SUA fonte (cartucho onde A, Poisson onde B). **NUNCA** renderizar um joint ao lado de marginal de OUTRA fonte sem a marginal Poisson junto (a forma dura de "dois números do mesmo lado na mesma tela").
- **Pernas FORA do joint**: `first_to_score` e as de 1º tempo (`first_half_score`/`first_half_over_under` — processo temporal / matriz-κ própria) + não-gradeáveis (`cards`/`corners`) + pernas de placar que ficaram SEM grade no confirm (`gradeSource='none'`, ex. rate_limited/no_data). O joint só computa quando **TODAS** as pernas de placar do slip têm grade; qualquer uma de fora derruba a linha pra **"combinada não avaliada"** (nunca precificar um combo diferente do apostado).
- **NUNCA multiplicar** probs de pernas do mesmo jogo (armadilha de correlação) — joint-sum ou "combinada não avaliada". Teste pinado.
- Slip é **imutável** e **NUNCA compartilhável** (§13) — o histórico é autenticado/privado, nada cruza pra `/p/[id]`/OG. Disclaimer §3 verbatim em toda view nova (histórico incluso). Status do slip é **derivado em leitura** (nenhuma coluna denormalizada).
- Carrega tudo da Fase 2: perna B sem edge/sem `1/odd`; zero callers de `containsValueLanguage`; sem campo `verdict`; grades congelados; drizzle numeric→string com `Number()`.

## Ordem sugerida

1. `legToScorePredicate(kind, params): ((h,a)=>boolean) | null` (null = fora do joint) — puro, testável (oráculo: joint(sub-conjunto) ≥ joint(super-conjunto); joint ≤ min marginais).
2. Estender `confirmBet`: computar o joint sobre a matriz do slip (reusa `computeMatchLambdas`), persistir `jointProbPct`; devolver a view da combinada (com as marginais Poisson).
3. Query de histórico paginado (`lib/db/queries/user-bets.ts`) — cursor `createdAt desc`, status agregado no SELECT.
4. UI: campo de odd combinada + card de combinada (joint + marginais Poisson + EV condicional) + seção/página "Minhas apostas".
5. Testes: predicados/joint (puro), pglite do histórico + status derivado, e o teste pinado anti-multiplicação. Triad + `next build` local.

## Critério de saída

Um slip "Palmeiras vence + mais de 1.5" com odd combinada 2.10 → card de combinada mostrando o joint (< cada marginal Poisson exibida junto) + EV@odd-combinada, rotulado "modelo simplificado"; adicionar uma perna de 1º tempo ou `first_to_score` → linha vira "combinada não avaliada"; a seção "Minhas apostas" pagina o histórico com status derivado (acertou/errou/pendente) das outcomes. Triad + `next build` verdes. Fecha o ADR 0036 (arco item 4).

## Gotchas de ambiente

- Worktree: `git worktree add -b <branch> ../palpiteiro-<x> main` + `cp ../palpiteiro-claude/.env.local .env.local` + `pnpm install --ignore-workspace`.
- **Sem migration nova** esperada (`comboUserOdd`/`jointProbPct` já em 0041). Se adicionar coluna, `pnpm db:generate` exige `DATABASE_URL` (do `.env.local`); pega 0042 (renumerar se colidir — memória "concurrent storm migration renumber").
- Suíte cheia flaka pglite em 8-core: `pnpm test --no-file-parallelism`.
- `next build` local por causa do "use server" em `bets.ts` (async-only).
- `z.uuid()` (Zod v4) valida UUID RFC-estrito — fixtures de teste com version/variant bits válidos (`...-4xxx-8xxx-...`).
- O core cache-first do #412 (`gradeMyBet`) é reusado no CAMINHO A chamando a própria action com FormData — NÃO refatore essa fronteira sem necessidade.
