# HANDOFF — Pivot multi-mercado · FASE 5 (CONTRACT · #179) — ✅ COMPLETO

> **Status:** Fase 5 (contract) **DONE + LIVE em PROD** (2026-06-15). PR **#285** (squash `0ab16fb2`), **migration 0028**
> aplicada em prod e verificada (read-only). **Núcleo arquitetural do pivot multi-mercado COMPLETO** — épico #183 com cauda
> aberta (não-bloqueante). Este doc é o REGISTRO DE CONCLUSÃO; não há Fase 6.

## O que entrou (contract = remover o legado binário over/under)

Migration **0028** (gerada por drizzle-kit, não escrita à mão):
- `predictions.market` + `predictions.recommendation`: enums Postgres DROPADOS → colunas viraram `text`
  (`recommendation` MANTÉM `NOT NULL`; cast in-place `SET DATA TYPE text`, dados preservados).
- `predictions.over_odd_at_prediction` / `under_odd_at_prediction`: **DROPADAS** → `prediction_selection_odds` (par N-vias).
- `prediction_outcomes.total_goals`: **DROPADA** → `result_data.totalGoals` (jsonb).
- Tabela `match_odds_snapshots`: **DROPADA** → `selection_odds_snapshots` (card/chip over/under ao vivo adapta a captura
  de linha 2.5 de volta pra forma binária; mesmos nomes de campo).
- Wrapper binário `computeImpliedProbabilities` colapsado no core N-ário `computeMarketImpliedProbabilities`.
- `db/scripts/backfill-multimarket.ts` (#162, one-shot) **REMOVIDO** (lia exatamente o legado dropado; mappings puros
  `backfill-mappings.ts` ficam, pinados por teste).

**Critério de saída do PIVOT atingido:** domínio **mercado-agnóstico por design** — zero enum/coluna/tabela/branch binário;
over/under 2.5 é só `markets.key='over_under'`, o primeiro registro do registry.

## Como foi feito (flow que funcionou — carrega pra futuras migrations de contract)

- **Plan-gate adversarial two-round (Workflow)** ANTES de codar → GO com 12 blockers/majors resolvidos (até replay
  empírico do `db:generate` + pglite).
- **2 slices, commit-por-preocupação, verde a cada passo:** Slice 1 = parar de LER/ESCREVER o legado (5 commits, dashboard
  provadamente idêntico); Slice 2 = DROP destrutivo (migration 0028 + write-stops acoplados + widenings + fixtures) + scrub.
- **§6 backfill-coverage gate READ-ONLY contra PROD = 0 gaps** ANTES do drop (gate C/C-companion/D) — provou que #162
  `--apply` rodou em prod (`.env.local` É prod, dono confirmou). Sem isso, o drop = perda irreversível.
- **Backup de PROD (Neon snapshot)** confirmado pelo dono ANTES do merge = a ÚNICA reversibilidade de um DROP.
- Merge squash → deploy de prod aplica `drizzle-kit migrate` (gate real, Vercel verde) → verificação pós-migration read-only.
- Code-review adversarial find→verify postado como PR comment (1 major operacional = o gate §6; ressalvas value-adding fixadas).

## Invioláveis que se confirmaram (carregam)

- **NÃO escrever a migration enum→text à mão** — drizzle gera `ALTER COLUMN ... SET DATA TYPE text` (in-place) + `DROP TYPE`
  por último, com `--> statement-breakpoint`. Bloco hand-written sem breakpoint quebra o pglite migrate.
- **NÃO rodar `pnpm build` local** numa PR de migration destrutiva: `build = drizzle-kit migrate && next build` aplicaria o
  DROP no DB do `.env.local` (= prod). A suíte pglite já prova apply-clean 0000→head.
- DROP é destrutivo + IRREVERSÍVEL por DML → backup é a reversibilidade; §6 read-only contra prod é o gate de não-perda.

## Cauda aberta do épico #183 (não bloqueia o núcleo; decisão de fechar o épico é do dono)

- **#182** — reformular /como-funciona multi-mercado (deliverable de UI da Fase 3).
- **#173** — 1X2: OPEN só pelo backtest AC#3/#4 (PAGO, ≥20 jogos finished c/ odds).
- **#180 / #181** — backlog cravado (D8 CLV / D10 api-football provider).
- **Flip do #178** (melhor-aposta, 1 DML) quando o dono quiser ativar — ANTES rederivar o teto diário de rate-limit
  (1 slot autoriza até 6 calls + 4 créditos/run); validar 1 análise flag-on.
- **Follow-ups LOW do #175** (PR #265): out-of-ladder queima 1 call; freshness dedup em escada parcial; expandir
  `OVER_UNDER_ALT.coveredLeagues` além de world_cup.
