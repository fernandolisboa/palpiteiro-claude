# ADR 0026 — Fonte de desfalques (escalações/lesões/suspensões): oficial-primeiro com proveniência

## Status

Accepted (2026-06-17) — **emenda o ADR 0006** (esclarece que a ausência de fonte de
desfalques é **específica da Copa**, não geral) e **estende o ADR 0005** (cascata de
providers de sports-data). Cita o ADR 0017 (bump de `PROMPT_VERSION` por cartucho) e o
ADR 0025 (API-Football PRO, throttle 8 req/min).

> **Numeração:** a issue #225 propôs provisoriamente "0023"; mas 0023/0024/0025 já estão
> ocupados. Este ADR é o **0026**; o ADR multi-provider de IA (#229) será o **0027**.

## Contexto

A ideia: adicionar um sinal de **desfalques** (escalações, lesões, suspensões)
oficial-primeiro pra melhorar a análise. O pipeline **já existe**: a `SportsDataProvider`
expõe `getInjuriesByFixture/ByTeam`/`getLineups` (`lib/providers/sports-data/types.ts:257-264`),
normaliza em `NormalizedInjury` (`types.ts:147-153`), e o sinal flui
`predict.ts:352 (getInjuriesByFixture) → absencesAvailable (predict.ts:371) →
PlayerAbsenceSchema (lib/ai/markets/over_under/schemas.ts:52) → prompt over_under`.

A regra-portão (CLAUDE.md) exige ADR pra provider novo de dados, e o **ADR 0006 já
rejeitou** um "provider dedicado de lesões" citando ausência de fonte free confiável. A
discovery do #225 reavaliou esse precedente e produziu um achado decisivo:

- **A API-Football (provider primário atual, PRO 7500 req/dia — ADR 0025) JÁ cobre
  desfalques de Brasileirão Série A E Champions League.** Concreto no código:
  `adapter.ts:819` declara `supportsInjuries: true` e `supportedLeagues` inclui
  `brasileirao_a` + `champions_league` (`adapter.ts:822-824`); o endpoint `/injuries` é
  chamado de fato (`getInjuriesByFixture` em `predict.ts:352`). **O gargalo de cobertura
  que motivou o arco só existe pra Copa.**
- **A rejeição do ADR 0006 era específica da Copa**: `coverage.injuries=false`
  estrutural pra `league=1` (Mundial), e **não há fonte free confiável de desfalques de
  Copa** (segue verdade em 2026). Isso **não** se aplica a BR/CL, onde os desfalques são
  estruturados e confiáveis via API-Football.
- **Fontes oficiais cruas** (CBF, UEFA, sites de clube) **não têm API estruturada** —
  acesso só por scraping, que viola ToS e é frágil/inviável em produção.
- **Hoje o sinal é pobre em proveniência**: o único indicador de confiança é o booleano
  binário `absencesAvailable` (`predict.ts:371`), passado **igual** pros dois lados
  (`predict.ts:668` e `:673`) — não expressa "presente mas baixa confiança" nem cobertura
  assimétrica home/away.

**Decisão do dono (2026-06-17):** mesmo com BR/CL já coberto, **construir o arco
oficial-primeiro com proveniência** — como hedge de redundância/qualidade (se a
API-Football degradar ou estourar quota) e pra tornar o sinal honesto (proveniência +
per-side). A discovery confirma que isso é **arquitetura nova sobre cobertura existente**,
não fechar um gap de cobertura de BR/CL.

## Decisão

1. **Estratégia oficial-primeiro de fontes.** PRIMARY = **API-Football** (já cobre BR/CL,
   PRO 7500/dia, custo de quota das chamadas de injuries negligível). FALLBACK =
   **SportMonks** (entidade `sidelined` = lesões/suspensões em todos os tiers, trial free +
   tier barato, cobre BR/CL). `football-data.org` segue `supportsInjuries:false`. Fontes
   oficiais cruas (CBF/UEFA/clubes) e free-text news ficam **FORA** (ver Alternativas).

2. **Forma do provider: `AbsencesProvider` ESTREITO** (interface nova, ~3 métodos
   future-proof — `getAbsencesByFixture`/`getAbsencesByTeam`), com **orquestração própria
   no step 3 do `predict.ts`** — NÃO reusar a `SportsDataProvider` gorda (9 métodos; uma
   fonte só-de-desfalques stubaria ~7 com `SportsDataUnsupportedError`, poluindo a
   cascata). Nomes agnósticos a "injury" pra acomodar futuras fontes.

3. **`ProviderCapabilities`: adicionar a flag plana `supportsAbsences`** (espelha
   `supportsInjuries`/`supportsLineups`, `types.ts:205-206`). `supportsNews` fica
   **documentada mas não implementada** (free-text rejeitado). Nada de sub-objeto aninhado
   (complexidade sem payoff).

4. **Cascata: COMPOR/ANINHAR, não generalizar pra N.** Uma composição fallback própria de
   `AbsencesProvider` (mesmo padrão do `FallbackProvider`, hoje hard-wired a 2 providers em
   `fallback-provider.ts:40-42`), com factory de absences estendendo
   `ProviderName`/`VALID_PROVIDERS`/`parseProviderName`/`makeAdapter` (`index.ts:6-45`).
   Previsto ≤3 providers → aninhar basta; generalizar pra N fica pra quando houver need.

5. **Modelo de proveniência.** Estender `NormalizedInjurySchema` (`types.ts:147`) e
   `PlayerAbsenceSchema` (`schemas.ts:52`) com `source` / `confidence` / `capturedAt`
   (opcionais; ausência = confiança plena). O adapter de cada fonte carimba o `source`; o
   prompt over_under passa a expor a confiança → **bump de `PROMPT_VERSION`** do cartucho
   (ADR 0017) + novo eval.

6. **Per-side honesto.** Tornar `absencesAvailable` per-side (`{home, away}`) — hoje é
   passado igual aos dois lados (`predict.ts:668`/`:673`). Justificado AGORA pela
   proveniência mista: uma fonte pode cobrir um time e não o outro.

7. **Free-text news FORA** (alternativa-rejeitada, ver abaixo).

8. **Critério de prediction-quality.** Avaliar o ganho do sinal via o **replay-prompt-eval**
   (o gate, agora model-aware — ADR 0021/#203) comparando recomendação/confiança **com vs
   sem** o sinal de desfalque numa amostra de jogos BR/CL (flip-rate + mediana |Δconf|),
   antes de graduar o sinal de admin-only a default.

9. **Quota/custo.** API-Football PRO **7500 req/dia** (ADR 0025); throttle **8 req/min**
   (`adapter.ts:85`); chamadas de injuries são incrementais e baratas. SportMonks =
   trial/tier barato. **Lacuna a fechar:** o `quota-logger` só loga per-min/daily — o
   mapping de header **mensal** está undeployed; adicionar monitor de quota mensal (cron
   diário, alertar < 20%). Custo de token por análise é pequeno (sinal estruturado, cacheado
   no match data). **A quota MENSAL real da API-Football fica a CONFIRMAR** na implementação
   (não ancorar em número não-documentado).

## Razão

- **Redundância/hedge**: se a API-Football degradar a cobertura de injuries ou estourar
  quota, o fallback SportMonks mantém o sinal — sem single-point-of-failure.
- **Honestidade do sinal**: proveniência (`source`/`confidence`/`capturedAt`) + per-side
  substituem o booleano binário de hoje, que não distingue "sem dado" de "dado fraco".
- **Oficial-primeiro, ToS-safe**: só fontes estruturadas com licença (API-Football,
  SportMonks) — sem scraping de federação/portal.
- **Eval-gated**: o ganho de qualidade é medido (gate de replay), não assumido.
- **Estreito > gordo**: `AbsencesProvider` dedicado evita stubar 7 métodos irrelevantes e
  mantém o step 3 do predict simples.

## Alternativas consideradas

- **Status quo (só API-Football, sem proveniência/per-side):** rejeitado pelo dono — quer
  o hedge de redundância + a honestidade de proveniência. (É a opção mais lean; revisitável
  se o custo do arco não se pagar.)
- **Reusar a `SportsDataProvider` gorda:** rejeitado — stubar ~7 métodos com
  `SportsDataUnsupportedError` polui a cascata e abusa do erro de capability.
- **Generalizar o `FallbackProvider` pra N providers:** rejeitado agora — complexidade na
  agregação de capabilities/nome sem payoff pra ≤3 providers; aninhar é idiomático.
- **Free-text news (portais/Sofascore/Transfermarkt):** rejeitado — sem seam tipado infla
  token-cost (sem cache do texto), alto risco de alucinação/ruído numa análise financeira,
  e ToS/legal (Sofascore/Transfermarkt proíbem scraping). Fica como alternativa-rejeitada,
  não issue de implementação.
- **Scraping oficial direto (CBF/UEFA/clubes):** rejeitado — sem API estruturada, ToS, e
  frágil a mudança de layout (inviável pra automação de matchday).
- **Sportradar (oficial enterprise):** rejeitado — contrato $5k+/mês; desnecessário pro need
  atual.
- **Overturnar o ADR 0006 por completo:** NÃO — o "não há fonte free de desfalques" segue
  válido **pra Copa**; este ADR só **emenda o ESCOPO** desse raciocínio (Copa, não BR/CL).

## Consequências

- (+) Sinal de desfalque com **proveniência + per-side + fallback** oficial-primeiro,
  eval-gated antes de virar default.
- (−) Complexidade nova: interface `AbsencesProvider`, flag `supportsAbsences`, adapter
  SportMonks, composição de fallback de absences, e (opcional) a tabela de cache do #228.
- (−) **Bump de `PROMPT_VERSION`** do cartucho over_under (expor confiança) → exige novo
  replay-eval (ADR 0017).
- (±) Quota **mensal** da API-Football passa a importar e **não é monitorada** hoje —
  adicionar o monitor é pré-requisito de graduar o sinal.
- (−) **A Copa segue sem desfalques** (nenhuma fonte free confiável; `coverage.injuries=false`)
  — fora do alcance deste ADR; o caminho `absences_available=false` (ADR 0006) continua.
- (−) Confiança da discovery sobre cobertura BR/CL é **média** (não validada ao vivo numa
  temporada inteira) — a implementação deve confirmar ao vivo antes de depender do sinal.

## Referências

- Discovery e decisão: **#225** (esta issue). Implementação derivada (gated atrás deste
  ADR, **via plano-portão de duas rodadas** do repo — plan-review → rework → lean re-verify
  ANTES de código): **#226** (proveniência no modelo/schema/prompt), **#227** (provider de
  desfalques fallback no seam da cascata), **#228** (tabela `team_absences_snapshots` de
  cache — opcional).
- **Emenda o ADR 0006** (escopo Copa do "sem fonte de lesões") e **estende o ADR 0005**
  (cascata de providers + abuso de `SportsDataTransientError` pra config gaps). Cita o
  **ADR 0017** (bump de `PROMPT_VERSION`) e o **ADR 0025** (API-Football PRO, throttle).
- Código: `lib/providers/sports-data/types.ts` (`NormalizedInjurySchema:147`,
  `ProviderCapabilities:203-206`, métodos `:257-264`), `fallback-provider.ts:40-42`
  (constructor 2-provider), `index.ts:6-45` (factory/`ProviderName`),
  `api-football/adapter.ts:85` (throttle), `:819-824` (`supportsInjuries`+ligas),
  `predict.ts:352` (fetch), `:371` (`absencesAvailable`), `:668`/`:673` (per-side hoje
  igual), `lib/ai/markets/over_under/schemas.ts:52` (`PlayerAbsenceSchema`).
