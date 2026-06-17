# PLAN-227 — Provider de desfalques fallback (oficial-primeiro) no seam da cascata

> Implementação da issue **#227** (`feature, infra, pos-pivot`), gated pelo **ADR 0026** (#225)
> + a fatia de proveniência (#226, MERGED). Pivot arriscado → **plano-portão de 2 rodadas**.
> Snapshot 2026-06-17, aterrado no código real.

## 0. Decisão de design (resolve o fork A vs B): **Option C — seam novo, reuso máximo, zero-behavior-change**

A discovery mapeou A (mover injuries pra FORA de `SportsDataProvider`, ~20-30 arquivos) vs
B (coexistir, ~10-15). **Escolho a Option C** (variante enxuta de B, fiel ao ADR 0026 D2/D4):

- **Módulo novo `lib/providers/absences/`** com a interface **estreita** `AbsencesProvider`
  (`getAbsencesByFixture`/`getAbsencesByTeam`) + sua própria `AbsencesCapabilities`
  (`{ name, supportsAbsences, supportedLeagues }`). Reusa `NormalizedInjury` e as classes de
  erro (`SportsDataTransientError`/`NotFoundError`/`UnsupportedError`) de `sports-data/types.ts`.
- **Adapter primário = wrapper do `SportsDataProvider` existente**
  (`sportsDataAbsencesAdapter`): delega `getAbsencesByFixture` → `sportsData.getInjuriesByFixture`
  (a cascata api-football→football-data já existente, que já marca `source:"official"` no #226);
  `supportsAbsences` derivado de `capabilities.supportsInjuries`. **Zero duplicação** da lógica
  de injuries.
- **Adapter fallback = SportMonks** (`sportmonks/adapter.ts`): novo, via `createProviderClient`
  (`http/client.ts:95`), **key-gated** (`SPORTMONKS_API_TOKEN`). Marca `source:"official"`
  (SportMonks é estruturado/licenciado, MESMA classe da API-Football — NÃO "unofficial").
- **`AbsencesFallbackProvider(primary, fallback)`**: espelha o contrato de erro do
  `FallbackProvider` (`fallback-provider.ts:21-56`) — Transient→cascata, NotFound→bubble,
  Unsupported→gate — sobre a interface `AbsencesProvider`. **Compor/aninhar, não generalizar** (D4).
- **`getAbsencesProvider()`** factory + `__setAbsencesProviderForTesting` seam + env vars
  (`ABSENCES_PRIMARY` default `sports-data`, `ABSENCES_FALLBACK` default `sportmonks`).
- **`predict.ts` step 3**: troca `provider.getInjuriesByFixture(ref)` por
  `getAbsencesProvider().getAbsencesByFixture(ref)` (mantém o MESMO catch() gate
  Unsupported|Transient→`unavailable` e o per-side do #226). As outras fetches (form/h2h/
  standings/lineups) **continuam** no `SportsDataProvider`.

**`SportsDataProvider`, `FallbackProvider` e os adapters existentes ficam INTOCADOS**
(`scripts/backtest-cartridge.ts` segue usando `getInjuriesByFixture`).

### Por que Option C
- **Fiel ao ADR D2** (interface estreita `AbsencesProvider` com orquestração própria no step 3)
  + **D4** (compor/aninhar) + **D1** (api-football primary, SportMonks fallback).
- **Blast radius mínimo** (~8-12 arquivos, quase tudo NOVO) vs o teardown de A.
- **Zero-behavior-change HOJE**: sem `SPORTMONKS_API_TOKEN`, o adapter SportMonks lança
  `SportsDataUnsupportedError` → o cascade o gateia → sobra só o primário (= caminho de hoje).
  Ativar o hedge = setar a key + (talvez) o env var. Honesto: SportMonks é stub testado-por-mock
  até ter key (validação ao vivo diferida — ADR 0026 §openUnknowns).

### Desvio consciente do ADR D3 (a confirmar no plano-portão)
D3 disse "add `supportsAbsences` a `ProviderCapabilities`". A Option C dá à `AbsencesProvider`
sua **própria** `AbsencesCapabilities.supportsAbsences` (separação limpa; a interface estreita
é dona da sua capability) — **honra a INTENÇÃO** de D3 (existe um gate de absences) sem poluir a
`ProviderCapabilities` da `SportsDataProvider`. [Plan-review: ok? ou add o flag em ProviderCapabilities tb?]

## 1. Arquivos

**Novos** (`lib/providers/absences/`):
- `types.ts` — `AbsencesProvider` + `AbsencesCapabilities` (reexporta erros de sports-data).
- `sports-data-absences-adapter.ts` — wrapper do `SportsDataProvider` injetado.
- `sportmonks/adapter.ts` (+ `constants.ts`/`errors.ts` se couber) — adapter SportMonks key-gated.
- `fallback-provider.ts` — `AbsencesFallbackProvider`.
- `index.ts` — `getAbsencesProvider()` + `__setAbsencesProviderForTesting` + env vars.
- `__tests__/` — cascata, key-gating, normalização SportMonks (mock), wrapper.

**Modificados**:
- `lib/ai/predict.ts` — step 3 usa `getAbsencesProvider()`; import.
- `lib/ai/__tests__/predict.test.ts` — re-wire o mock de injuries pro absences provider
  (via `__setAbsencesProviderForTesting`); as outras fetches seguem no mock do SportsDataProvider.
- `.env.example` — `SPORTMONKS_API_TOKEN`, `ABSENCES_PRIMARY`, `ABSENCES_FALLBACK`.
- `CLAUDE.md` (gotcha) — SportMonks key-gated/fixture-tested; fronteira `lib/providers/absences/`.

**Intocados**: `sports-data/types.ts` (interface), `fallback-provider.ts`, os 2 adapters
existentes, `backtest-cartridge.ts`.

## 2. SportMonks adapter (mock-tested, live-deferred)
- `createProviderClient({ name:"sportmonks", concurrency:2, throttle:{maxRequests:6, windowMs:ONE_MINUTE}, ... })`.
- Auth: `requireSportMonksToken()` lê `SPORTMONKS_API_TOKEN`; **se ausente, o adapter lança
  `SportsDataUnsupportedError`** (gate) — nunca quebra a análise.
- Endpoints v3: `GET /v3/football/fixtures/{id}?include=sidelined.sideline;sidelined.player;sidelined.type`
  (e teams). Resolução de fixture id como na api-football.
- Normalização → `NormalizedInjury`: `player.name`; `type.model_type`→`injury|suspension`;
  `category`→`status`; `source:"official"`; `confidence`/`capturedAt` opcionais.
- Erros via `wrapSportMonksError` → `SportsDataTransientError` (5xx/429/timeout/schema) /
  `SportsDataNotFoundError` (4xx≠429). **Shape exata da resposta a CONFIRMAR com key viva** —
  o schema Zod + fixtures são best-effort até lá.

## 3. Contrato de erro / cascata (reuso)
`AbsencesFallbackProvider.withFallback`: tenta primário; `Transient`→cascata pro fallback;
`NotFound`→bubble; `Unsupported`→gate (filtra o provider por `supportsAbsences` + liga). Reusa as
classes de erro de `sports-data/types.ts` (sem hierarquia nova). Cuidado (ADR 0005):
`SportsDataTransientError` é abusado pra config gaps → SportMonks com time não-mapeado cascateia/gateia.

## 4. Testes (NENHUM chama Anthropic NEM SportMonks pago)
- `absences/__tests__/fallback.test.ts`: primário Transient → cai no fallback; ambos Unsupported →
  Unsupported (gate); NotFound→bubble. Providers fakes (sem HTTP).
- `absences/__tests__/sportmonks-adapter.test.ts`: normalização sidelined→NormalizedInjury
  (`source:"official"`) com client mockado (`vi.mock("@/lib/providers/http/client")` ou fixtures);
  **sem key → `SportsDataUnsupportedError`**.
- `absences/__tests__/sports-data-absences-adapter.test.ts`: delega ao SportsDataProvider injetado
  (fake) e mapeia capabilities.
- `absences/__tests__/index.test.ts`: factory + `__setAbsencesProviderForTesting` (espelha o de sports-data).
- `predict.test.ts`: re-wire — injuries via absences provider mock; **comportamento idêntico**
  (sem key, o cascade = só o primário = caminho de hoje). Snapshots/inputs inalterados.
- Guard sem-paga: SportMonks adapter NÃO referenciado por vitest config/test script; tests usam mock.

## 5. Critérios de aceite (#227)
- [ ] `AbsencesProvider` estreito + `AbsencesFallbackProvider`; SportMonks marca `source` (official).
- [ ] Gate de capability resolvido (`supportsAbsences` na `AbsencesCapabilities`).
- [ ] Cascata oficial→fallback (capability gate + Transient cascade); fonte ausente degrada pra
  `absences_available=false` (per-side, como #226) — **sem travar a análise**.
- [ ] Composição por env var documentada (`ABSENCES_PRIMARY/FALLBACK`, `SPORTMONKS_API_TOKEN`).
- [ ] Testes de cascata verdes; `typecheck && lint && test` verdes; nenhum teste pago.
- [ ] Custo de quota: **diferido** (sem key SportMonks não dá pra medir ao vivo) — documentado no PR/ADR.

## 7. Resoluções da Rodada 1 do plano-portão (rework — supersede onde conflitar)

Painel de 4 lentes: design **aprovado** (Option C sólida, fiel a D2/D4, blast mínimo, escopo
honesto). Resoluções dos blockers/concerns:

- **[D3 — COMPLY]** `supportsAbsences?: boolean` vai pra `ProviderCapabilities`
  (`sports-data/types.ts`, ao lado de supportsInjuries/supportsLineups). api-football = `true`
  (supportedLeagues BR/CL como injuries); football-data-org = `false`. A `AbsencesProvider`
  **reusa `ProviderCapabilities`** (não cria AbsencesCapabilities). O wrapper expõe a capability
  do SportsDataProvider; o SportMonks monta a sua.
- **[key-gating via CAPABILITY, não throw]** O adapter SportMonks **não lança no construtor**.
  `capabilities.supportsAbsences = hasToken(SPORTMONKS_API_TOKEN) && liga coberta`. **Sem token →
  `supportsAbsences=false` → o cascade FILTRA o SportMonks (nunca invoca)** → sobra só o primário
  → comportamento **idêntico a hoje**. `requireSportMonksToken()` só é chamado DENTRO de
  getAbsences* (só alcançado se gated-in, i.e., token presente).
- **[cascade gate ANTES de invocar]** `AbsencesFallbackProvider.withFallback` filtra os candidatos
  por `(p) => p.capabilities.supportsAbsences && p.capabilities.supportedLeagues.has(ref.league)`
  **ANTES** de tentar (espelha `fallback-provider.ts:86-88`), NÃO gate-after-catch. Depois:
  `Transient`→próximo candidato; `NotFound`→bubble; **nenhum candidato suporta → lança
  `SportsDataUnsupportedError`** (predict.ts pega no catch → `unavailable`, como hoje). WC:
  primário lança Unsupported no fetch + SportMonks gated-out → termina em `unavailable` (idêntico).
- **[resolução LAZY do SportsDataProvider no wrapper]** `sportsDataAbsencesAdapter` resolve o
  SportsDataProvider **por chamada** (via um `resolve: () => SportsDataProvider` injetável, default
  `getSportsDataProvider`) — respeita `__setSportsDataProviderForTesting`. Unit test injeta um fake.
- **[backtest TAMBÉM migra]** `scripts/backtest-cartridge.ts` (linha ~697) passa a usar
  `getAbsencesProvider().getAbsencesByFixture(ref)` (consistência com predict; e torna o wrapper o
  **único** consumidor de `SportsDataProvider.getInjuries*` → sem dead-code). Move de "Intocados"
  pra "Modificados".
- **[SportMonks: unmapped team → `SportsDataNotFoundError`]** (bubble), **NÃO** Transient — evita
  o mis-cascade do abuso de Transient pra config gaps (ADR 0005). 5xx/429/timeout/schema →
  `SportsDataTransientError`; 4xx≠429 → `SportsDataNotFoundError`.
- **[erros: REUSAR a hierarquia de sports-data]** (D4 "mesmo padrão"; o wrapper delega ao
  SportsDataProvider que já lança essas; o predict.ts já as pega). **Rejeitado** criar
  AbsencesTransientError/etc. (adicionaria tradução no wrapper + mudaria o catch do predict, sem
  ganho — são efetivamente "erros de provider-data"). Documentar que a hierarquia é compartilhada.
- **[predict.test.ts re-wire — concreto]** `vi.mock("@/lib/providers/absences")` com
  `getAbsencesProvider()` devolvendo um AbsencesProvider espião (spy em getAbsencesByFixture) via
  `__setAbsencesProviderForTesting`; o mock do SportsDataProvider **mantém**
  getTeamForm/getH2H/getStandings/getLineups; `getInjuriesByFixture` **deixa de ser chamado** pelo
  predict (asserção: nunca invocado pós-pivot). Comportamento byte-idêntico (sem token → só primário).
- **[ops docs]** `.env.example` + CLAUDE.md: `API_FOOTBALL_KEY` **OBRIGATÓRIO** em prod (senão o
  primário falha Transient e inverteria pro fallback); `SPORTMONKS_API_TOKEN` **OPCIONAL** (sem ele,
  hedge inerte). `ABSENCES_PRIMARY`(default `sports-data`)/`ABSENCES_FALLBACK`(default `sportmonks`).
- **[SportMonks adapter — incertezas marcadas]** throttle 6/min (estimativa conservadora do trial,
  validar headers de rate-limit ao vivo); auth `Authorization: Bearer ${token}` (validar vs docs);
  schema Zod inferido dos docs v3 + **fixtures realistas** no teste + comentário "schema inferido,
  validar ao vivo"; qualquer teste live futuro **skip-in-CI**. Monitor de quota MENSAL (ADR 0026 D9)
  fica **FORA do #227** (a graduação do sinal pede; documentar).
- **[per-side]** mantém o seam do #226 (home==away hoje); comentário em predict explicando que
  diverge quando o SportMonks (multi-source) ativar.

## 6. Riscos / atenção do plano-portão
- **Re-wire do predict.test.ts** (injuries mock → absences provider): risco de quebrar muitos casos;
  manter comportamento byte-idêntico (sem key → só primário).
- **Wrapper do SportsDataProvider** como primário de absences: confirmar que `getAbsencesProvider()`
  resolve o SportsDataProvider memoizado (e respeita `__setSportsDataProviderForTesting`).
- **Desvio do D3** (capability na AbsencesProvider vs ProviderCapabilities) — confirmar.
- **SportMonks shape incerto** sem key → schema/fixtures best-effort; validação ao vivo diferida.
- **Valor incremental hoje é baixo** (API-Football já cobre BR/CL — #225): #227 entrega a
  ARQUITETURA do hedge (zero-behavior-change), pronta pra ativar com uma key. Honesto no PR.
- Per-side: mantém o seam do #226 (ambos iguais hoje); divergência real fica pra quando SportMonks ativar.
