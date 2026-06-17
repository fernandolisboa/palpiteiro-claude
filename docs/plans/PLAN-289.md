# PLAN — #289 Adapter de odds da api-football: correct score (ADR 0025)

> Plano de implementação (histórico — ver README de `docs/plans/`).
> explore → plano → plan-review (painel) antes de codar. **Sem migration** (isso é #290).

## Escopo confirmado pelo dono

**CORRECT-SCORE-ONLY.** A análise G3 inverteu a premissa do ADR: correct score é o mercado
LIMPO (grid fixo, book único, partição), e **artilheiro/assistência** (bet=92/93/212) é o
difícil (jogadores ilimitados por jogo, fio só dá o lado "yes" sem odd "no", precisa de âncora
de elenco que só existe pós-`/fixtures/events` da #290). → **scorer/assist vai inteiro pra #290**
([[issue-288-design-a-defers-to-289]] documenta a cauda). Decisão registrada via AskUserQuestion.

## Roteamento (a perna diferida do #288, AC #4 "sem if provider")

Composite `OddsFallbackProvider implements OddsProvider`, registrado em `index.ts`:
`getOddsProvider() = new OddsFallbackProvider(new ApiFootballOddsAdapter(), new TheOddsApiAdapter())`.
Despacho **por capability**, não cascade nem merge: novo método de interface
`supportsMarket({ sportKey, providerMarketKey }): boolean`. Ambos os call sites passam UM
`markets: [key]` → `pick()` resolve o ÚNICO adapter que cobre aquele key:

- `markets` undefined → fallback (The Odds API; preserva o default `['totals']` do fio).
- todos cobertos pelo primary (api-football) → primary; pelo fallback → fallback (passthrough).
- cruzando providers (nunca acontece hoje) → **throw** (não inventa merge).
- `getEventsForSport` → SEMPRE fallback (lista grátis; correct score é featured/batch).

`TheOddsApiAdapter.supportsMarket`: true p/ sportKeys mapeados + qualquer key que NÃO comece com
`bet_` (cede o namespace api-football). `ApiFootballOddsAdapter.supportsMarket`: true só p/
`bet_10` + sportKey do Brasileirão. **The Odds API path byte-idêntico** (passthrough por referência).

## G3 — bounding + overround (decisão do agente, documentada)

**Grid 16 células (home,away ∈ 0..3): `cs_0_0`..`cs_3_3`. SEM bucket OTHER sintético.**
`resolveSelectionKey`: parse `"H:A"`/`"H-A"` → `cs_H_A` se ambos ≤ 3; senão (fora do grid, AOS,
lixo) → `null` (dropado, defensivo, espelha DOUBLE_CHANCE). Overround = `computeMarketImplied­Probabilities(16 odds)`, partição (`impliedSumTarget` undefined = 1), normalizada SOBRE as 16 —
edge **bounded-grid-relative** (model + implied normalizam sobre o MESMO conjunto no cartucho do
#290 → edge condicional coerente). Book único (Bet365, única casa que cota bet=10 pro BR).

**Por que SEM OTHER (override do punch-list 3×3+OTHER):** select-bookmaker usa "primeira
ocorrência vence" (`!byKey.has(key)`), então mapear N placares fora-do-grid → `cs_other` colidiria
(pega um placar arbitrário, não o agregado). E um `cs_other` honesto exigiria ou a odd "Any Other
Score" do fio (NÃO verificada — liga pausada) ou sintetizar a odd (PROIBIDO, CLAUDE.md). 16-sem-OTHER
é bug-free, não depende de AOS, e degrada gracioso (célula faltando → mercado incompleto → `null` →
prefer-skip). Provisório: confirmar o shape real do `bet=10` no 1º payload ao vivo (risco residual).

## Descriptor

`CORRECT_SCORE` **exportado, FORA de `ALL_DESCRIPTORS`** (entra na #290 quando a migration seeda
`markets`/`market_selections` — espelha `OVER_UNDER_ALT`; senão `getDescriptor("correct_score")`
resolveria sem row no DB). `dbMarketKey: "correct_score"`, `providerMarketKey: "bet_10"`,
`oddsSource: "featured"`, `coveredLeagues: ["brasileirao_a"]`, `impliedSumTarget` undefined (partição).

## Adapter + client (espelha lib/providers/sports-data/api-football/)

Nova dir `lib/providers/odds/api-football/`: `constants.ts` (base URL v3.football.api-sports.io,
`BET_ID_CORRECT_SCORE=10`, `CORRECT_SCORE_PROVIDER_KEY="bet_10"`), `errors.ts` (`OddsFootball*Error`,
byte-copy do shape), `schemas.ts` (REUSA `envelope`/`envelopeErrorsAreEmpty` do sports-data;
`/odds` envelope: `response[].{fixture{id,date},league{id,season},update?,bookmakers[].{id,name,
bets[].{id,name,values[].{value, odd:STRING, update?}}}}`), `client.ts` (createProviderClient
`name:"api-football-odds"`, MESMA `API_FOOTBALL_KEY`, `getCorrectScoreOdds(leagueId,season)`),
`adapter.ts` (`ApiFootballOddsAdapter`):
- `normalize`: `market.key="bet_10"`, `bookmaker.key="apifootball_{id}"`/`title=name`,
  `price=Number.parseFloat(odd)` (fio é STRING), `lastUpdate=bet.update ?? item.update ?? now`,
  sem `point`. **Enriquece homeTeam/awayTeam via `getFixtureById(fixture.id)`** (existe no client
  sports-data af, cached) + `canonicalizeOrPassthrough` — senão `findEventInList` nunca casaria.
- `getOddsForSport`: sportKey→liga 71→season→`getCorrectScoreOdds`→`map(normalize)`.
- `getOddsForEvent`/`getEventsForSport`: **throw unsupported** (correct score é batch/featured).
- `supportsMarket`: só `bet_10` + Brasileirão.
- Erros do fio **propagam** (consistente com #288; sem cascade — isso seria do FallbackProvider,
  mas aqui o composite é ROUTER, não cascade).

## #289 / #290 cut (linha dura)

#289: adapter + client + roteamento + descriptor `CORRECT_SCORE` (FORA de ALL_DESCRIPTORS) + testes
**só com fixtures (sem DB, sem HTTP real)**. #290: migration (seed markets/market_selections) +
cartucho + settlement + flag + adiciona CORRECT_SCORE a ALL_DESCRIPTORS + **toda a perna scorer**.
AC #4 satisfeita no nível de seam/roteamento (testado via composite); persistência end-to-end
(`resolveMarketCatalog`) acende na #290.

## Testes (fixtures only) + verificação

- `api-football/__tests__/schemas.test.ts` — parse de envelope `/odds bet=10` (odd string, "2:1").
- `api-football/__tests__/adapter.test.ts` — normalize (price number, key "bet_10", teams enriquecidos),
  `supportsMarket`, `getOddsForEvent/getEventsForSport` throw.
- `odds/__tests__/fallback-provider.test.ts` — roteamento (`['totals']`→TheOddsApi,
  `['bet_10']`+BR→af, `['bet_10']`+não-BR→throw, undefined→TheOddsApi, getEventsForSport→TheOddsApi).
- `market-descriptor.test.ts` — casos CORRECT_SCORE (`"2:1"`→`cs_2_1`, `"4:0"`→null, `"1-0"`→`cs_1_0`,
  lixo→null) + `getDescriptor("correct_score")` undefined (fora de ALL_DESCRIPTORS).
- **Rede byte-idêntica do #288 (rodar, NÃO editar asserções):** persisted-parity, scenario,
  select-bookmaker, market-descriptor, fetch-and-snapshot.pglite, predict*, odds-card-parity.golden,
  the-odds-api/adapter.test.

```bash
pnpm typecheck && pnpm lint && pnpm test --no-file-parallelism
```

## Riscos residuais

1. **`bet=10` wire shape NÃO verificado** (liga pausada; ADR só confirmou "30 cotações/Bet365").
   `resolveSelectionKey` defensivo + `update?` opcional toleram drift; confirmar formato do `value`
   + `update` no 1º payload ao vivo (graduação por D9, não gate). Prefer-skip se o grid não bater.
2. **Team-name enrichment** via `getFixtureById` (cross-module odds→sports-data wire, cached, mesmo
   vendor/key) — sem isso o featured matching nunca casa. É a integração mais sensível do #289.
3. **Overround book único** sobre 16 vias é estruturalmente largo; aceito (única casa que cota BR
   correct score; valida via D9 viva). Bounded-grid documentado.
