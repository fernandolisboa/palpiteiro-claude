# PLAN — #288 Seam `OddsProvider` + DTO `NormalizedOdds` (ADR 0025)

> Plano de implementação (histórico, snapshot — ver README de `docs/plans/`).
> Produzido por explore → plano → plan-review (painel adversarial) antes de codar.
> Refactor **puro, byte-idêntico**. Sem migration. Sem mudança de produto.

## Decisão de escopo do dono (gravada)

**Design A — decoupling só do seam (escolhido pelo dono).** AC #3 ("MarketDescriptor
… *sem `providerMarketKey`/`OddsApiOutcome` acoplados*") colide com AC #4 (byte-idêntico,
sem editar asserções): remover `providerMarketKey` do descriptor quebraria **5 asserções
protegidas** (incl. a `market-descriptor.test.ts:62`, do set protegido nomeado) e exigiria
uma lookup table `(dbMarketKey, oddsSource) → providerMarketKey` no adapter que só o 2º
provider do #289 exercita (`OVER_UNDER` e `OVER_UNDER_ALT` compartilham
`dbMarketKey: "over_under"`, diferindo só no `providerMarketKey` `"totals"` vs
`"alternate_totals"`).

→ **Design A**: remove só o acoplamento ao **tipo de fio** (`resolveSelectionKey` passa a
receber `NormalizedOddsOutcome`; o seam é desenhado no **payload do evento**
`NormalizedOddsEvent`). `providerMarketKey` **fica** como string de roteamento neutra do
descriptor. AC #3 atendido pro acoplamento `OddsApiOutcome`; a remoção do campo
`providerMarketKey` é **diferida pro #289** (onde a lookup table é naturalmente exercitada).
**Zero** edição de asserção protegida. AC 1,2,4,5,6 plenos.

## Decisão de erro (gravada — leve desvio do painel, justificado)

O adapter **propaga `OddsApiError` (e subtipos) sem alterar** em #288 (byte-idêntico de
verdade: erros de odds são observados só via `err.message` nos catches da action/fetch; os
reads de `err.name` são escopados ao Anthropic em `serializeAnthropicError`; `grep instanceof
OddsApi*` em consumidores = vazio). A **hierarquia de erro + cascade + `OddsFallbackProvider`
são do #289** (ADR 0025: "o cascade/capability-gate é replicado num `OddsFallbackProvider`
novo"). #288 fecha a assimetria da **abstração** (interface + DTO + capabilities); #289 fecha
a do **cascade**.

## Arquivos novos (`lib/providers/odds/`)

- `types.ts` — DTOs `NormalizedOdds{Outcome,Market,Bookmaker,Event,EventListItem}` + Zod,
  `OddsProviderCapabilities`, option bags, interface `OddsProvider`. **Sem** hierarquia de erro.
- `the-odds-api/adapter.ts` — `TheOddsApiAdapter implements OddsProvider`. **Único** importador
  dos tipos de fio (`OddsApiEventOdds`/`OddsApiOutcome`/`OddsApiEventListItem`) + do cliente
  `odds-api.ts`. Normaliza por **rename de campo apenas** (snake→camel, zero transform de valor).
- `index.ts` — `getOddsProvider()` (singleton) + `__setOddsProviderForTesting()` + re-export
  dos tipos do DTO/interface. (Sem fallback — 1 provider; #289 adiciona.)
- `the-odds-api/__tests__/adapter.test.ts` — fidelidade do mapeamento (snake→camel, sem
  transform), ambas variantes de lista.

## Arquivos editados (consumidores + descriptor)

- `market-descriptor.ts` — `resolveSelectionKey(outcome: NormalizedOddsOutcome, …)` (era
  `OddsApiOutcome`); corpos das 5 resolves **inalterados**; `providerMarketKey` **fica**.
- `select-bookmaker.ts` — `event: NormalizedOddsEvent`; `market.last_update`→`lastUpdate`;
  `event.home_team`/`away_team`→`homeTeam`/`awayTeam` (no wrapper binário). Lógica intocada.
- `match-event.ts` — `EventLike` snake→camel; ambos callers do `findEventInList` viram DTO **juntos**.
- `fetch-and-snapshot.ts` — client via `getOddsProvider().*`; tipo `NormalizedOddsEvent`;
  `descriptor.providerMarketKey` **inalterado** (request markets[]).
- `predict.ts` — `getOddsForSport` via `getOddsProvider()`; `findMatchingEvent` em DTO;
  campos camelCase; `impliedSumTarget`/`deriveImplied` **intocados** (ADR 0018 dual-site).

## Errata (AC #5)

- `.env.example:42` — api-football: free 100/dia → **Pro 7500/dia** (`GET /status`).
- `docs/decisions/0005-…` — bloco **Errata** (não reescrever): plano Pro 7500/dia.
- `lib/providers/odds-api-constants.ts:52-53` — **revisar** (não corrigir cego) o comentário
  região `eu`/casas BR à luz da **#158** (featured h2h/totals na `eu`; additional só casas
  EU/US validadas na Copa; re-validar Brasileirão na reabertura).

## Testes (Design A — asserções INALTERADAS)

Migrar **fixtures** snake→camel onde construírem o evento do fio; **re-apontar mocks** pro
`__setOddsProviderForTesting(fakeProvider)` (pglite + os 4 `predict*.test.ts`). Nenhuma
asserção muda. `market-descriptor.test.ts:62` (`providerMarketKey`) e os 4 `predictions*`
**passam sem edição** (campo fica). `scripts/test-odds-api.ts` e os schema/math tests:
**sem edição** (o fio segue exportado; privacidade é por grafo de import).

## Sequência (typecheck-sane) + verificação

types → adapter(+test) → index → descriptor → select-bookmaker(+test) → match-event(+both
callers+test) → fetch-and-snapshot(+pglite retarget) → predict(+4 retargets) → errata → verificar.

```bash
pnpm typecheck && pnpm lint && pnpm test --no-file-parallelism
```
Gate de byte-identidade (zero edição de `expect()`): `persisted-parity`, `market-descriptor`,
`select-bookmaker`, `match-event`, `predictions{,-best-bet,-multi-market}`, `odds-card-parity.golden`.
