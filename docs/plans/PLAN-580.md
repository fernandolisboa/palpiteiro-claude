# PLAN-580: modo ao vivo (palpite, análise, Suas apostas e bolão durante o jogo)

Rascunho anterior à implementação (ver `docs/plans/README.md`). Referências conferidas no código em `953cea3` = `main` (`ef25c2b`) + os commits do PR #587 (PR B do #577, aberto: listas, ADR 0058, `RowTrailing` em `components/match-list/row-trailing.tsx` e `matchRowPhase` em `lib/view/match-list.ts:15`). Issue: #580 (pedido do Fernando, 2026-10-15; decisão do bolão às 14:02). Entra **depois** dos PRs da revisão de design que ainda estão abertos (PR #587 e PR 6 do #579, landing): os dois mexem em `match-row`, `upcoming-matches-*`, `lib/view/friend-pool.ts`, `/como-usar` e `DESIGN.md`, e este plano estende o ramo `live` do `RowTrailing`. **Exceção:** a correção do vazamento de créditos da The Odds API (§3, achado 1) é um PR avulso (PR 0, §16) que entra já, sem esperar nada. Números de linha de `page.tsx`, listas e bolão abaixo vão mudar no rebase.

Regras herdadas: nenhum nome, link ou logo de casa de apostas em tela (ADR 0048 §2; o design review já tirou os nomes das telas, ninguém em `components/` renderiza `bookmaker`); tokens e vocabulário da ADR 0029/0056 (`DESIGN.md`); um §3 por tela onde se registra aposta (ADR 0057); toda chamada de LLM por `lib/ai/predict.ts` ou pelo seam `AIProvider` com log em `ai_calls`; Zod em toda saída de LLM e em todo payload de provider; prompt mudou → versão nova + commit `prompt:`.

## 1. Decisões do dono (fixas, não reabrir)

1. Ao vivo ficam liberados: "Analisar com IA", "Gerar só o palpite", Seu palpite, Suas apostas (registrar) e bolão.
2. Placar, minuto e expulsões vêm da **API-Football**, buscados quando a página do jogo abre, com cache de 1 minuto. Sem cron novo. **Nunca** da The Odds API (free tier 500 créditos/mês); sem odd ao vivo nenhuma. A tela mostra a última odd pré-jogo, rotulada como pré-jogo.
3. Modelo em jogo **em código**: λ do Dixon-Coles proporcional ao tempo restante, condicionado ao placar atual, com desconto por expulsão. O LLM só narra (minuto e placar no contexto do prompt); as probabilidades saem do código. Prompt mudou → versão nova.
4. Registros ao vivo (análises/predições, apostas, Seu palpite, bolão) marcados como ao vivo com minuto e placar do momento, **fora** do CLV e dos recortes pré-jogo de calibração e de retorno.
5. Bolão: aceita apostas durante o jogo até **15 minutos de jogo**, quando fecha sozinho; sem minuto do provider, apito + 15 min de relógio. O dono do bolão pode fechar antes; o admin pode estender. Cada aposta grava minuto e placar da anotação. Tirar aposta depois do apito continua bloqueado. O bolão nunca movimenta dinheiro (ADR 0054 §7).
6. ADR nova (próximo número livre **no commit**: a 0058 já está no PR #587; se o PR 6 do #579 levar a 0059, esta é a 0060; conferir `ls docs/decisions` no rebase) e PRs próprios, depois dos PRs da revisão de design.
7. Kill-switch no padrão de `/admin/settings` (`ai_config`, default ON, "ship ON, sem gates manuais").
8. Settlement continua idempotente; o placar sincronizado inclui prorrogação (nota existente, ADR 0054 §5); o minuto ao vivo trata acréscimos e intervalo.

Nota sobre cota: a issue diz "cabe nas 100 req/dia", que é o free tier. O dono confirmou o plano **Pro, 7.500 req/dia**; o comentário em `lib/providers/sports-data/api-football/adapter.ts:84-86` ("free tier is 10 req/min and 100 req/day") está desatualizado e muda junto (o throttle de 8/min do cliente compartilhado continua até decisão em contrário, ver §5.4).

## 2. Sanity-check

Faz sentido e cabe no que o código já tem: o modelo é uma matriz de placar (`lib/quant/scoreline-model.ts:171`), e todo mercado da tabela é um predicado sobre o placar **final** (`pOverUnder`, `pBtts`, `p1X2`, `jointProbability`, `:265-332`). Condicionar a matriz ao placar atual e ao tempo restante faz os leitores **da matriz** (tabela, combinada, placar exato, "Seu palpite") funcionarem sem mudança. Exceção: `priceLeg` recalcula `first_half_*` e `first_to_score` a partir de `lambdaHome/lambdaAway` (`lib/bets/grade-scoreline.ts:66-69,108-110`), não da matriz; esses tipos ficam fora do ao vivo (§6.5). O custo de LLM por uso é o mesmo de hoje (uma narração), o de API-Football é ≤ 1 chamada por minuto por jogo aberto, e o de The Odds API cai (ver §3, achado 1).

Dois limites honestos que o plano assume em vez de esconder:
- **Sem odd ao vivo não existe edge.** A análise ao vivo é uma **leitura** (probabilidade, odd justa, narração), nunca uma recomendação com stake: toda predição ao vivo é `pass` (o mesmo que o gate de edge da ADR 0038 faz quando não há preço). Comparar o modelo em jogo com a odd pré-jogo fabricaria edges enormes (a odd de over 2.5 de antes do jogo não vale aos 70' com 0–0). O valor fica só onde o usuário informa a própria odd (Suas apostas, EV na odd dele, como hoje).
- **O modelo em jogo não tem backtest.** Constantes vêm da literatura (§6.2); a tela diz "modelo ao vivo" e não sugere stake ao vivo. Calibrar exige dados de jogo em andamento que o app ainda não guarda (esta feature passa a guardar: cada registro grava o estado).

## 3. Estado verificado no código (e minas achadas)

**Portão único de pré-jogo, repetido em vários lugares:**
- `matchUnavailableReason` (`lib/view/match-availability.ts:24-41`) e `matchCapabilities` (`:58-68`, hoje tudo `reason === null`), preparados pelo #576 como encaixe deste plano (`docs/plans/PLAN-576.md:310-318`).
- `notAnalyzableMessage` (`app/actions/not-analyzable.ts:31-38`), usado em `app/actions/predictions.ts:140` (race do `friendlyMessage`), `:269` (`analyzeMatch`), `:600` (`analyzeBestBet`), `:961` (`generatePalpiteFromAnalyses`), `:1082` (`analyzeMarkets`); `app/actions/bets.ts:84` (`parseBet`); `app/actions/bet-slip.ts:125` (`registerBetSlip`); `app/actions/user-palpite.ts:167` (`analyzeUserPalpite`).
- Defesa em profundidade em `lib/ai/predict.ts:440-453` (`status === "scheduled"` e `kickoffMs > now`).
- Bolão: `poolBetsOpen` (`lib/pools/pool-state.ts:7-12`) usado em `app/actions/friend-pools.ts:76` (criar), `:106` (anotar), `:127` (**tirar**), `:151` (placar manual), `app/(app)/bolao/[id]/page.tsx:57` e `lib/view/friend-pool.ts:102`.
- Linha da lista: `analyzable` em `lib/view/match.ts:96-97`; badge "ao vivo" derivada de kickoff + 3h (`:98-103`, `IN_PROGRESS_WINDOW_MS`, `lib/view/date-range.ts:35`); placar parcial só com `status = 'live'` do sync (`:129-145`).
- Base do modelo some depois do apito: `getMatchModelScoreline` devolve null quando o jogo começou (`lib/model-base/model-scoreline.ts:32`); `isSnapshotUsable` idem (`lib/user-palpite/model-base.ts:49`).

**Achado 1 (custo, já em produção, confirmado): a página do jogo gasta 2 créditos da The Odds API por visita em todo jogo já começado ou encerrado.** `ensureOddsSnapshotsFresh(match, { markets: PAGE_LIVE_MARKETS })` roda em todo render (`app/(app)/match/[id]/page.tsx:144-159`) sem olhar o kickoff, nem no chamador nem dentro da função (`lib/odds/fetch-and-snapshot.ts:50`). Mecânica:
- `PAGE_LIVE_MARKETS = [OVER_UNDER, MATCH_RESULT]` (`lib/odds/live-card-markets.ts:13`), os dois `featured`. O laço por descriptor (`fetch-and-snapshot.ts:170-259`) faz **uma** busca de liga por mercado stale (`fetchLeagueEvents([descriptor.providerMarketKey])`, `regions: ["eu"]`): `totals` e `h2h` são chamadas separadas, 1 mercado × 1 região = **1 crédito cada, 2 por visita** (o rascunho dizia 1).
- Depois do apito a janela é 30 min (`oddsFreshnessMsForKickoff` com tempo até o kickoff negativo, `lib/odds/freshness-window.ts:44-54`). A última captura é de antes do apito (cron de fechamento a cada 30 min em `[KO−40, KO]`, `vercel.json` + `lib/odds/clv-window.ts`; visitas pré-jogo), então o jogo fica stale entre 0 e 30 min depois do apito e **para sempre** depois disso.
- A busca acontece, mas não grava nada para este jogo: `getMatchesInLeagueWindow` sem `fromMs` só devolve `kickoff >= Date.now()` (`lib/db/queries/matches.ts:163-183`). O jogo nunca volta a ficar fresco, e cada visita paga de novo. Vale para jogo ao vivo **e** encerrado (link antigo, `/time/[team]`, histórico).
- O único freio é o cache em memória por instância de `getOddsForSport` (`lib/providers/odds-api.ts:387-418`): 15 min, apertado para 5 min quando algum evento do payload está a menos de 2h do início (`pickTtlForKickoff`, `:304-312`; a The Odds API devolve jogos ao vivo no `/odds`, então durante o jogo o TTL é 5 min). Em serverless, instância fria = crédito novo.
- Conta: até 2 créditos por visita fria; um jogo de 2h acompanhado com recargas numa instância quente gasta até ~48 (24 janelas de 5 min × 2); 5 visitas frias por dia a jogos começados/encerrados = 10/dia ≈ 300/mês, **60% do free tier (500/mês)**. Bônus: a tabela de mercados espera `refreshP` (`page.tsx:294-300`), então depois do apito ela também espera uma ida à The Odds API inútil.
- Não "consertar" alargando a janela de `knownMatches`: o payload traz odds **ao vivo** do jogo, que virariam snapshot e contaminariam a referência pré-jogo (o CLV está protegido por `captured_at <= kickoff`, `lib/db/queries/clv-snapshots.ts:80`, mas a tabela de mercados e o cupom não).

Correção: **PR 0 avulso, antes do #580** (independe dele e dos PRs de design): guarda dentro de `ensureOddsSnapshotsFresh` (`match.status !== "scheduled" || match.kickoffAt <= now` → não busca, devolve `getLatestOverUnderSnapshot(match.id)` como hoje), que cobre página, actions e crons num ponto só (nenhum chamador legítimo quer odd depois do apito; o CLV para no kickoff), mais a página não criar `refreshP` fora do pré-jogo. Teste: provider mock que lança, jogo com kickoff no passado → zero chamada.

**Achado 2 (mina): o dedup do desempenho deixaria a leitura ao vivo apagar a aposta pré-jogo.** `keepLatestPerMatch` (`lib/dashboard/kpis.ts:206-220`) fica com a predição **mais nova** por `(jogo, mercado)` (ADR 0020). Uma leitura ao vivo (`pass`) do mesmo mercado esconderia a aposta pré-jogo no `/dashboard` (`app/(app)/dashboard/page.tsx:55`), no admin (`app/(app)/admin/users/[userId]/page.tsx:61`) e no **gate do Kelly** (`lib/calibration/kelly-live.ts:14-25`, que deduplica igual antes de medir o CLV). Filtrar `is_live` **na query**, não depois do dedup (§11).

**Achado 3 (mina): trocar `poolBetsOpen` abriria o "tirar aposta" durante o jogo.** A mesma função decide anotar e tirar (`app/actions/friend-pools.ts:127`, botão em `app/(app)/bolao/[id]/page.tsx:172-186`). O plano separa "janela de anotação" de "pode tirar" (este continua só pré-jogo).

**Achado 4: `latestAnalysisByMarket` usa a análise mais nova por mercado** (`lib/bets/analysis-probs.ts:32-79`) na tabela de mercados e no cupom (`page.tsx:308`, `app/actions/bet-slip.ts:164-181`). Ao vivo, uma análise pré-jogo está obsoleta e uma ao vivo de 20 minutos atrás também: ao vivo a chance da tabela e da avaliação vem **sempre** do modelo em jogo calculado na hora.

**Achado 5: "live" já significa outra coisa no código.** `PalpiteModelBase.origin: "live"` = cálculo na hora (`lib/user-palpite/model-base.ts:23`, gravado em `user_palpite_analyses.model`), `PAGE_LIVE_MARKETS` = odds pré-jogo da página (`lib/odds/live-card-markets.ts:13`), o comentário de `selection_odds_snapshots` diz "ao vivo" (`db/schema.ts:772`), e a página chama o modelo calculado na hora de "modelo ao vivo" (`page.tsx:288`). Não renomear valores persistidos; nos tipos e funções novos de TS que convivem com esses usar **`inPlay`** (`InPlayScoreline`, `getInPlayState`, `inPlay`), e "ao vivo" na tela. Colunas e flag (`is_live`, `live_state`, `enable_live_mode`) e as pastas `lib/live/` e `lib/providers/live/` não colidem com nada e ficam assim.

**Achado 6: a odd pré-jogo já é garantida, mas por acidente.** Como a página nunca grava snapshot de jogo começado (achado 1) e o cron de fechamento captura em `[KO−40min, KO]` (`lib/odds/clv-window.ts:7-13`), a última captura é sempre de antes do apito. O PR 0 torna isso explícito no **escritor** (a guarda de kickoff em `ensureOddsSnapshotsFresh`); na leitura, `getReferenceOddsForMatch(..., { capturedBefore: kickoffAt })` (`lib/db/queries/reference-odds.ts:28-70`, filtro novo em `getLatestSelectionOddsSnapshotsForMatches`, `lib/db/queries/odds-snapshots.ts:219-259`) fica como defesa barata no PR B.

**Achado 7 (mina): `engine=in_play` no `model_version` vira "motor desconhecido".** `engineFromModelVersion` (`lib/ai/engine/analysis-engine.ts:36-43`) só aceita os motores de `isAnalysisEngine`; outro valor devolve null e o rótulo da análise sai "motor desconhecido" (`lib/format.ts:433-434`). A leitura ao vivo é, de fato, o contrato do `code_jev` (número em código, LLM só narra): `model_version` usa `engine=code_jev` + a tag nova `live=live_model_v1` (§8.1), e `formatAnalysisEngine` (`lib/format.ts:429`) acrescenta "ao vivo" quando a tag existe. O `is_live` é quem separa nas queries.

**Achado 8 (mina): a síntese do palpite tem dimensões que o jogo já respondeu.** `palpites_v10` devolve `firstHalfScore`, `firstToScore` e `cardsTemperature` (`lib/ai/palpites/cartridges/cartridge.ts:103-113`), e `buildSettleablePalpiteRows` vira cada uma numa linha liquidável ou divertida (`lib/ai/palpites/settleable-rows.ts:96-163`). Ao vivo, o placar do 1º tempo e quem marcou primeiro podem já estar decididos, e os cartões já estão em campo: a variante ao vivo não gera essas três (§12), e o placar provável nunca fica abaixo do atual.

**Achado 9: "Ler análise completa" mostra a mais nova por mercado** (`toMarketAnalysisSections`, `lib/view/analysis.ts:528`, ADR 0020/#243). Sem separação, a primeira leitura ao vivo substitui a análise pré-jogo de cada mercado na página. Por isso a separação pré-jogo × "Leituras ao vivo" (§11, última linha) é obrigatória no mesmo PR que grava a primeira leitura ao vivo (PR D), não um extra.

**API-Football hoje:** cliente com throttle 8/min e concorrência 2 (`adapter.ts:87-96`); `getFixtureById` com cache de 15 min (`:350-360`); status curto mapeado em `lib/providers/sports-data/api-football/constants.ts:16-45` (`1H, HT, 2H, ET, BT, P, LIVE, INT, SUSP` = live; `FT, AET, PEN, AWD, WO` = finished); schema do status tem só `long/short/elapsed` (`schemas.ts:45-49`); o item de evento (`FixtureEventItemSchema`, `schemas.ts:101-133`, hoje usado só por `/fixtures/events`) já tem `time.elapsed/extra`, `team`, `type`, `detail`. O `matches` não guarda o id do fixture do provider: as buscas resolvem por `(data, liga, nomes canônicos)` via `getFixturesByDate` (padrão de `getFixtureResult`, `adapter.ts:1015-1042`). O `id` normalizado é `compositeFixtureKey`, o mesmo de `matches.external_id` (`adapter.ts:513-518`, `lib/db/queries/matches.ts:190-200`). Settlement usa `score.fulltime` (90') via `getFixtureResult` (`adapter.ts:533-557`, `lib/settlement/settle.ts:117,168`, idem `settle-user-bets.ts:123` e `settle-palpites.ts:153,192`); `fulltime` é null até existir o resultado de 90', então durante o 1º/2º tempo o placar ao vivo é `goals`; `matches.home_score` vem de `goals` (inclui prorrogação). Ligas com mata-mata em `SUPPORTED_LEAGUES` (`lib/providers/sports-data/leagues.ts:3-14`): Champions, Libertadores, Sul-Americana e Copa do Mundo (não há Copa do Brasil); nos confrontos de ida e volta da Conmebol não há prorrogação (2º tempo → `P` direto).

**Locks e cache compartilhado:** o Vercel KV **é** usado (Upstash via `KV_REST_API_URL/TOKEN`, `@upstash/redis`): `acquireKvLock`/`releaseKvLock` genéricos por chave, com fallback em memória sem KV (`lib/sync/lock.ts:70-116`), nos crons de sync e da base do modelo, e o rate limit (`lib/rate-limit.ts`). `coalesceInFlight` (`lib/cache/in-flight.ts:12`) une chamadas iguais por instância. O throttle do cliente HTTP é por instância (`lib/providers/http/throttle.ts`), não global. Este plano **não** usa o KV (§5.2).

## 4. Visão geral

```
página do jogo / action
   └─ getInPlayState(match)            lib/live/in-play-state.ts   (cache: match_live_states, TTL 60s, lease na row)
        └─ getLiveStateProvider()      lib/providers/live/          (API-Football /fixtures?id=, Zod)
   └─ matchPhase(match, state, now)    lib/live/phase.ts            (puro)
   └─ matchCapabilities(phase, flags)  lib/view/match-availability.ts
   └─ resolveSlipModel(match, {asOf: kickoff})  lib/bets/slip-model.ts (o modelo do apito: base ≤ 24h no apito, senão DC/heurístico)
   └─ inPlayScoreline(pre, state)      lib/quant/in-play.ts         (puro, também roda no cliente)
        → tabela de mercados, cupom, Seu palpite, análise ao vivo, sem Odds API
```

Fases (`lib/live/phase.ts`): `pre` · `in_play` (1º/2º tempo, ou `NS` já depois do apito = atraso, minuto 0) · `half_time` · `extra_time` (`ET`, `BT`, `P`: os mercados de 90' já estão decididos) · `interrupted` (`INT`, `SUSP`) · `finished` · `postponed` · `cancelled` · `started_unknown` (apito passou e não há estado ao vivo utilizável).

## 5. Estado ao vivo: busca, cache, custo e falha

### 5.1 Provider (`lib/providers/`, a única camada que fala com a API)

- `lib/providers/sports-data/api-football/schemas.ts`: `FixtureStatusSchema` ganha `extra: z.number().int().nullable().optional()` (acréscimos; **inferido** da documentação atual da API-Football, validar ao vivo); `FixtureItemSchema` ganha `events: z.array(FixtureEventItemSchema).optional()` (a busca por `id` devolve eventos junto, segundo a documentação; **inferido**, validar). Tolerante: chave ausente não derruba o parse.
- `adapter.ts`: função crua `getFixtureLive(id)` = `/fixtures?id=` com chave de cache própria (não reaproveita os 15 min de `getFixtureById`, `adapter.ts:350-360`) e cache em memória **curto** (≤ 15 s, só para juntar rajadas na mesma instância): o cache que vale é a row do DB (§5.2). Com 60 s nos dois, uma instância podia gravar como "buscado agora" um payload de 59 s, e o placar chegaria a ~2 min de idade com `fetched_at` dizendo zero. `fetched_at` = instante da resposta HTTP, não do upsert.
- Seam estreito novo, no molde de `lib/providers/absences/` (ADR 0026): `lib/providers/live/types.ts` (`LiveStateProvider`, `NormalizedLiveState`), `lib/providers/live/api-football.ts`, `lib/providers/live/index.ts` (`getLiveStateProvider()` + `__setLiveStateProviderForTesting`). Sem fallback de provider (decisão 2): falhou, volta `null`.
- `NormalizedLiveState`: `{ providerFixtureId, statusShort, elapsed, extra, goals: {home, away}, red: {home, away} | null, fetchedAt }`. Sem `score.fulltime` (null durante o jogo e sem consumidor: em `ET/BT/P` não há leitura, §6.2) e sem cota por row (a cota é da conta, §5.3). Expulsões = eventos `type === "Card"` cujo `detail` casa, sem diferenciar maiúsculas, com "red card" ou "second yellow" (a caixa e o texto exatos não estão garantidos na documentação; **validar** com payload real), atribuídos por `team.id` comparado com `teams.home.id`/`teams.away.id`. `events` ausente → `red: null`, e o modelo roda sem ajuste de expulsão, rótulo "sem dados de expulsão".
- Resolução do fixture id na 1ª vez: `getFixturesByDate(kickoff UTC, liga, temporada)` (já em cache e compartilhado com o `predict`), casamento por nomes canônicos (mesmo padrão de `getFixtureResult`). O id fica em `match_live_states.provider_fixture_id`; as buscas seguintes vão direto ao `/fixtures?id=`.

### 5.2 Cache (`lib/live/in-play-state.ts` + `lib/db/queries/match-live-states.ts`)

`getInPlayState(match, { now, maxAgeMs })`:
1. Fora da janela `[kickoff − 5 min, kickoff + 4h]` → não busca (antes: pré-jogo; depois: `started_unknown` se nada terminal foi visto). 4h cobre 2º tempo + prorrogação + pênaltis com folga.
2. Lê a row de `match_live_states`. Fresca (≤ 60 s) → devolve. Terminal (`FT/AET/PEN/AWD/WO/PST/CANC/ABD`) → devolve sem buscar de novo.
3. **Lease na própria row** (sem KV): `UPDATE match_live_states SET claimed_at = now() WHERE match_id = $1 AND (fetched_at IS NULL OR fetched_at < now() - interval '60 seconds') AND (claimed_at IS NULL OR claimed_at < now() - interval '20 seconds') RETURNING match_id`. Sem row devolvida → outra instância está buscando (ou a row ficou fresca): devolve a row como está. Primeira vez (sem row): `INSERT … (claimed_at = now()) ON CONFLICT (match_id) DO NOTHING RETURNING` faz o mesmo papel.
4. Busca com teto de 4 s (`coalesceInFlight` por instância), valida com Zod, faz upsert (`claimed_at = null`).
5. Falha (rede, 4xx/5xx, Zod, teto) → log estruturado `scope: "in-play-state"` e devolve a row antiga com a idade; sem row → `null`. O lease vence sozinho em 20 s.

Por que não o lock do KV do rascunho: o KV existe (`lib/sync/lock.ts`), mas seria uma ida de rede a mais no render e um segundo sistema para manter coerente com a row; o `UPDATE … RETURNING` é atômico no Postgres, custa a mesma ida que a leitura já faz e não tem estado fora do DB. E duplicata é barata: no pior caso cada instância quente busca 1×/min, o que a cota do Pro absorve (§5.3). Se o lease der trabalho no PR, aceitar duplicatas (sem lease) é um fallback aceitável; o KV não.

O DB é o cache entre instâncias. Leituras de lista nunca buscam: `getInPlayStatesForMatches(ids)` lê as rows de uma vez.

Idades que importam (constantes em `lib/live/freshness.ts`):
- `IN_PLAY_FRESH_MS = 60_000`: refaz a busca.
- `IN_PLAY_ACT_MAX_AGE_MS = 120_000`: idade máxima para **registrar** (aposta, análise, Seu palpite, bolão com placar). Mais velho → a action tenta buscar; sem sucesso, recusa com "Placar ao vivo indisponível agora. Tente em um minuto." (exceto o bolão, §10).
- `IN_PLAY_SHOW_MAX_AGE_MS = 10 min`: até aqui a tela mostra o placar com "atualizado há X"; depois, "placar ao vivo indisponível".

As actions **nunca** confiam em minuto/placar vindos do cliente: releem `getInPlayState` no servidor.

### 5.3 Custo (API-Football Pro, 7.500 req/dia)

- Por jogo aberto: ≤ 1 chamada/min, globalmente (lease + row), do apito ao fim, **e só se alguém abrir a página naquele minuto** (sem cron, sem polling). Teto de um jogo de ~2h05 recarregado sem parar ≈ **125 chamadas** + 1 de resolução (em geral do cache de 1h de `getFixturesByDate`, `adapter.ts:301-323`). Depois do `FT`, zero.
- Teto de uma rodada: 10 jogos acompanhados do início ao fim ≈ 1.260/dia; 20 ≈ 2.500, um terço da cota. Consumo de hoje fora disso é pequeno (sync 4×/dia, `vercel.json`; refit 1×/dia; base do modelo 4×/dia, ~6-8 chamadas por jogo com JEV, ADR 0052 §8; análises ~6-8 cada).
- Guarda: o cliente já extrai `x-ratelimit-requests-remaining`/`-limit` de cada resposta (`extractQuota`, `lib/providers/http/quota-logger.ts:46`) e guarda a última leitura por provider em memória (`getLastQuota`, `:77`). Sem coluna nova: antes de buscar, `getLastQuota("api-football-live")` (ou a do cliente compartilhado, a mais recente) abaixo de **5%** do limite diário → não busca e devolve a row com a idade. Leitura por instância e zerada no cold start, o que basta para um freio de segurança (o caso normal fica muito abaixo da cota).
- Zero chamada à The Odds API em qualquer caminho ao vivo (teste de guarda, §14; a guarda do PR 0 dentro de `ensureOddsSnapshotsFresh` já garante isso por construção).

### 5.4 Throttle

O cliente atual tem 8 req/min e concorrência 2 por instância (`adapter.ts:87-96`), dimensionado para o free tier. Uma busca ao vivo atrás de um `predict` (6-8 chamadas) esperaria até 1 min na fila. Default: **cliente próprio para o ao vivo** (`createProviderClient({ name: "api-football-live", … })`, mesmos headers de cota, throttle 30/min, concorrência 2) com o teto de 4 s. A página de planos da API-Football dá ao Pro um limite por minuto bem acima disso (a conferir no header `X-RateLimit-Limit` na primeira chamada com a chave, pergunta 1, §17); subir o throttle do cliente compartilhado fica fora deste plano.

## 6. Modelo em jogo (`lib/quant/in-play.ts`, puro, `LIVE_MODEL_VERSION = "live_model_v1"`)

### 6.1 Entrada

- Pré-jogo, **o mesmo modelo que a página mostrava no apito** (paridade do minuto 0): `resolveSlipModel(match, { asOf: kickoffAt })` (`lib/bets/slip-model.ts:27-56`), sem arquivo novo. O `asOf` só repassa `now = kickoff − 1 ms` a `getMatchModelScoreline` (`lib/model-base/model-scoreline.ts:20-23`, que já aceita `now`): a idade da base (24h, `MATCH_MODEL_MAX_AGE_MS`) é medida no apito e o corte "jogo já começou" (`:32`) não dispara. O cron da base para no apito (`lib/model-base/compute-match-models.ts:198-201`) e roda 4×/dia, então a última base é de ≤ 6h antes do jogo. λ = o ajustado (pós-JEV), ρ = o do fit. Sem base → o mesmo fallback de hoje (`getModelScoreline` com a tabela; o fit é de hoje, não do apito, diferença aceitável). Sem os dois → sem modelo (a tabela mostra só a odd pré-jogo; o registro segue sem avaliação, `gradeSource = 'none'`).
- Estado: placar atual `(h0, a0)` = `goals` (em `1H/HT/2H` é o placar de 90' em andamento), status, `elapsed`, `extra`, expulsões.

### 6.2 Fração do jogo que falta, `r`

Gols não são uniformes: o código já usa κ₁ = 0,45 para o 1º tempo (`KAPPA_FIRST_HALF`, `lib/quant/scoreline-model.ts:334`); κ₂ = 1 − κ₁ = 0,55. Cada tempo é tratado como uniforme na sua duração esperada com acréscimos (aproximação conhecida: a intensidade sobe no fim do 2º tempo e depende do placar; registrar na ADR como limite do v1).

Constantes (todas no módulo, versionadas por `live_model_v1`, **provisórias**, a calibrar com os dados que a feature passa a gravar):
- `S1 = 3`, `S2 = 6` minutos de acréscimo esperado; `L1 = 45 + S1`, `L2 = 45 + S2`.
- `ε = 0,5` minuto: piso do que falta num tempo que ainda está rolando (acréscimo maior que o esperado não zera `r`).
- Minuto dentro do tempo `k` (1 ou 2), chamado `m` (não `τ`, que é o do Dixon-Coles): `m = max(0, (extra != null ? min(elapsed, 45·k) + extra : elapsed) − 45·(k−1))`. Cobre `45+2` (`elapsed 45, extra 2` → `m = 47`), provider que manda `elapsed = 47` sem `extra`, e `2H` com `elapsed = 45` no reinício (`m = 0`).

| Fase | r |
|---|---|
| `TBD`/`NS` depois do apito (atraso) | 1 |
| `1H` | κ₁ · max(L1 − m, ε)/L1 + κ₂ |
| `HT` | κ₂ |
| `2H` | κ₂ · max(L2 − m, ε)/L2 |
| `ET`, `BT`, `P` (mata-mata) | sem leitura: os mercados são de 90' e já estão decididos pelo placar de 90' |
| terminais | sem leitura |
| `1H/2H` com `elapsed` null, `LIVE`, `INT`, `SUSP` | sem modelo (`minute_unknown` / `interrupted`) |

`r` é não crescente no tempo (o salto de `κ₁·ε/L1` para baixo na entrada do `HT` é esperado). No minuto 0 do `1H`, `r = κ₁ + κ₂ = 1`.

### 6.3 Expulsões

`d = clamp(redHome − redAway, −2, 2)` (líquido: 1×1 se anula, simplificação aceita; 3+ de um lado é raríssimo e o jogo é encerrado com menos de 7). Multiplicadores sobre o λ **restante**, na ordem de grandeza da literatura de intensidade de gols depois de um vermelho (quem fica com menos marca ~30% menos, o adversário ~20-30% mais; **valores provisórios**): `RED_OWN = 0,70`, `RED_OPP = 1,25`. Como a expulsão já aconteceu, vale para todo o tempo que falta; não precisa do minuto do cartão.
- d > 0 (mandante com menos): `mH = RED_OWN^d`, `mA = RED_OPP^d`.
- d < 0: `mH = RED_OPP^|d|`, `mA = RED_OWN^|d|`.
- Sem dado de expulsão (`red: null`): `mH = mA = 1` e o rótulo diz.

### 6.4 Matriz final: condicionar o Dixon-Coles ao placar atual

- Gols que faltam: `μH = λH · r · mH`, `μA = λA · r · mA`.
- O pré-jogo é `P(h, a) ∝ Pois(h; λH) · Pois(a; λA) · τ(h, a; λH, λA, ρ)`, com o τ só nas células **finais** 0-0, 1-0, 0-1 e 1-1 e renormalização (`scorelineMatrix`, `lib/quant/scoreline-model.ts:171-206`). Lendo isso como "gols de cada time chegam por Poisson ao longo do jogo e o τ repondera o placar **final**", a condicional exata dado o placar atual é:

  `F[h][a] ∝ Pois(h − h0; μH) · Pois(a − a0; μA) · τ(h, a; λH, λA, ρ)` para `h ≥ h0` e `a ≥ a0`; 0 no resto; renormalizada sobre a grade.

- O τ usa os parâmetros **do pré-jogo** (λ e ρ cheios, sem o multiplicador de expulsão) e as coordenadas **finais**: só pesa enquanto o placar atual ainda alcança alguma das quatro células (0-0: as quatro; 1-0: 1-0 e 1-1; 0-1: 0-1 e 1-1; 1-1: só 1-1; algum lado com 2+: nenhuma, Poisson puro, como no DC).
- Por que não `scorelineMatrix(μH, μA, { rho: ρ·r })` deslocada (rascunho anterior): ela põe o τ nos gols **que faltam**. Aos 60' com 1-0 isso repondera os finais 1-0, 2-0, 1-1 e 2-1, que não é o que o DC mede, e precisava do ajuste ad hoc `ρ·r` para o τ sumir no fim. A condicional acima bate nos dois limites sem ajuste: `r = 1`, 0-0, sem expulsão → exatamente `pre.matrix` (mesma conta, mesma grade); `r → 0` → massa pontual no placar atual (o τ se cancela na renormalização). E é **coerente** com o pré-jogo: sem expulsão, a média de `F` sobre a distribuição do placar no minuto t que o próprio modelo implica devolve `pre.matrix` (lei da probabilidade total, conferida numericamente); a versão do rascunho não tem essa propriedade, então o mesmo modelo daria números que não fecham entre antes e durante o jogo. A diferença não é desprezível em 0-0: com λ = 1,4 × 1,1, ρ = −0,1 (`:51`) e r = 0,35 (~60'), P(termina 0-0) = **46,8%** na coerente, 42,0% na do rascunho e 41,7% no Poisson puro (conta conferida numericamente na revisão; a mistura reproduz `pre.matrix` com erro ~4e-8, da truncagem). Com algum lado em 2+, a coerente vira Poisson puro (como o DC, que não mexe nessas células) e a do rascunho ainda repondera. Qual das duas calibra melhor é pergunta para os dados que a feature grava (§17, pergunta 2); o v1 fica com a coerente.
- Implementação: extrair o τ de `scorelineMatrix` (`:187-196`) num helper exportado `dixonColesTau(h, a, λH, λA, ρ)` (mesmo clamp ≥ 0), usado pelas duas funções, para a paridade do minuto 0 sair por construção. Grade de `F`: `maxGoals = max(h0, a0) + MAX_GOALS` (`MAX_GOALS = 10`, `:50`), gols restantes truncados em `MAX_GOALS` como no pré-jogo. `poissonPmf` já lida com λ = 0 (`:155-159`).
- Saída `InPlayScoreline = ModelScoreline & { inPlay: { liveModelVersion, r, minuteLabel, score, red, muHome, muAway, multipliers, preMatch: { source, lambdaHome, lambdaAway, rho, baseCheckedAt } } }`, com `matrix = F`, `rho` = o do pré-jogo e `lambdaHome/lambdaAway = h0 + μH / a0 + μA` (gols esperados no fim, só para exibição; ver §6.5).

### 6.5 O que não funciona sozinho em jogo

- **Leitores que recalculam do λ, não da matriz:** `priceLeg` faz `firstHalfScorelineMatrix(model.lambdaHome, …)` e `firstToScoreProbs(model.lambdaHome, …)` (`lib/bets/grade-scoreline.ts:66-69,108-110`). Com `InPlayScoreline` os dois sairiam errados. Regra: ao vivo, `first_half_score`, `first_half_over_under` e `first_to_score` não são aceitos em Suas apostas (recusa no servidor, §9.2) e `priceLeg` devolve `no_data` para eles quando `inPlay` existe (defesa no próprio leitor). Os demais tipos (`exact_score`, `margin`, `clean_sheet`, total, 1X2, dupla chance, BTTS) leem só a matriz.
- **Seleção decidida:** decidir por **predicado sobre o placar atual**, não por `P ∈ {0, 1}` (a soma em ponto flutuante dá 0,9999…): `isDecided(kind, params, score)` puro em `lib/quant/in-play.ts` (over com `h0 + a0 > linha` → ganhou; under idem → perdeu; BTTS sim com os dois ≥ 1 → ganhou; placar exato abaixo do atual em algum lado → perdeu; `clean_sheet` do lado que já sofreu → perdeu; 1X2 e dupla chance nunca, antes do fim). A tabela e as actions usam o mesmo predicado.
- **Mata-mata:** Champions, Libertadores, Sul-Americana e Copa (`leagues.ts:3-14`). A partir de `ET/BT/P` não há leitura nem registro (os mercados são de 90' e o settlement usa `score.fulltime`, §3); a tela mostra o placar com "prorrogação"/"pênaltis".

Propriedades (testes): r = 1, 0×0, sem expulsão → `F` idêntica célula a célula a `pre.matrix` (tolerância 1e-12); `r` não cresce com o tempo; HT = κ₂; placar abaixo do atual tem probabilidade 0; Σ = 1; `isDecided` cobre over 1.5 com 2×0 (ganhou), BTTS com 1×1 (ganhou), placar exato 0×0 com 1×0 (perdeu); r → 0 → massa pontual no placar atual; com placar 2×0 o resultado é igual ao produto de Poisson puro deslocado (τ inerte); coerência: sem expulsão, para t em {15', HT, 70'}, `Σ_{h0,a0} w(h0,a0) · F_{h0,a0} = pre.matrix` (tolerância 1e-6, por causa da truncagem), com `w ∝ Pois(h0; λH(1−r)) · Pois(a0; λA(1−r)) · Z(h0,a0)` e `Z` o normalizador de `F`; d = +1 e d = −1 simétricos ao trocar mandante/visitante.

## 7. Fase do jogo e capacidades (gating por capacidade)

`lib/view/match-availability.ts`:
- `matchPhase(match, state, now)` (reexportada de `lib/live/phase.ts`). Com `enable_live_mode` desligado ou `state` null, cai no que existe hoje (`matchUnavailableReason`), então nada muda com a flag OFF.
- `MatchUnavailableReason` ganha `extra_time`, `interrupted`, `live_unavailable` (apito passou, estado indisponível ou velho demais).
- `matchCapabilities(phase, { liveMode, modelReady })` passa a devolver regras próprias:

| Capacidade | Pré-jogo | `in_play` / `half_time` com estado ≤ 2 min e minuto conhecido | resto |
|---|---|---|---|
| `analyze` ("Analisar com IA", "Gerar só o palpite") | sim | sim, se há modelo | não |
| `seuPalpite` | sim | sim, se há modelo | não |
| `registerBets` | sim | sim (sem modelo: registra sem avaliação) | não |
| `pool` (atalho "criar bolão") | sim | `poolWindowOpen(match, state, now)` (§10) | não |
| `analyzeMarkets` (novo: reanálise por mercado e mercados escolhidos) | sim | **não** | não |

- `notAnalyzableMessage` vira `capabilityBlockedMessage(capability, reason)` (copy por motivo); os chamadores de §3 passam a perguntar pela capacidade deles. `analyzeMatch` (`predictions.ts:175`, a reanálise de um mercado pelo rodapé da seção, `components/section-footer-dispatch.tsx:48`) e `analyzeMarkets` (`:1052`, os mercados escolhidos pelo usuário, #245) continuam **só pré-jogo**: são um `predict()` pago por mercado, contra odds, incluindo os cartuchos LLM de placar exato, artilheiro e assistência, e a decisão 1 do dono só nomeia "Analisar com IA" e "Gerar só o palpite". Ganham uma capacidade própria `analyzeMarkets` (= pré-jogo) para a UI esconder os dois botões ao vivo, em vez de herdar `analyze`.
- Corrida no apito: uma análise pré-jogo disparada segundos antes do apito pode chegar ao `predict()` já depois dele e cair no `match is not analyzable` (`predict.ts:440-453`). Com a flag ligada, a copy de `friendlyMessage` (`predictions.ts:127-142`) passa a dizer "O jogo começou. Toque em Analisar com IA de novo para a leitura ao vivo."
- `predict.ts:440-453` não muda: o caminho de pré-jogo segue barrado depois do apito. O caminho ao vivo é uma função nova com portão próprio (§8.1).
- Copy: `app/actions/not-analyzable.ts:13-19`, `lib/view/match-availability.ts:71-116` e `page.tsx:568` ("O Seu palpite fica aberto até o apito inicial.") ganham os estados novos; `app/(app)/como-usar/como-usar-content.tsx:222` ("A análise só roda antes do apito inicial") muda.

## 8. Análise ao vivo ("Analisar com IA" e "Gerar só o palpite")

### 8.1 `lib/ai/predict.ts`: `predictInPlay` (porta única continua sendo este arquivo)

Função exportada nova, sem tocar em `runPredict`:
1. Recebe `{ matchId, userId, isAdmin, modelOverride, state, deadlineAt }`. Rechecagem: fase `in_play`/`half_time`, `state.fetchedAt` ≤ 2 min, minuto conhecido (o estado vem da action, que o leu no servidor).
2. Sem chamada de odds (nenhum `getOddsProvider`, nenhum `ensureOddsSnapshotsFresh`, nenhum pré-aquecimento de mercado *additional*). Sem JEV novo: o λ pré-jogo já é pós-JEV.
3. **Sem** o contexto de pré-jogo do narrador (forma, H2H, tabela, desfalques, escalações: as 6 buscas de `predict.ts:488-517`). Esses fatores já estão no λ pré-jogo, e buscá-los ao vivo passaria pela fila de 8/min do cliente compartilhado (§5.4) para um texto que narra minuto, placar e chances. O contexto do `narrator_live_v1` é só: times, liga, situação do jogo (minuto, placar, expulsões), as chances de `F` e a fonte do pré-jogo (base do jogo ou cálculo na hora).
4. `F = inPlayScoreline(resolveSlipModel(match, { asOf: kickoffAt }), state)` (§6.1). Mercados: `match_result`, `double_chance`, `btts`, `over_under` 2.5 (e 1.5/3.5 com `enable_over_under_extra_lines`), nesta ordem, filtrados pela audiência/liga como o fan-out de hoje (`predictions.ts:613-620`). Seleção já decidida (`isDecided`, §6.5) entra com 0/100 e a nota "já decidido"; o 1X2 nunca está decidido antes do fim, então sempre há o que narrar.
5. Uma predição por mercado: `recommendation = 'pass'`, `stake_units` default, `odd_at_recommendation/implied/edge/bookmaker` null, `confidence_pct` = P da 1ª seleção (convenção de `predict.ts:924-931`), `model_version = "<modelo>;engine=code_jev;lambda=<dixon_coles|heuristic>;live=live_model_v1"` (achado 7: `engine=in_play` viraria "motor desconhecido"), `prompt_version` do narrador ao vivo, `judgments` null, `is_live = true`, `live_state` = o carimbo + `inPlay` (recomputável a partir da row). `prediction_selection_odds` com `odd` **NULL** e `model_prob_pct` (migration: `odd` deixa de ser NOT NULL; o leitor do histórico já preserva null, `lib/db/queries/predictions.ts:68-87`; a calibração hoje só pularia a row **por acaso**: `Number(null) = 0` cai no `catch` de odd ≤ 1, `lib/db/queries/calibration.ts:160-163,207-212`, então o filtro explícito de §11 é obrigatório e `calibration.ts` passa a tratar `odd === null` de propósito). Os outros leitores de `prediction_selection_odds.odd` são só esses dois (`grep` no repo); o tipo Drizzle vira `string | null` e o `typecheck` aponta qualquer outro.
6. Narração: **uma** chamada paga, do 1X2 (o mercado de Tier 1 que sempre existe), pelo cartucho `narrator_live_v1` (§12) via o mesmo `narrateDecision` (log em `ai_calls`, prazo, `beforeLlmPath`); os demais mercados levam o racional template de `templatedNarration` (`lib/ai/markets/_narrator/fallback.ts:9`). Mesma sequência do best bet de hoje, que **não** é uma transação única: `narratePendingPrediction` grava o `ai_calls` (`predict.ts:334-352`, insert em `:2244`), `persistPendingPrediction` grava cada predição com o `aiCallId` (`:354-376`, `persistPrediction` em `:1639`), e o PSO entra depois, best-effort (`:1705-1730`). `predictInPlay` monta `PendingCodeJevPrediction`s e reusa essas duas funções (com o cartucho ao vivo), em vez de um caminho de persistência novo.

### 8.2 Actions (`app/actions/predictions.ts`)

- `analyzeBestBet` (`:553`): mesmos portões grátis (auth, acesso, flag `enable_best_bet_fan_out`, jogo). Depois, `getInPlayState` + `matchPhase`: pré-jogo → caminho de hoje, intocado; ao vivo → `enable_live_mode`, modelo pronto, **1 unidade** do limite diário (`chargeRunBudget`, `:468`; os mercados decididos em código já contam como uma unidade, `:653-660`), `predictInPlay`, síntese ao vivo **sem busca de notícias** (`startNewsFetch`, `:728-730`, não roda ao vivo: custa e não ajuda no minuto 60). O "Contexto extra" (`#565`) **não** é oferecido ao vivo nesta versão (fatores de pré-jogo; expulsões já vêm do provider): o campo some do HERO e a action descarta o texto.
- `generatePalpiteFromAnalyses` (`:931`): ao vivo, só sobre leituras ao vivo **atuais** (mesmo placar e mesmas expulsões do estado de agora, e no máximo 10 min de jogo atrás). Senão: "O jogo mudou desde a última leitura. Use Analisar com IA."
- `summarizeSavedAnalysesForSynthesis` (`lib/ai/palpites/synthesis-input.ts:77`) ganha o filtro `isLive` (pré-jogo ignora as ao vivo e vice-versa).
- `palpite_sets` da síntese ao vivo: `is_live = true`, `live_state`. Linhas liquidáveis só as derivadas do placar final (`exact_score`, `margin`, `clean_sheet`, `buildSettleablePalpiteRows`), pela regra de hoje; sem `first_half_score`, `first_to_score` e `cards` (achado 8). Placar provável abaixo do atual em algum lado é corrigido em código para o placar final mais provável de `F` (gate de emissão, como o de coerência do 1º tempo, `settleable-rows.ts:130-133`; nunca recusa a síntese).
- `friendlyMessage` (`:121-173`): o caminho de race usa `capabilityBlockedMessage("analyze", …)` (copy de §7).

## 9. Seu palpite e Suas apostas ao vivo

### 9.1 Seu palpite

- Leitura grátis pelos botões (ADR 0055 §1): `SeuPalpiteModelView` (`lib/view/user-palpite.ts:37-43`, que já leva λ e ρ do pré-jogo) ganha `inPlay: { h0, a0, r, mH, mA } | null`; `readingMatrix` (`lib/user-palpite/reading.ts:32-38`) monta `F` com a mesma função pura de `lib/quant/in-play.ts` (client-safe, sem import de servidor; o τ usa os λ/ρ que a view já tem, §6.4). Placares abaixo do atual saem 0% e o botão diz "já passou".
- "Analisar meu palpite" (`app/actions/user-palpite.ts:138`): portão por capacidade; base = a do apito (`resolvePalpiteModelBase(match, { asOf: kickoffAt })`: o mesmo `asOf` de §6.1 repassado a `isSnapshotUsable`, `lib/user-palpite/model-base.ts:45-53`); a evidência do usuário entra no λ **pré-JEV** como hoje (`lambdasFor`) e só depois vem a transformação em jogo (nunca duas vezes o JEV); narração `user_palpite_narrate_live_v1` (§12); `user_palpite_analyses.is_live/live_state`. Extração sem mudança (`user_palpite_extract_v1`). Mesmo limite diário de palpites.
- O valor persistido `origin: "live"` de `PalpiteModelBase` (cálculo na hora) **não** muda (achado 5); o ao vivo é marcado por `is_live`.

### 9.2 Suas apostas

- `registerBetSlip` (`app/actions/bet-slip.ts:88`): portão `registerBets`; estado relido no servidor (≤ 2 min, senão tenta buscar, senão recusa); ao vivo aceita só os tipos da tabela (`match_result`, `double_chance`, `btts`, `over_under` 1.5/2.5/3.5, `exact_score`; fora ficam em especial `first_half_*` e `first_to_score`, §6.5) e recusa seleção já decidida (`isDecided`, §6.5) com "Esse mercado já está decidido."; `evaluateSlip` (`lib/bets/evaluate-slip.ts:220`) recebe o modelo em jogo, `references = new Map()` (sem "edge do modelo": a referência é pré-jogo, ADR 0053 §5 não vale ao vivo), `analysis = new Map()` (achado 4) e a opção nova `suggestStake: false` (sem banda nem Kelly ao vivo: modelo sem calibração). `bet_slips.is_live/live_state`. A odd do usuário continua fora do Σ1/odd.
- `parseBet` (`app/actions/bets.ts:58`): liberado ao vivo (só preenche a lista); tipos fora da tabela viram aviso.
- Cliente: ao vivo a odd **não** é pré-preenchida com a pré-jogo (`components/bet-slip/bet-slip-provider.tsx:100-101`); o campo fica vazio e a avaliação diz "sem a odd que você pegou…" como hoje.
- `/apostas`: selo "ao vivo · 63' · 1–0" no slip; `summarizeSlipLedger` (`lib/bets/slip-ledger.ts:108`) devolve o resumo de pré-jogo (o de hoje) e uma linha separada "ao vivo" (§11). `getUserBetSlipLedger` (`lib/db/queries/user-bets.ts:250`) e `getUserBetSlipsPage` (`:349`) passam `isLive`.

## 10. Bolão

Regras (`lib/pools/pool-state.ts`, puras, `now` injetável):
- `poolEntriesRemovable(match, now)` = pré-jogo (o `poolBetsOpen` de hoje, renomeado). Usado em `removeFriendPoolEntry` (`friend-pools.ts:127`) e no botão (`bolao/[id]/page.tsx:172`). **Não muda** com o ao vivo.
- `poolWindowOpen(match, state, now)` (criar bolão em `createFriendPool`, `friend-pools.ts:76`, e o atalho da página): pré-jogo, ou ao vivo antes do corte automático:
  - minuto do provider conhecido: aberto enquanto fase `NS`-atrasado ou `1H` com minuto estimado < 15. Minuto estimado = `elapsed` + (now − `fetchedAt`) em minutos, para não deixar aberto por um estado velho (no `1H`, `extra` só existe depois do 45', irrelevante para o corte). `HT` em diante: fechado. O atraso (`NS` depois do horário) mantém aberto: o corte é de minuto **jogado**.
  - sem minuto (sem estado, estado sem `elapsed`, provider fora): aberto enquanto `now < kickoff + 15 min` de relógio.
  - `postponed`, `cancelled`, `interrupted`, `finished`: fechado.
  - `enable_live_mode` desligado: fecha no apito (hoje).
- `poolBetsOpen(pool, match, state, now)` (anotar) = `pool.betsClosedAt` no passado → fechado; senão `pool.betsExtendedUntil` no futuro e jogo não terminado → aberto; senão `poolWindowOpen`.
- Placar manual (`friend-pools.ts:151`): exige apostas fechadas (`!poolBetsOpen(...)`), como hoje; a copy passa de "depois que o jogo começa" para "depois que as apostas fecham".

Controles:
- **Dono** ("Fechar apostas", `closeFriendPoolBets`): grava `bets_closed_at = now` e limpa `bets_extended_until`. Só fecha, não reabre.
- **Admin** ("Estender prazo", `extendFriendPoolBets`, `session.user.role === "admin"`): presets +15 / +30 / +60 min a partir de agora, teto `kickoff + 3h`; limpa `bets_closed_at`, grava `bets_extended_until` e `bets_extended_by_user_id`. Só nos bolões **do próprio admin**: o código responde esta pergunta, porque só o dono abre o bolão (`getFriendPool(poolId, userId)`, `friend-pools.ts:104`; ADR 0054 §2: só o usuário logado anota, para todo mundo) e não existe tela de admin de bolões. Na prática o dono comum só fecha antes; o admin, dono dos próprios bolões, também estende. Estender o de outra pessoa exigiria uma tela nova e fica fora.
- Anotar ao vivo grava `friend_pool_entries.is_live = true` e `live_state` (minuto e placar; no fallback de relógio, `source: "clock"`, sem placar). O estado é lido no servidor; se estiver velho (> 2 min) a action tenta buscar e, sem sucesso, anota com o carimbo de relógio (o bolão não depende do modelo, então não bloqueia).
- De onde vem o estado: o detalhe (`/bolao/[id]`) chama `getInPlayState` só enquanto o bolão pode estar aberto (do apito até o corte ou o fim da extensão; é "abrir a página", decisão 2); a lista (`/bolao`, `poolStatusView` em `lib/view/friend-pool.ts:94-110`) só lê as rows (`getInPlayStatesForMatches`), sem busca. Sem row: relógio.
- O seletor de jogo do "Novo bolão" (`app/(app)/bolao/page.tsx:46-55`, `statuses: ["scheduled"]`) passa a incluir jogos com o apito nos últimos 15 min (ou estendidos, para o admin) que ainda estão na janela.
- Lista e detalhe: selo "fecham aos 15'" / "fecham em 8 min" / "fechadas pelo dono" / "estendido até 17:40" (`lib/view/friend-pool.ts:86-114`); cada aposta ao vivo mostra "aos 12' · 0–0". Nada de odd, casa ou valor novo (ADR 0054 §7).
- Ganhadores: `resolvePoolScore` não muda (manual > `matches` encerrado; inclui prorrogação, ADR 0054 §5). A pontuação também não muda (decisão 5): uma aposta anotada aos 12' com 1–0 vale o mesmo que uma de antes do jogo. O que segura a regra de ADR 0054 §3 é a transparência: o carimbo aparece na lista **e** na linha do ganhador ("acertou · anotada aos 12', 1–0"), não há edição de aposta, e tirar continua bloqueado. Isso basta para o caso (todas as apostas são digitadas pelo dono, na frente do grupo); odd ou peso por minuto mudaria a regra que o dono fixou e fica fora. Excluir o bolão inteiro continua possível, como hoje.

## 11. Exclusões: CLV, calibração e retorno

Regra: `is_live = false` entra **na query**, antes de qualquer dedup.

| Onde | Mudança |
|---|---|
| `getMarketCalibrationRows` (`lib/db/queries/calibration.ts:54`, filtro em `:108-113`) | `eq(predictions.isLive, false)` no `settledFilter` (vale para as duas queries que o usam, a das predições e a do PSO). Obrigatório: a calibração **inclui `pass`** de propósito (`:102-107`), então leituras ao vivo entrariam se tivessem odd. Cobre `/admin/calibration` (`app/(app)/admin/calibration/page.tsx:84`) e o recorte over/under do gate do Kelly (`getOverUnderCalibrationRows`, `:282`). |
| `selectDashboardRows` (`lib/db/queries/dashboard.ts:78-127`) | parâmetro `{ live: false }` por padrão. `getUserDashboardRows` (`/dashboard`, admin por usuário) e `getAllDashboardRows` (gate do Kelly, `lib/calibration/kelly-live.ts:16`) ficam só com pré-jogo, antes do `keepLatestPerMatch` (achado 2). Isso cobre também o *pass rate* e os recortes de `lib/dashboard/derive-view.ts`, que leem as mesmas rows. |
| CLV | `enrichDashboardRowsWithClosing` (`lib/dashboard/clv-enrich.ts:17-60`) e `getClosingSnapshotForDetail` (`lib/db/queries/clv-snapshots.ts:120-133`) já pulam `pass`; ganham a guarda explícita `isLive` (se um dia houver leitura ao vivo com seleção, não entra no CLV). O cron `capture-closing-odds` só olha jogos com KO nos próximos 90 min, então nunca é disparado por registro ao vivo. |
| `/apostas` | resumo de retorno = só pré-jogo; linha "ao vivo" separada (`summarizeSlipLedger`). |
| `getRecentPredictedMatchesByUser` (`lib/db/queries/predictions.ts:368`, renomeada no PR #587; era `getRecentPredictionsByUser`) | traz `isLive` para o selo no cartão do jogo; sem filtro. |
| Varridos e sem mudança | `getNonPassPredictionsNearKickoff` (`predictions.ts:268`, cron de fechamento: só não-`pass`, perto do KO); `findReusableJudgments` (`lib/db/queries/judgments.ts`: exige `judgments` aplicado, e a leitura ao vivo grava null); `getMatchIdsWithPredictionsByUser` (`matches.ts:236`, só "tem análise"); settlement (abaixo). São todos os `from(predictions)` do repo. |
| Página do jogo | "Ler análise completa" agrupa pré-jogo e "Leituras ao vivo" (com o carimbo); a seção de pré-jogo continua sendo a da última análise pré-jogo por mercado. |

Settlement (`lib/settlement/settle.ts`, `settle-user-bets.ts`, `settle-palpites.ts`) **não muda**: registros ao vivo liquidam pela mesma regra e pelo mesmo placar de 90' do provider; `pass` vira `void/0` como hoje (`lib/settlement/compute.ts:70`). O `match_live_states` é só exibição e portão: nunca alimenta settlement nem escreve em `matches` (o sync continua o único escritor de `matches`).

## 12. Prompts e versões

Pré-jogo **byte-idêntico** (as séries de calibração por versão não se misturam). Variantes ao vivo com versão própria, cada uma num commit `prompt:`:

| Cartucho | Hoje | Ao vivo |
|---|---|---|
| Narrador (`lib/ai/markets/_narrator/prompt.ts:5`) | `narrator_v1.1` (sem mudança) | **`narrator_live_v1`**: a "decisão" é uma leitura sem aposta ("sem odd ao vivo, o app não recomenda aposta"); bloco "Situação do jogo" com minuto ("63'", "45+2'", "intervalo"), placar e expulsões; regra de números = só os percentuais do bloco "Leitura ao vivo"; proibido "aposte", "valor", "edge". Mesmo tool `submit_narration`, mesmo Zod e mesmo guarda de fidelidade (`fidelity.ts`), que já serve sem mudança: confere só percentuais (±1 p.p.) e lado, então "63'" e "1–0" passam, e já reprova "recomendar aposta num pass", que é o caso de toda leitura ao vivo. Contexto enxuto (§8.1, passo 3). |
| Síntese do palpite (`lib/ai/palpites/cartridges/cartridge.ts:65`) | `palpites_v10` (sem mudança) | **`palpites_live_v1`**: recebe a situação do jogo e os placares finais mais prováveis de `F`; schema próprio `.strict()` **sem** `firstHalfScore`, `firstToScore` e `cardsTemperature` (achado 8); placar provável ≥ placar atual (gate de emissão, §8.2). Sem notícias (§8.2). O validador de fidelidade (#380) recebe o placar atual como fato permitido (risco: §18). |
| Narração do Seu palpite (`lib/ai/user-palpite/narrate-cartridge.ts:32`) | `user_palpite_narrate_v1` (sem mudança) | **`user_palpite_narrate_live_v1`**: minuto e placar no contexto; veredito continua em código (`palpite_verdict_v1`). |
| Extração (`user_palpite_extract_v1`), parse (`bet_parse_v2`), JEV | sem mudança | sem mudança |

`LIVE_MODEL_VERSION = "live_model_v1"` vai no `model_version` e no `live_state`; mudou fórmula ou constante → bump.

## 13. UI

Página do jogo (`app/(app)/match/[id]/page.tsx`):
- `getInPlayState` entra no `Promise.all` da página (`:163-182`) só quando o apito já passou (pré-jogo não busca). Falha não derruba a página; o teto de 4 s é o pior caso de espera do render (§18).
- `refreshP` (`:144-159`) já não roda depois do apito desde o PR 0 (achado 1).
- Cabeçalho (`MatchHero`, `components/match-hero.tsx:83-121`): `LiveBadge` (`components/live-badge.tsx`) + placar do estado + legenda "63' · atualizado há 20 s" (ou "intervalo", "45+2'", "prorrogação", "jogo interrompido"); expulsões como um retângulo vermelho pequeno com a contagem ao lado do time (tokens `form-loss-*` existentes, nada novo). `toMatchHeroView` ganha a entrada opcional do estado; `liveScore` passa a vir dele quando fresco (≤ 10 min), senão do sync como hoje (`lib/view/match.ts:129-145`).
- Botão "Atualizar placar" (refresh do roteador) ao lado da legenda e `router.refresh()` quando a aba volta ao foco. Sem polling (pergunta 3).
- Mercados: `toBetGridView` (`lib/view/bet-slip.ts:270`) ganha o modo ao vivo (`mode: "register"`, `oddsHeading: "Odds antes do jogo"`, como o PLAN-576 previu): legenda "odd pré-jogo · chance ao vivo · odd justa" (`components/bet-slip/market-table.tsx:56-62`), rodapé "chances pelo modelo ao vivo · 63' · 1–0" (`:110-120`), célula decidida (`isDecided`) com "decidido" e sem botão, odd pré-jogo com `capturedBefore: kickoff` (`page.tsx:294-300`). "fonte: the-odds-api" (`:107`) continua (é provider, não casa). Os botões de reanálise por mercado e "escolher mercados" somem ao vivo (`caps.analyzeMarkets`, §7).
- `HERO`/`PalpiteArea`: deixa de derivar "analisável" de `unavailable === null` (`components/palpites/palpite-hero.tsx:138,191,239`) e passa a receber `caps.analyze`; a manchete ao vivo leva o carimbo "palpite aos 63' (1–0)".
- Seu palpite: a linha de `page.tsx:568` vira o bloco quando `caps.seuPalpite`.
- Suas apostas/§3: `registerBets` controla painel, barra e §3 como hoje (`page.tsx:583-587`); o §3 continua um por tela (ADR 0057).
- `NotAnalyzableNotice` (`page.tsx:612-630`) com os motivos novos.

Listas (`/jogos`, `/time/[team]`): o ramo `live` do `RowTrailing` (`components/match-list/row-trailing.tsx:26-36`, PR #587) mostra minuto e placar de `getInPlayStatesForMatches(ids)` quando a row tem ≤ 10 min; senão, o "parcial · atualizado há X" de hoje. Nenhuma busca ao provider pelas listas.

`/p/[id]` (ADR 0035): palpite ao vivo compartilhado mostra "palpite dado aos 63' (1–0)" (sem isso, um acerto aos 88' pareceria previsão de pré-jogo). Nada de odd.

Copy e ajuda: `/como-usar` (análise e bolão ao vivo), `components/help/glossary.ts` se citar o apito como limite; `lib/tour/steps.ts` não muda de alvos.

## 14. Testes

Unitários (Vitest):
- `lib/quant/__tests__/in-play.test.ts`: tabela de `r` por fase e minuto (incluindo `45+2`, `elapsed = 47` sem `extra`, `90+5`, acréscimo acima do esperado → piso ε); identidade com a matriz pré-jogo em r = 1; coerência da mistura (§6.4); τ inerte com algum lado em 2+; monotonia; HT; r = 0 = massa pontual; condicionamento (células abaixo do placar = 0, Σ = 1); `isDecided` por tipo; `priceLeg` devolve `no_data` para `first_half_*`/`first_to_score` com `inPlay`; `resolveSlipModel(…, { asOf })` com base de 5h antes do apito = a mesma base que a página mostrava; expulsões (d = ±1, 1×1, ±2, 3 de um lado clampado, `red: null`); placar grande (7×6) sem truncar; λ minúsculo aos 89'.
- `lib/live/__tests__/phase.test.ts`: cada código de status (`TBD, NS` depois do apito, `1H, HT, 2H, ET, BT, P, LIVE, INT, SUSP, FT, AET, PEN, AWD, WO, PST, CANC, ABD`, desconhecido), rótulo de minuto, minuto estimado, classes de idade.
- `lib/view/__tests__/match-availability.test.ts` (existente): matriz capacidade × fase × flag; flag OFF = comportamento de hoje.
- `lib/pools/__tests__/pool-state.test.ts`: 14' aberto, 15' fechado, HT fechado, estado velho extrapolado, sem minuto com relógio (14:59 / 15:00), atraso `NS`, dono fechou, admin estendeu (e estendido depois do fim do jogo = fechado), `poolEntriesRemovable` falso em toda fase depois do apito.
- `lib/providers/live/__tests__/api-football.test.ts`: Zod com payloads gravados (com e sem `events`, `extra` null/ausente, segundo amarelo), contagem de vermelhos por time, resolução do fixture id, erro → null.
- `lib/live/__tests__/in-play-state.test.ts` (DB e provider mockados): TTL 60 s, quem perde o lease devolve a row, falha devolve a velha, terminal não busca, janela de 4h, guarda de cota (5%).
- `lib/view/__tests__/bet-slip*.test.ts`: grade ao vivo (cabeçalho, legenda, decidido sem botão, sem `aiPick`); `evaluateSlip` com `suggestStake: false`.
- PR 0: `ensureOddsSnapshotsFresh` com jogo de kickoff no passado (agendado-atrasado, `live`, `finished`) → zero chamada ao provider (mock que lança) e devolve a última captura; com kickoff no futuro, comportamento de hoje (`lib/odds/fetch-and-snapshot.pglite.test.ts` existente continua verde).
- Guardas: nenhum caminho ao vivo chama `getOddsProvider` (provider mock que lança) em `predictInPlay`, `registerBetSlip`, página; nenhum `bookmaker` renderizado (estender `components/__tests__/` existentes); `one-notice.test.ts` e `seu-palpite-guards.test.ts` continuam verdes no estado ao vivo.
- Prompts: versão pinada e snapshot de `narrator_live_v1`, `palpites_live_v1`, `user_palpite_narrate_live_v1`; `palpites_live_v1` rejeita `firstHalfScore`/`firstToScore`/`cardsTemperature` (`.strict()`) e as linhas liquidáveis ao vivo são só `exact_score`/`margin`/`clean_sheet`; os snapshots de pré-jogo existentes provam que `narrator_v1.1`, `palpites_v10` e `user_palpite_narrate_v1` não mudaram.
- Actions (`app/actions/__tests__/`): `bet-slip.test.ts` (carimbo vem do servidor, recusa estado velho, recusa decidido, recusa tipo fora da tabela), `predictions-best-bet.test.ts` (ramo ao vivo cobra 1 unidade, sem notícias, sem contexto extra), `user-palpite.test.ts` (ao vivo), teste novo de `friend-pools` (anotar ao vivo carimba, tirar recusa, fechar/estender, não-admin não estende).

pglite (`*.pglite.test.ts`, padrão de `lib/db/queries/__tests__/`):
- Migration aplicada duas vezes sem erro (IF NOT EXISTS / blocos `DO`).
- `match-live-states.pglite.test.ts`: upsert, leitura em lote e o lease (duas tentativas seguidas: só a primeira ganha; depois de 20 s, a próxima ganha).
- `calibration-live-exclusion.pglite.test.ts`: predição ao vivo liquidada não entra em `getMarketCalibrationRows`.
- `dashboard-live-exclusion.pglite.test.ts`: aposta pré-jogo + leitura ao vivo do mesmo jogo/mercado → KPIs e `loadKellyGate` iguais aos sem a leitura (achado 2).
- `insert-bet-slips-batch.pglite.test.ts` (existente): `is_live/live_state` e o CHECK.
- PSO com `odd` NULL persiste, o histórico devolve `odd: null` e a calibração não quebra com ele.
- `live_state` inválido no banco (jsonb editado à mão) não derruba a página: o leitor faz `safeParse` e trata como "ao vivo, sem carimbo".

## 15. Modelo de dados (uma migration, no PR A1)

Gerada com `pnpm db:generate` (número no commit) e editada para `IF NOT EXISTS` + blocos `DO $$ … EXCEPTION WHEN duplicate_object` (padrão da `db/migrations/0056_friend_pools.sql`; o DB de preview é compartilhado).

1. Tabela `match_live_states`: `match_id uuid PK` (FK `matches`, `cascade`: é cache derivado, não histórico), `provider text not null default 'api_football'`, `provider_fixture_id integer`, `status_short text`, `elapsed smallint`, `extra smallint`, `home_goals smallint`, `away_goals smallint`, `home_red smallint`, `away_red smallint` (null = sem dado), `fetched_at timestamptz` (null antes da 1ª busca bem-sucedida), `claimed_at timestamptz` (lease, §5.2), `updated_at timestamptz not null default now()`. Cortados do rascunho: `home/away_goals_90` (sem consumidor, §5.1), `daily_remaining` (a cota é da conta, §5.3) e `last_error` (o log estruturado basta).
2. `is_live boolean not null default false` + `live_state jsonb` em `predictions`, `bet_slips`, `palpite_sets`, `user_palpite_analyses`, `friend_pool_entries`, com CHECK `is_live = false OR live_state IS NOT NULL` (cada `ADD CONSTRAINT` num bloco `DO … duplicate_object`). `live_state` validado por Zod **na escrita e na leitura** (`lib/live/stamp.ts`, `LiveStampSchema`: `{ v: 1, source: "api_football" | "clock", status, elapsed, extra, minuteLabel, score: {home, away} | null, red: {home, away} | null, fetchedAt, recordedAt, inPlay?: {...§6.4} }`; leitura com `safeParse`, nunca lança). Sem backfill (default false).
3. `prediction_selection_odds.odd` DROP NOT NULL (só leituras ao vivo gravam null).
4. `friend_pools`: `bets_closed_at timestamptz`, `bets_extended_until timestamptz`, `bets_extended_by_user_id uuid` (FK `users`, `set null`).
5. `ai_config.enable_live_mode boolean not null default true` (padrão das outras flags, `db/schema.ts:835-886`) + entrada em `ADMIN_FLAGS` (`lib/config/admin-flags.ts:59`) + `getEnableLiveMode()` (`lib/db/queries/ai-config.ts`, `?? true`). Custo na descrição: "até 1 chamada de API-Football por minuto por jogo aberto; nenhuma da The Odds API". Desligada = tudo como hoje (fecha no apito, sem busca ao vivo); a correção do achado 1 (PR 0) não depende da flag.

Segurança no DB de preview compartilhado: tudo aditivo e idempotente (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, constraints e FKs em blocos `DO`). Nada é removido nem renomeado. `ADD COLUMN … NOT NULL DEFAULT false` não reescreve a tabela no Postgres 11+, e o CHECK novo só varre linhas que já são `false`. `DROP NOT NULL` é a única mudança de restrição e afrouxa: o código de outras branches de preview continua funcionando (não lê `is_live`, e só o PR D grava `odd` null). Gerar com `pnpm db:generate`, editar o SQL para a forma idempotente, nunca editar o snapshot à mão; número conferido no rebase (`docs/plans/PLAN-578.md:191`).

LGPD: nenhum dado pessoal novo (o carimbo é estado do jogo); a exclusão de conta (ADR 0046) já cobre as tabelas tocadas.

## 16. PRs e ordem de commits

Uma issue filha do #580 por PR (`gh issue create`, fluxo do CLAUDE.md). O PR 0 entra já; os demais depois do PR #587 e do PR 6 do #579.

**PR 0 — `fix(odds)`: sem The Odds API depois do apito** (avulso, pequeno, ~50 linhas + teste; não depende do #580 nem dos PRs de design)
1. Guarda de kickoff/status dentro de `ensureOddsSnapshotsFresh` + a página não cria `refreshP` fora do pré-jogo + comentário de `page.tsx:278-283` ajustado (diz "nenhuma chamada nova à Odds API", mas depois do apito o próprio `refreshP` que ele cita é a chamada). Teste de §14. Sem migration, sem flag (é correção).

**PR A1 — dados e regras** (nada novo na tela; deixa as exclusões prontas **antes** de existir o primeiro registro ao vivo)
1. `docs:` ADR nova (número livre no commit) — título sugerido "Modo ao vivo: estado do jogo pela API-Football, modelo em jogo em código, registros marcados". Registra o modelo coerente de §6.4 e as constantes provisórias. Emenda: ADR 0054 §3 (fechamento do bolão aos 15', carimbo, tirar continua bloqueado), ADR 0052 §9 (leitura da base "no apito" depois dele), ADR 0053 §5-6 (sem edge do modelo e sem stake sugerido ao vivo), ADR 0055 (o bloco existe ao vivo). Reafirma 0048, 0038, 0030 (firewall do HERO) e 0057.
2. `feat(db):` migration + `db/schema.ts` + `lib/db/queries/match-live-states.ts` + flag `enable_live_mode` + `lib/live/stamp.ts` (Zod do carimbo).
3. `feat(metrics):` exclusões de §11 + pglite.
4. `refactor:` `matchPhase` + `matchCapabilities` por capacidade + `capabilityBlockedMessage` nos chamadores (com estado null o comportamento é o de hoje, teste de flag OFF).

**PR A2 — estado ao vivo e modelo** (código puro e provider mockado; desenvolve em paralelo ao A1, mergeia depois dele por causa da tabela)
1. `feat(providers):` schemas (`extra`, `events`), `getFixtureLive`, seam `lib/providers/live/`, cliente com throttle próprio, comentário da cota corrigido; fixture de teste a partir de um payload real gravado (pergunta 1).
2. `feat(live):` `lib/live/` (fase, cache com lease, idades, guarda de cota).
3. `feat(quant):` `lib/quant/in-play.ts` (`dixonColesTau` extraído, `inPlayScoreline`, `isDecided`) + `asOf` em `resolveSlipModel`/`resolvePalpiteModelBase` + guarda de `priceLeg`. Commit próprio para a revisão da matemática.

**PR B — página, listas e Suas apostas** (depende do A1 e do A2)
1. `feat(jogo):` estado ao vivo na página, cabeçalho, "Atualizar placar", capacidades ao vivo.
2. `feat(apostas):` tabela de mercados ao vivo (modelo em jogo, odd pré-jogo rotulada, decidido) + `registerBetSlip`/`parseBet` ao vivo + cliente sem pré-preencher.
3. `feat(apostas):` `/apostas` com selo e resumo separado (no mesmo PR do commit 2: o primeiro slip ao vivo não pode cair no resumo de pré-jogo).
4. `feat(jogos):` minuto/placar nas listas a partir das rows.
5. `docs:` `/como-usar`, `DESIGN.md` (estado ao vivo do cabeçalho), glossário.

**PR C — bolão** (depende do A1 e do A2; em paralelo ao B, toca arquivos disjuntos: `lib/pools/`, `app/actions/friend-pools.ts`, `app/(app)/bolao/`, `lib/view/friend-pool.ts`)
1. `feat(bolao):` `poolWindowOpen`/`poolBetsOpen`/`poolEntriesRemovable` + actions de anotar/tirar/criar/placar.
2. `feat(bolao):` fechar (dono) e estender (admin) + telas e selos.
3. `feat(bolao):` carimbo nas apostas (lista e ganhador) + seletor com jogos na janela.

**PR D — análise, palpite e Seu palpite** (depende do B: usa as capacidades e o estado já ligados na página)
1. `feat(jogo):` "Leituras ao vivo" separadas no detalhe da análise + filtro `isLive` em `summarizeSavedAnalysesForSynthesis` (achado 9: **antes** do primeiro write ao vivo de predição).
2. `prompt:` `narrator_live_v1`.
3. `feat(ia):` `predictInPlay` em `lib/ai/predict.ts` + ramo ao vivo de `analyzeBestBet`.
4. `prompt:` `palpites_live_v1` + `generatePalpiteFromAnalyses` ao vivo + `/p/[id]` com o carimbo.
5. `prompt:` `user_palpite_narrate_live_v1` + Seu palpite ao vivo (leitura pelos botões e action).

Tamanho esperado (com testes): PR 0 pequeno; A1 e A2 médios (~1.000-1.500 linhas cada, metade teste); B o maior em superfície de UI; C médio; D médio-grande. Caminho crítico: PR 0 (já) → A1 → A2 → B → D, com C em paralelo a B.

Cada PR: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` e checks verdes antes do merge; mencionar no PR quantas análises reais foram rodadas para teste (CLAUDE.md, custo de tokens).

## 17. Perguntas abertas (o código não responde; default recomendado)

1. **Limite por minuto do Pro e formato do payload** (`/fixtures?id=` traz `events` e `status.extra`? qual `detail` do segundo amarelo?). Default: assumir que sim, schema opcional, `red: null` quando faltar; validar com a chave antes do merge do PR A2 (um `curl` gravado num jogo ao vivo vira fixture de teste; o header `X-RateLimit-Limit` da mesma resposta responde o limite por minuto). Throttle do cliente ao vivo 30/min.
2. **Constantes e forma do modelo** (S1 = 3, S2 = 6, RED_OWN = 0,70, RED_OPP = 1,25, κ = 0,45, e o τ do DC no placar final, §6.4). Default: estas, rotuladas provisórias na ADR; backtest com eventos históricos da API-Football (gols e cartões com minuto, já no schema de `/fixtures/events`) fica para issue de follow-up, que também decide se o τ cheio no 2º tempo calibra melhor que o Poisson puro.
3. **Atualização automática do placar.** Default: sem polling; "Atualizar placar" + refresh ao voltar o foco (custo previsível; cada refresh já respeita o cache de 1 min).
4. **Contexto extra ao vivo.** Default: fora nesta versão (§8.2).
5. ~~**Bolão: estender o prazo de bolões de outros usuários.**~~ Respondida pelo código (§10): só o dono abre o bolão e não há tela de admin de bolões; o admin estende os próprios.
6. **Placar final provisório no bolão** (usar o `FT` do estado ao vivo antes do sync de 6h). Default: fora deste plano (follow-up); o placar manual resolve hoje.

## 18. Riscos

- **Modelo sem calibração.** Mitigado: nenhuma aposta recomendada ao vivo, sem stake sugerido, rótulo "modelo ao vivo", cada registro grava o estado (vira dado de calibração).
- **Atraso do provider** (gol que ainda não apareceu): alguém anota no bolão logo depois de um gol com o placar anterior no carimbo. O carimbo deixa visível; o corte de 15' e a idade máxima de 2 min limitam a janela. Para Suas apostas é registro pessoal, sem dinheiro.
- **Cota da API-Football** em dia cheio: guarda de 5% por `getLastQuota` (§5.3), por instância; uma instância fria só descobre a cota baixa na primeira resposta.
- **Throttle compartilhado** atrasando a busca: cliente próprio + teto de 4 s + row velha com a idade.
- **Achados 2, 3 e 9** (dedup, "tirar aposta" e a seção da análise): cobertos por teste pglite e unitário no PR A1/C/D, e a ordem dos commits garante que a exclusão existe antes do primeiro registro ao vivo.
- **Validador de fidelidade da síntese** (#380) pode reprovar uma manchete que cita o placar atual como contagem de gols: passar o placar como fato permitido e cobrir com teste no PR D.
- **Neon cold start e espera do render**: uma leitura a mais no render do jogo ao vivo, e com a row velha a busca ao provider (teto 4 s) segura o `Promise.all` da página. Se incomodar, o cabeçalho vai para um `Suspense` próprio; não é bloqueante para o v1.
- **Modelo coerente × intuição em 0-0**: o τ no placar final deixa o "0-0 no fim" alguns pontos acima do Poisson puro no 2º tempo (§6.4). É o que o pré-jogo implica, mas ninguém mediu ao vivo; o rótulo "modelo ao vivo" e o follow-up da pergunta 2 cobrem.
- **Leitores do λ**: algum leitor novo que recalcule de `lambdaHome/lambdaAway` em vez da matriz sai errado ao vivo (§6.5). A guarda em `priceLeg` e o tipo `InPlayScoreline` (com `inPlay` obrigatório) ajudam; revisar qualquer `firstHalfScorelineMatrix`/`firstToScoreProbs` novo.
- **Conflitos de rebase** com o PR #587 (`RowTrailing`) e o PR 6 do #579 (`/como-usar`, `DESIGN.md`); número da migration e da ADR conferidos no rebase (regerar a migration, nunca editar snapshot à mão, `docs/plans/PLAN-578.md:191`).
- **Prorrogação e pênaltis**: mercados de 90' fecham em `ET`/`P` (na Libertadores e na Sul-Americana, `2H → P` direto); bolão estendido até a prorrogação usa o placar com prorrogação (ADR 0054 §5, aviso na tela já existe).
- **The Odds API antes do PR 0**: cada dia sem a correção pode custar créditos em visitas a jogos começados ou encerrados (§3, achado 1); por isso o PR 0 não espera o resto.

## 19. Critério de saída

0. PR 0 em produção: visita a um jogo encerrado e a um ao vivo não move o saldo da The Odds API em `/admin` (`provider_quota`) nem gera log `getOddsForSport`.
1. Num jogo real em andamento, com `enable_live_mode` ligado: a página mostra minuto, placar e expulsões com no máximo 1 min de defasagem por recarga; os logs mostram ≤ 1 chamada de API-Football por minuto por jogo e **zero** chamada à The Odds API em página e actions depois do apito.
2. A tabela de mercados mostra "Odds antes do jogo" com a última captura pré-apito, a chance do modelo ao vivo, mercados decididos sem botão, e nenhum nome de casa.
3. Registrar aposta, analisar com IA, gerar só o palpite e analisar o Seu palpite funcionam ao vivo; cada row nova tem `is_live = true` e `live_state` com minuto e placar lidos no servidor; as predições ao vivo são `pass` com `narrator_live_v1` e `model_version` com `engine=code_jev;…;live=live_model_v1`; no minuto 0 (atraso `NS` ou `1H` com `elapsed` 0) a tabela ao vivo mostra os mesmos percentuais que a página mostrava antes do apito.
4. Bolão: anotar aos 10' grava "aos 10' · 0–0"; aos 15' fecha sozinho; sem minuto fecha às 15 min de relógio; o dono fecha antes; o admin estende; tirar aposta depois do apito é recusado.
5. `/dashboard`, `/admin/calibration`, o gate do Kelly e o CLV dão os mesmos números com e sem registros ao vivo (pglite e conferência manual); `/apostas` separa ao vivo.
6. Com a flag desligada, tudo fecha no apito como em `ef25c2b` (menos a correção do PR 0).
7. Lint, typecheck, testes (unitários e pglite) e build verdes em cada PR; issues filhas fechadas conforme cada PR mergeia; #580 fechada no último.

## Revisão do plano

Revisão de 2026-10-15, com contexto novo, conferida no código em `953cea3` (`main` `ef25c2b` + os commits do PR #587, que só mexem na lista `/jogos`, nas linhas de `lib/view/match.ts`, no `/como-usar` e em `getRecentPredictedMatchesByUser`) e com uma conta numérica do modelo em jogo (script descartável, fora do repo). As decisões do dono (§1) não foram reabertas. As correções já estão no corpo; aqui o registro.

**Erros corrigidos**
- **R1. Vazamento da The Odds API: confirmado, mas o custo é 2 créditos por visita, não 1, e vale também para jogo encerrado.** `PAGE_LIVE_MARKETS` tem dois mercados `featured` (`totals` e `h2h`), e o laço de `ensureOddsSnapshotsFresh` faz uma busca de liga por mercado stale (1 mercado × 1 região = 1 crédito cada). Não há guarda de kickoff em lugar nenhum, e `getMatchesInLeagueWindow` só devolve `kickoff >= now`, então o jogo começado nunca volta a ficar fresco: toda visita fria, ao vivo ou dias depois do fim, paga 2. O freio é o cache em memória por instância (5 min durante o jogo, 15 min fora). Conta no §3. Virou **PR 0 avulso**, antes do #580 e independente dos PRs de design, com a guarda dentro de `ensureOddsSnapshotsFresh` (ponto único para página, actions e crons) em vez de uma capacidade `prewarmOdds` da página. Também ficou registrado que não se deve alargar a janela de `knownMatches`: o payload traz odd ao vivo.
- **R2. Matemática do condicionamento.** O rascunho aplicava o τ do Dixon-Coles aos gols **que faltam** (`scorelineMatrix(μH, μA, { rho: ρ·r })` deslocada). O τ do DC é uma correção do placar **final** (`scorelineMatrix` multiplica as células finais 0-0/1-0/0-1/1-1). A condicional exata, lendo o DC como Poisson por time com o τ repondera o final, é `Pois(h−h0; μH)·Pois(a−a0; μA)·τ(h, a; λ, ρ do pré-jogo)` renormalizada: bate com `pre.matrix` no minuto 0, vira massa pontual no fim, dispensa o ajuste `ρ·r` e é coerente (a média sobre o placar no minuto t devolve o pré-jogo; conferido numericamente, erro ~4e-8). A diferença não é cosmética: aos ~60' em 0-0 (λ 1,4 × 1,1), P(termina 0-0) = 46,8% contra 42,0% no rascunho. O τ passa a sair de um helper `dixonColesTau` compartilhado (paridade por construção). Teste de coerência entrou no §6.4/§14.
- **R3. "Todo leitor funciona sem mudança" era falso.** `priceLeg` recalcula `first_half_*` e `first_to_score` de `lambdaHome/lambdaAway` (`lib/bets/grade-scoreline.ts:66-69,108-110`); com o λ do rascunho (`h0 + λ_rem`) os dois sairiam errados. Esses tipos ficam fora do ao vivo, com guarda no próprio leitor (§6.5).
- **R4. Seleção decidida por predicado, não por `P ∈ {0, 1}`.** Soma em ponto flutuante não dá 1 exato; `isDecided(kind, params, score)` puro, usado pela tabela e pelas actions.
- **R5. `engine=in_play` viraria "motor desconhecido"** (`engineFromModelVersion` só aceita os motores conhecidos, `lib/format.ts:433-434`). A leitura ao vivo é o contrato do `code_jev`: `engine=code_jev;…;live=live_model_v1`, e o `is_live` separa nas queries (achado 7).
- **R6. A síntese do palpite ao vivo geraria linhas já decididas.** `palpites_v10` tem `firstHalfScore`, `firstToScore` e `cardsTemperature`, que viram linhas em `buildSettleablePalpiteRows`. `palpites_live_v1` não tem os três, e o placar provável abaixo do atual é corrigido em código (achado 8, §8.2, §12).
- **R7. "Ler análise completa" mostra a mais nova por mercado** (`toMarketAnalysisSections`): a primeira leitura ao vivo apagaria a análise pré-jogo da página. A separação virou o **primeiro** commit do PR D, antes de qualquer write ao vivo de predição (achado 9).
- **R8. A calibração só pularia a leitura ao vivo por acaso.** Ela inclui `pass` de propósito; com `odd` null, `Number(null) = 0` cai no `catch` de odd ≤ 1. O filtro `is_live = false` no `settledFilter` é obrigatório, e `calibration.ts` trata `odd === null` explicitamente. Os únicos leitores de `prediction_selection_odds.odd` são a calibração e o histórico.
- **R9. Persistência do best bet não é "a mesma transação".** É `ai_calls` primeiro, depois cada predição com o `aiCallId`, e o PSO best-effort. `predictInPlay` reusa `narratePendingPrediction`/`persistPendingPrediction` em vez de um caminho novo.
- **R10. Paridade do minuto 0 sem arquivo novo.** `resolvePreMatchModel` (`lib/model-base/pre-match-scoreline.ts`) saiu: `resolveSlipModel(match, { asOf: kickoffAt })` repassa `now = kickoff − 1 ms` a `getMatchModelScoreline`, que já aceita `now`, e devolve exatamente o modelo que a página mostrava no apito. Idem `resolvePalpiteModelBase` via `isSnapshotUsable`.
- **R11. Referências que mudaram ou estavam erradas:** `getRecentPredictionsByUser` → `getRecentPredictedMatchesByUser` (`predictions.ts:368`, PR #587); `lib/view/match.ts:96-103,129-145`; `como-usar-content.tsx:222`; `market-table.tsx:107`; `FixtureEventItemSchema` (não `FixtureEventSchema`); a ADR 0058 já é do PR #587; a pergunta 5 do bolão era citada como "pergunta 6". O cabeçalho agora diz em que commit tudo foi conferido.
- **R12. Cache duplo no provider.** Com 60 s no cache em memória **e** 60 s na row, uma instância podia gravar como fresco um payload de 59 s (placar de ~2 min com idade zero). Cache em memória do ao vivo ≤ 15 s; `fetched_at` = instante da resposta.

**Cortes de escopo (simplificações)**
- **Sem lock no KV.** O KV existe (`lib/sync/lock.ts`, Upstash), mas o lease vira um `UPDATE … RETURNING` na própria row (atômico, sem ida de rede extra, sem estado fora do DB). Duplicata é barata na cota do Pro; sem lease é fallback aceitável, KV não.
- **Colunas cortadas de `match_live_states`:** `home/away_goals_90` (sem consumidor: em `ET/BT/P` não há leitura), `daily_remaining` (a cota é da conta; `getLastQuota` em memória já tem a leitura) e `last_error` (log estruturado). Guarda de cota simplificada para um limiar (5%).
- **Narrador ao vivo sem o contexto de pré-jogo** (forma, H2H, tabela, desfalques, escalações): seriam 6 chamadas na fila de 8/min do cliente compartilhado para fatores que já estão no λ.
- `capturedBefore` na leitura de referência ficou como defesa barata; a garantia real passou para o escritor (PR 0).
- PR A dividido em A1 (dados, exclusões, capacidades, ADR) e A2 (provider, estado, modelo), desenvolvidos em paralelo; C em paralelo a B (arquivos disjuntos). Caminho crítico: PR 0 → A1 → A2 → B → D.

**Resolvido pelo código**
- Admin estende bolão de outro usuário? Não há como sem tela nova: só o dono abre o bolão (`getFriendPool(poolId, userId)`) e só ele anota (ADR 0054 §2). O admin estende os próprios; os outros donos só fecham antes.
- Settlement: `settle.ts`, `settle-user-bets.ts` e `settle-palpites.ts` usam só `regulationScore` (`score.fulltime`) de jogo `finished`, com escrita idempotente (`insert…IfAbsent`, override manual); registros ao vivo liquidam igual e nada do ao vivo escreve em `matches`. Sem mudança.
- Todos os `from(predictions)` do repo foram varridos (§11): calibração e dashboard (filtro na query, antes do dedup, o que também cobre o gate do Kelly, o *pass rate* e `derive-view`), CLV (já pula `pass`, e o fechamento é limitado a `captured_at <= kickoff`), e os que não precisam de filtro (fechamento perto do KO só não-`pass`, reuso de JEV exige `judgments` aplicado, "tem análise", histórico).

**Conferido e mantido**
- "Toda leitura ao vivo é `pass`" é coerente com o produto: sem odd não há edge (ADR 0038), o motor emite uma recomendação ou `pass`, e o guarda de fidelidade do narrador já reprova "recomendar aposta num pass". O valor ao vivo fica no EV sobre a odd que o usuário digita (Suas apostas), sem stake sugerido. Reanálise por mercado e "escolher mercados" (placar exato, artilheiro, assistência via cartucho LLM) ficam só pré-jogo: a decisão 1 nomeia só "Analisar com IA" e "Gerar só o palpite".
- Fração restante por minuto: com o minuto `m` (renomeado de `τ`, que conflitava com o τ do DC), o 1º tempo começa em r = 1, o intervalo vale κ₂, acréscimo maior que o esperado bate no piso ε, e `2H` com `elapsed` 45 no reinício dá `m = 0`. Expulsão multiplica só o λ restante, sem precisar do minuto do cartão.
- Mata-mata: as ligas com mata-mata são Champions, Libertadores, Sul-Americana e Copa (não há Copa do Brasil em `SUPPORTED_LEAGUES`); em `ET/BT/P` não há leitura nem registro, porque mercados e settlement são de 90'.
- Bolão: separar "anotar" (`poolBetsOpen`) de "tirar" (`poolEntriesRemovable`, só pré-jogo) e de "criar" (`poolWindowOpen`) está certo; os quatro usos de hoje (`friend-pools.ts:76,106,127,151`) e os dois da tela foram mapeados. Carimbo com minuto e placar, visível na lista e na linha do ganhador, sem edição e sem tirar, é suficiente para o caso (o dono digita tudo na frente do grupo); mudar pontuação por minuto contrariaria a decisão 5.
- Migration: só aditiva e idempotente, sem rewrite (`ADD COLUMN … DEFAULT` em PG 11+), `DROP NOT NULL` só afrouxa; seguro no DB de preview compartilhado. Zod no `live_state` na escrita e na leitura (`safeParse`).
- Cota: com o Pro (7.500/dia), o teto de uma rodada inteira acompanhada minuto a minuto é ~1/3 da cota; o caso real (página aberta de vez em quando) é bem menor.

**Riscos que ficam**
- O payload real de `/fixtures?id=` (presença de `events` e `status.extra`, texto do `detail` do segundo amarelo) e o limite por minuto do Pro só se confirmam com a chave, num jogo ao vivo (pergunta 1). Até lá o schema é tolerante e a expulsão degrada para "sem dados".
- O modelo em jogo não tem backtest. A forma coerente (τ no placar final) e as constantes podem calibrar pior que o Poisson puro em 0-0 tardio; o follow-up da pergunta 2 decide com os dados que a feature passa a gravar.
- Atraso do provider no bolão: o carimbo pode não ter o gol do último minuto; fica visível, não bloqueado.
- Até o PR 0 mergear, cada visita fria a jogo começado ou encerrado segue custando 2 créditos.
- A espera de até 4 s pela busca ao vivo no render da página, quando a row está velha; mitigável com `Suspense` no cabeçalho se incomodar.
