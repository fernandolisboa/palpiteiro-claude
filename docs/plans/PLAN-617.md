# PLAN-617 — JEV v2: próximo jogo, artilheiros e zonas da PL/La Liga no state

Issue #617. Proposta: https://claude.ai/artifact/DhAYuVkXK3PsQXsxEa1CKH. Snapshot de 2026-10-22, sobre `main` `06e7157`.

## Problema (no código)

- `buildMatchJudgmentInput` (`lib/ai/engine/judgment-input.ts`) nunca preenche `nextFixture` → `next_match` sai sempre `unknown`; `rotation_risk` só vê o descanso pra trás.
- O descanso pra trás usa só a forma (`/fixtures?team&last=5`, só jogos **encerrados**). Analisando com antecedência, um jogo de meio de semana ainda não disputado entre hoje e o kickoff some, e o time sai "long rest" quando vai jogar com < 72h.
- `enrichAbsences` aceita `topScorerNames`, ninguém passa → o tag "team top scorer" (critério de `attack_weakened`) nunca sai.
- `LEAGUE_TABLE_CONFIG` (`lib/ai/judgments/state.ts`) só tem `brasileirao_a` → `league_situation`/`season_stage` `unknown` em Premier League e La Liga.

## Desenho

### 1. Provider (API-Football), dois métodos **opcionais** na `SportsDataProvider`

Opcionais pra não quebrar os mocks de teste nem o football-data-org (que não implementa; o caller trata ausência como `unknown`).

- `getUpcomingTeamFixtures?(team, league, next): Promise<UpcomingTeamFixture[]>`
  - `/fixtures?team={id}&next={n}` (todas as competições), `n = 5`, TTL 6h, cliente compartilhado (8/min).
  - `UpcomingTeamFixture = { kickoffAt; kickoffTimestampMs; competition: string /* league.name cru */; round?: string; status }` — tipo **próprio**, sem mexer no `NormalizedFixture` (a #618 mexe nele em paralelo).
  - Filtra `cancelled`/`postponed`.
- `getTopScorers?(league): Promise<NormalizedTopScorer[]>`
  - `/players/topscorers?league&season` (temporada de `currentSeasonByLeague`), TTL 1 dia.
  - `NormalizedTopScorer = { player: { name }; team (canônico); goals }`. Nome só pro match no código (LGPD: nunca sai de `state.ts`).
- `FallbackProvider`: delega pro primeiro adapter que tem o método e suporta a liga; transient → próximo; nenhum → `SportsDataUnsupportedError`.
- Schemas Zod novos em `api-football/schemas.ts` (topscorers); fixtures reaproveita o schema existente.

### 2. Montagem do state (`judgment-input.ts` + `state.ts`)

- `MatchJudgmentData` ganha `upcoming?: { home?; away? }` e `topScorers?: NormalizedTopScorer[]`.
- **Próximo jogo:** primeiro `upcoming` com kickoff > kickoff deste jogo (exclui o próprio jogo pelo timestamp igual).
- **Jogo anterior:** o mais recente com kickoff < kickoff deste jogo entre forma **∪** `upcoming` (pega o jogo de meio de semana ainda não disputado).
- **Rótulo do próximo jogo:** `next match within 72h (<competição>, knockout)` / `(…, group stage)` / `(<competição>)`. Classificação do `round` em código (`knockout` por regex de final/semi/quartas/oitavas/round of/play-off/qualifying; `group stage` por `group`; senão só o nome). O JEV nunca compara datas.
- **Artilheiro:** por time, o(s) jogador(es) com mais gols do time na lista da liga, se ≥ 3 gols → `topScorerNames` do `enrichAbsences` daquele lado.
- **Zonas:** `LEAGUE_TABLE_CONFIG` ganha `premier_league` e `la_liga` = `{ totalRounds: 38, continentalSpots: 4, relegationSpots: 3 }` (4 = piso de Champions; vaga extra varia ano a ano, mesmo racional do G6 do Brasileirão). Também afeta `lib/user-palpite/check-claims.ts` (afirmação "jogo decisivo" passa a ser conferível nessas ligas): efeito desejado, coberto por teste.

### 3. Onde busca (uma vez, nas duas pontas)

- Dentro de `resolveMatchJudgments` (`lib/ai/predict.ts`), em paralelo com `fetchPreviousLineups`. Predict (code_jev) e o cron da base do modelo (`resolveModelBaseJudgments`) passam pelo mesmo caminho → mesmo state, mesmo `stateHash`, reuso continua funcionando.
- **Fail-open por campo:** método ausente, erro ou Unsupported → aquele campo fica fora (vira `unknown`), log `upcoming_fetch_failed` / `topscorers_fetch_failed`. Nunca derruba a análise nem pula o JEV.
- Custo: +2 req por jogo (próximo jogo dos dois times, cache 6h por time) + 1 req por liga/dia (artilheiros). Zero Odds API, zero LLM. O cron (≤48h, a cada 6h) aquece o cache que o predict usa.
- Cron: o comentário do pior caso de `RUN_DEADLINE_MS` (`lib/model-base/compute-match-models.ts`) sobe de ~7 pra ~9–10 req por jogo (~75 s a 8/min) → baixar `RUN_DEADLINE_MS` de 200 s pra 190 s mantém 190 + 75 + 15 < 300.

### 4. Versão e docs

- `JUDGMENTS_VERSION` → `jev_judgments_v2` (vocabulário do state mudou), commit `prompt:`. Pesos inalterados (`judgment_weights_v1`).
- Criteria de `rotation_risk` cita o vocabulário novo (`knockout`, competição entre parênteses).
- Efeito colateral conhecido: bases do modelo `v1` deixam de ser reusadas (`lib/user-palpite/model-base.ts` compara a versão) até o próximo cron (≤ 6h). Aceitável.
- Adendo curto no ADR 0041 (insumos v2).

### Fora

Data FIFA (sem fonte confiável; calendário fixo exigiria datas que não temos verificadas), escalação confirmada (#619), forma sem amistosos (#618), pesos.

## Testes

- `state.ts`: `nextMatchBucket` com competição + estágio; zonas PL/La Liga.
- `judgment-input.ts`: próximo jogo ignora o próprio jogo; jogo anterior vem do `upcoming` quando há jogo de meio de semana; artilheiro por time com piso de 3 gols.
- Adapter: parsing de `/players/topscorers` e `/fixtures?team&next`; filtro de adiados/cancelados.
- `FallbackProvider`: método opcional ausente → Unsupported.
- `predict`/cron: falha dos fetches novos não derruba (fail-open).

## Ajustes do review do plano (valem sobre o resto)

1. **Este jogo** é reconhecido pelos dois times numa janela de ±36 h, não pelo timestamp exato (API e banco divergem no kickoff). Vale pro anterior e pro próximo.
2. **Cache é por instância** (`inMemoryCache`): o cron não aquece o predict. Artilheiros só quando algum lado tem desfalque e só em liga nacional (nas copas a lista é só da competição). Na análise interativa, cada busca nova tem prazo de 8 s (`JUDGMENT_EXTRAS_BUDGET_MS`); passou, `unknown`.
3. **Cron:** pior caso ~12 req por jogo; `RUN_DEADLINE_MS` 200 → 180 s.
4. **Fila do cron:** base `applied` com outra `versions.judgments` vai pro bucket 0.
5. **Paridade:** no cron, busca extra que falha (não Unsupported) → `data_unavailable`, sem JEV no run; no predict, fail-open.
6. **Fora (follow-up):** `check-claims` (afirmação "vai poupar") continua só com a forma; `fetchPreviousLineups` continua só com a forma (jogo não disputado não tem escalação).
7. **Fase do torneio:** regex testada contra strings reais (Round of 16, Quarter-finals, Semi-finals, Final, Knockout Round Play-offs, 3rd Round, 2nd Qualifying Round, Group A - 3, League Stage - 5, Regular Season - 12).
8. Data FIFA fica fora.
