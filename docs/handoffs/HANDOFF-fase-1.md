# HANDOFF — Pivot multi-mercado · FASE 1 (fundação de dados: expand + backfill)

> **Status:** Fase 0 FECHADA (ADRs 0015–0019 aceitos+mergeados; 0003 Superseded; 0012-cenários
> emendado; docs reescritos; validação de odds da Copa registrada e Brasileirão agendado). Fase 1
> ainda **não começou**.
> **Pré-requisito:** Fase 0 fechada (PRs #205–210 mergeados; issues #152–157 closed; #158 aberta como
> follow-up de bloqueio externo).
> **Escopo da Fase 1:** **expand + backfill** — schema genérico + migração determinística do
> histórico over/under. **Zero mudança de comportamento.** O dashboard tem que mostrar **exatamente
> os mesmos números** antes/depois. Isto é **migration + código de plumbing**, mas **sem** lógica de
> mercado novo (isso é Fase 2/4).
> **Como usar:** auto-suficiente. Sessão de contexto limpo executa cada issue lendo este doc + o
> corpo no GitHub + os ADRs 0015/0016 (a base de tudo). Mapa do pivot inteiro e decisões D1–D10:
> ver `HANDOFF-fase-0.md` (seção "Mapa do pivot inteiro") + épico **#183**.

---

## O que a Fase 1 entrega (e o que NÃO entrega)

**Entrega:** as tabelas/colunas que o pivot precisa, **aditivas e nullable** (expand), + o backfill
determinístico (migrate) que faz toda predição histórica apontar pro mercado `over_under`. Depois
disto, o schema é multi-mercado mas o **comportamento é idêntico** (predict/settle/dashboard ainda
rodam pelo caminho over/under de hoje — generalizar o caminho é **Fase 2**).

**NÃO entrega:** nenhuma regra de mercado novo, nenhum cartucho, nenhuma math de N-vias, nenhuma UI.
Não **contrai** nada (o enum `market` e as colunas binárias `over/under_odd_at_prediction` continuam
no schema — contract é Fase 5). Princípio: **expand-migrate-contract** (ADR 0015 D5), nunca big-bang.

**Critério de saída (porta da Fase 2):**
- [ ] `markets` + `market_selections` criadas e **seedadas** (`over_under` + seleções `over`/`under`).
- [ ] `predictions` ganha `market_id`/`selection_id`/`market_params` (nullable) + odds congeladas por
      seleção; `prediction_outcomes` ganha `result_data` jsonb; `outcome_result` ganha `push`;
      snapshots de odds por seleção existem.
- [ ] Backfill determinístico (sem LLM) preencheu **todas** as predições históricas
      (`market_id` = over_under; `selection_id` ← `recommendation`; `market_params` = `{line:2.5}`).
- [ ] **Dashboard idêntico antes/depois** (Yield, win rate, pass rate, bankroll, contagem) — provar
      com um snapshot dos KPIs pré-backfill vs pós-backfill.
- [ ] `profit_units`/`result`/`stake_units` históricos **intocados** (imutabilidade).

---

## Decisões já cravadas que a Fase 1 implementa (ADRs 0015/0016)

- **D3** — `markets`/`market_selections` como **tabelas de referência (seed + FK)**, não enums.
- **D4** — **híbrido**: colunas tipadas pro agregável (`selection_id`, `odd_at_recommendation`,
  `implied_prob_pct`, `edge_pct`, `confidence_pct`, `stake_units`, `result`, `profit_units`); JSONB
  **só** pra `market_params` e `result_data`, validados por **Zod no boundary**. Nunca profit/result/
  edge/stake em JSONB.
- **D5 (settlement, ADR 0016)** — `push` entra no enum `outcome_result`; `result_data` jsonb
  (`{home_score, away_score}`, placar 90') é o fato do jogo coletado 1×.
- **D6** — expand-migrate-contract com **backfill determinístico (sem LLM)**; **Yield histórico
  preservado**.

---

## As issues da Fase 1 (#159–#162) — ordem e dependências

> Ordem: **#159 → #160 → #161 → #162**. #160/#161 dependem de #159 (precisam do `markets.id` pra FK).
> #162 (backfill) depende de #160+#161 (precisa das colunas-alvo). 1 PR por issue, mergeando off
> `origin/main` conforme cada um fica verde.

### #159 — `markets` + `market_selections` + seed
- `markets`: `id` uuid PK, `key` text **UNIQUE** (`over_under`, e depois `match_result`/`btts`/
  `double_chance`), `label`, `settlement_rule_key` text (ADR 0016 — pro `over_under` aponta pra regra
  over/under), flags de ativação/graduação (feature-flag por mercado — D9; ex. `active boolean` +
  `graduated boolean` ou um `status`), `created_at`.
- `market_selections`: `id` uuid PK, `market_id` uuid FK→`markets` (**ON DELETE CASCADE**), `key` text
  (`over`/`under`), `label`, `sort_order` integer. (UNIQUE em `(market_id, key)`.)
- **Seed:** mercado `over_under` (active) + seleções `over` (sort 0) / `under` (sort 1). **Só
  over/under** nesta fase — os outros mercados são seedados quando forem construídos (Fase 4).
- Aditivo puro: **não** toca `predictions`/`prediction_outcomes` ainda. Zero comportamento.

### #160 — `predictions`: `market_id`/`selection_id`/`market_params` + odds congeladas por seleção
- Adicionar a `predictions` (todas **nullable** no expand): `market_id` uuid FK→`markets`,
  `selection_id` uuid FK→`market_selections` (nullable — `pass` não tem seleção), `market_params`
  jsonb.
- **Odds congeladas por seleção** (`prediction_selection_odds`, a generalização N-vias do par
  `over/under_odd_at_prediction` da ADR 0012): tabela filha `prediction_id` FK + `selection_id` FK +
  `odd` numeric (uma row por seleção do mercado, congelada na análise, inclusive em `pass`). O par
  binário antigo permanece como **legado** (contract só na Fase 5).
- Tudo nullable/aditivo; predict.ts ainda **não** preenche (isso é Fase 2 #165). Zero comportamento.

### #161 — `selection_odds_snapshots` + `push` + `result_data`
- `selection_odds_snapshots`: snapshots de odds **ao vivo** por seleção (generaliza
  `match_odds_snapshots`, hoje par fixo `over_odd`/`under_odd`/`line`): `match_id` FK, `bookmaker`,
  `market_id` FK, `selection_id` FK, `market_params` jsonb, `odd` numeric, `overround_pct`,
  `captured_at`. (`match_odds_snapshots` antigo permanece até o contract.)
- `push`: **`ALTER TYPE outcome_result ADD VALUE 'push'`** (ADR 0016). ⚠️ `ADD VALUE` não roda dentro
  de transação no Postgres antigo — checar a versão do Neon e a forma que o drizzle-kit gera.
- `result_data`: adicionar `result_data` jsonb a `prediction_outcomes` (ADR 0016 — `{home_score,
  away_score}`). `total_goals` permanece (vira derivado/legado).

### #162 — Backfill determinístico (sem LLM)
- `predictions` histórico: `market_id` = id do `over_under`; `selection_id` ← `recommendation`
  (`over`→seleção `over`, `under`→`under`, `pass`→**null**); `market_params` = `{"line": 2.5}`;
  `prediction_selection_odds` ← o par `over/under_odd_at_prediction` congelado (onde existir; rows
  históricas sem o par degradam — ADR 0012 decisão 5, **sem** inventar odd).
- `prediction_outcomes.result_data`: ⚠️ **preferir `matches.home_score`/`matches.away_score`** (o
  placar por lado **existe** em `matches`, schema ~`:144-145`) pra montar `{home_score, away_score}`;
  cair pro escalar (carregar `total_goals`) só onde o placar por lado do `matches` for null. (A ADR
  0016 só diz que **não dá** pra reconstruir o split a partir do `total_goals` **sozinho** — mas o
  `matches` tem o split. **Verificar** isto contra os dados reais antes de codar o backfill.)
- **Imutável:** o backfill **não toca** `profit_units`/`result`/`stake_units`. Idempotente (re-rodável).
- **Prova de paridade:** capturar os KPIs do dashboard (Yield/win rate/pass rate/bankroll/contagem)
  **antes** e **depois** e bater 1:1. Esse é o critério de saída da fase.

---

## Ground truth verificado (bater com o CÓDIGO real, não com este doc)

- **Migrations:** head = `0008_add_generation_params.sql` → a primeira migration da Fase 1 é
  **`0009`**. ⚠️ Migration drizzle **tem** que ser registrada em `db/migrations/meta/_journal.json`
  (+ snapshot), não basta dropar o `.sql`. Preferir `pnpm db:generate` a partir do `db/schema.ts`.
- **Enums hoje (`db/schema.ts`):** `market = [over_under_2_5]` (`:32`, consumido em `predictions:211`
  **e** `match_odds_snapshots:159`); `recommendation = [over,under,pass]`; `outcome_result =
  [won,lost,void]` (**sem push** — #161 adiciona). `defaultModelId`/`preferredModelId` são `text`
  validados na app (convenção do repo pra evitar migration por valor — mesma filosofia das tabelas de
  referência).
- **`predictions` hoje:** `market` enum default `over_under_2_5` (`:211`); `over_odd_at_prediction`/
  `under_odd_at_prediction` numeric(6,3) **nullable** (`:227-228`, ADR 0012, sem backfill histórico);
  `stake_units` numeric(6,2) `notNull` default `"1"` (`:229`); `oddAtRecommendation` numeric (single,
  do lado escolhido). **Não** tem `market_id`/`selection_id`/`market_params` ainda.
- **`prediction_outcomes` hoje:** `prediction_id` uuid **UNIQUE** FK (cascade), `total_goals` integer
  (`:247`, **só o total — sem home/away**), `result` outcome_result, `profit_units` numeric(8,2),
  `override_by_user_id` (nullable), `settled_at`. UNIQUE(prediction_id) = idempotência do settlement.
- **`matches`:** tem `home_score`/`away_score` (~`:144-145`) — fonte pro `result_data` por lado no
  backfill (#162).
- **Settlement:** `compute.ts` hardwired na linha 2.5; `getPendingSettlementPredictions`
  (`predictions.ts:92-103`) **não seleciona `market`** (Fase 2 #166 muda). `SETTLEMENT_MIN_ELAPSED_MS
  = 150min` (`predictions.ts:67`). `regulationScore.{home,away}` (90', sem ET/pênaltis) é o que o
  provider entrega (`settle.ts:88-89` hoje só soma).
- **Dashboard:** `getUserDashboardRows` **já** seleciona `market` (`dashboard.ts:32`); `kpis.ts`
  soma `profit_units`/`stake_units`; `keepLatestPerMatch` já antecipa estender o dedup pra
  `(matchId, market)` (`:100-104`) — útil pra prova de paridade. **Drizzle numeric volta string** →
  `Number()` no boundary antes de qualquer conta.

---

## Gotchas de ambiente (comprovados nas Fases pré-pivot e 0)

- **Migration agora existe** → **Nunca `db push`** (só `db migrate`); registrar no journal do drizzle.
  Build local **não roda** (precisa de DB) → a validação real é o **check da Vercel** (que provisiona
  uma **Neon preview branch** e roda a migration). Se a preview falhar com "Resource provisioning
  failed" em ~20s sem logs = **quota de Neon branch** estourou → deletar branches stale + re-trigger.
- **ripgrep dá timeout no UNC do WSL** → `Read` (paths absolutos) + Bash `git grep -n`. Instruir os
  subagents.
- Toolchain via WSL nvm Node 24 / corepack pnpm: `wsl --cd <worktree> --exec bash -lc '. "$HOME/.nvm/
  nvm.sh"; nvm use 24; corepack pnpm --config.verify-deps-before-run=false run <typecheck|lint|test>'`.
  Se mexer em teste, **nenhum** pode chamar o Anthropic pago.
- `main` local é STALE/travado → base com `git checkout -b <branch> origin/main`; diffs com
  `origin/main...HEAD`. `gh pr checks <n>` tem DUAS linhas "Vercel": pegar o gate com
  `awk -F'\t' '$1=="Vercel"{print $2}'`. PRETTIER não roda em CI (trailing-comma `all` no código vs
  `.prettierrc` es5) → **não** rodar `prettier --write` em `.ts`; seguir o estilo ao redor. `.md` ok.
- `pnpm install` cria `pnpm-workspace.yaml` na raiz (artefato) — **não** commitar.
- Squash-merge é o padrão do repo (commits viram `... (#NNN)`); fechar issues via `Closes #N` no PR.

---

## Quando a Fase 1 fechar

Provar a paridade do dashboard, então escrever `HANDOFF-fase-2.md` (math + plumbing plugável:
implícita/edge N-vias, seletor genérico de bookmaker, cartucho de mercado + `predict()` por
`marketKey`, settlement plugável, staking 1–3u, override condicional ao mercado — #163–#168) e
começar. Lembrete: Fase 2 é onde o over/under passa a rodar 100% pelo caminho **genérico** com
**paridade comprovada** — zero `if (market === ...)` fora dos registries.
