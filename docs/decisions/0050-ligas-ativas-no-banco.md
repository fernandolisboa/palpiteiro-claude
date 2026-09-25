# ADR 0050 — Ligas ativas no banco, ligadas pelo admin

## Status

Accepted (2026-09-24). Issue #508. Substitui o mecanismo de ativação das ADRs 0044 (§ ligar = uma linha em `ACTIVE_LEAGUES`), 0045 e 0049 (§5, recuo "tirar `la_liga` de `ACTIVE_LEAGUES` + `HIDE_WHEN_INACTIVE`"). O resto dessas ADRs segue valendo.

## Contexto

Quais ligas estão ativas vivia na constante `ACTIVE_LEAGUES` (`lib/config/active-leagues.ts`). Ligar/desligar exigia commit + deploy. O gatilho real dessa decisão é o orçamento da The Odds API (500 créditos/mês, ADR 0049 §5): o dono precisa desligar uma liga no meio do mês quando o `quotaMonthlyUsed` aperta, e religar quando o Brasileirão acaba — decisão operacional, não de código. O seletor da home ainda tinha uma segunda lista (`HIDE_WHEN_INACTIVE`) que precisava andar junto.

## Decisão

1. **Tabela `league_settings`** (migration 0047): `league` (enum `league`, PK), `active boolean not null default false`, `updated_by_user_id` (FK `users`, set null), `updated_at`. Liga sem row = desligada. A migration semeia as 4 ativas de então (Brasileirão, Champions, Premier League, La Liga) com `ON CONFLICT DO NOTHING` (preview DB compartilhado).
2. **Leitura** em `lib/db/queries/league-settings.ts`: `getActiveLeagues()` devolve as ativas na ordem de `SUPPORTED_LEAGUES`. Zero ativas ou erro de leitura → `FALLBACK_ACTIVE_LEAGUES` (Brasileirão + Champions, em código) com `console.warn` — a home nunca fica sem filtro default. Server Components usam `getActiveLeaguesForRequest` (React `cache()`); sync de fixtures e prewarm de odds leem uma vez no início de cada run (com injeção por parâmetro pra teste).
3. **Funções puras** (`defaultLeagueFilter`, `isActiveLeagueFilter`, `resolveHomeLeagueFilter`, `leaguePickerGroups`) recebem a lista ativa por parâmetro. Sem constantes de módulo.
4. **Seletor**: liga inativa simplesmente some (acaba o `HIDE_WHEN_INACTIVE` e o estado "fora de temporada" desabilitado).
5. **Admin** `/admin/leagues`: uma linha por liga suportada com toggle (Server Action, role admin revalidada, input em Zod), estimativa de créditos/mês (`ODDS_CREDITS_PER_MONTH_ESTIMATE`, `lib/config/odds-credits.ts`) e status dos times. Soma das ativas vs 500, com aviso quando passa. Regras em `validateLeagueToggle` (`lib/config/league-activation.ts`): não desliga a última ativa; não liga liga com `CANONICAL_TEAMS` vazio.

## Checklist de ativação de liga

1. Liga **nova** (fora de `SUPPORTED_LEAGUES`): segue exigindo ADR + registro no enum/providers/UI (como ADRs 0044/0045/0049).
2. Times: semear canônicos + ids com `pnpm tsx scripts/generate-team-ids.ts` e fazer deploy **uma vez** (mapas estáticos, ADR 0005).
3. Conferir a soma estimada em `/admin/leagues` e ligar no toggle. Sem deploy.
4. Acompanhar `quotaMonthlyUsed` no log `prewarm_odds.run_complete`; se apertar, desligar no toggle.

## Consequências

- Ligar/desligar liga vira operação de admin, efetiva no próximo request da home e no próximo run dos crons (6h).
- Uma query a mais por request da home (deduplicada por `cache()`), e uma por run de cron.
- Se a tabela sumir/falhar, o app degrada pro fallback em vez de quebrar — ao custo de Premier League/La Liga sumirem até o banco voltar.
- As estimativas de crédito são referência estática; a medição real continua no log do prewarm.
- Num DB novo em que 0045 e 0047 rodem na mesma transação, o Postgres pode recusar usar os valores de enum recém-criados; a migration pula só esse seed (Premier League/La Liga nascem desligadas) em vez de falhar.
