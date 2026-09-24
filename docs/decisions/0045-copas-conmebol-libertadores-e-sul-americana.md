# ADR 0045 — Copas CONMEBOL: Libertadores e Sul-Americana como ligas suportadas (registradas, fora de ACTIVE_LEAGUES)

## Status

Accepted (2026-09-24). Pedido do dono: adicionar todas as competições propostas no card de decisão (opção C = Libertadores + Sul-Americana, com Copa do Brasil avaliada junto porque as três dependem da API-Football pra fixtures). O `CLAUDE.md` exige ADR pra liga nova.

> **Número:** 0039–0041 (Fase C, CSP, JEV) e 0044 (ligas europeias, PR #505) já estão tomados; conferir o próximo livre no merge.

## Contexto

Adicionar uma liga toca: enum `league` (migration), `SUPPORTED_LEAGUES` + ids de provider + calendário em `currentSeason()` (`lib/providers/sports-data/leagues.ts`), sport key da The Odds API (`lib/providers/odds-api-constants.ts`), key/rótulo da UI (`lib/view/types.ts`, `lib/format.ts`), região no seletor (`lib/view/league-picker.ts`), times canônicos e mapas de team id, e `ACTIVE_LEAGUES`.

### Cobertura — verificado vs. inferido

| Competição | Fixtures (API-Football) | Odds (The Odds API) | football-data.org (free) |
|---|---|---|---|
| Libertadores | id 13 — **inferido** (plano Pro/7500-dia registrado nos ADRs via `GET /status`; o Pro cobre todas as competições e temporadas correntes). Não testado ao vivo: o ambiente cloud não tem `API_FOOTBALL_KEY`. | `soccer_conmebol_copa_libertadores` — **verificado** na lista pública (the-odds-api.com/sports-odds-data/sports-apis.html, 2026-09-24). `GET /v4/sports` não testado (host bloqueado, sem key). | Não (CLI é tier pago) |
| Sul-Americana | id 11 — idem | `soccer_conmebol_copa_sudamericana` — **verificado** na mesma lista | Não oferece |
| Copa do Brasil | id 73 — inferido | **Ausente** da lista pública (verificado) | Não |

## Decisão

1. **Libertadores (`copa_libertadores`, key `lib`) e Sul-Americana (`copa_sudamericana`, key `sula`) entram como ligas suportadas**, região "América do Sul" no seletor. Mercados nos defaults (1X2 + over/under 2.5); `market-descriptor.ts` não muda (cobertura de mercado é de outra thread).
2. **Copa do Brasil fica de fora.** Sem sport key na The Odds API o motor não tem odd pra calcular edge (todo mercado default passa pela The Odds API), então toda análise viraria erro/pass. Precificar via o odds provider da API-Football (hoje só cauda do Brasileirão, ADR 0025) é trabalho de mercado, fora deste escopo. Reavaliar pra 2027 se a The Odds API passar a listar.
3. **Registradas, mas fora de `ACTIVE_LEAGUES`.** O dono não vai subir o plano da The Odds API agora (500 créditos/mês). O prewarm custa ~2 créditos por liga por run (h2h + totals, featured) nos runs com jogo na janela, 4 runs/dia; com a janela de prewarm de 24h, cada copa em mata-mata soma ~40 créditos/mês (estimativa: 2–3 semanas de jogo/mês, 2–3 dias com jogo em 24h por semana), mais fetches de página e closing line. Estimativa conjunta das threads de liga (mês típico): Brasileirão ~200, Champions ~40, Premier League ~140, La Liga ~140, copas ~80 → ~600, acima dos 500. Cabem juntos, por exemplo: Brasileirão + Champions + copas (~320) ou Brasileirão + Champions + uma liga inglesa/espanhola + copas (~460). No seletor elas ficam **escondidas** enquanto inativas (`HIDE_WHEN_INACTIVE` em `lib/view/league-picker.ts`, mesmo mecanismo das ligas europeias do PR #505): uma opção desabilitada sem explicação só confunde. Ligar = uma linha em `ACTIVE_LEAGUES`.
4. **API-Football é a única fonte de fixtures.** `FOOTBALL_DATA_ORG_LEAGUE_CODES` vira `Partial`; o adapter do football-data.org não lista as copas em `supportedLeagues` (o `FallbackProvider` nunca roteia pra lá) e um helper `competitionCode()` lança `SportsDataUnsupportedError` se alguém furar o gate. O gerador de team ids pula ligas sem código e só semeia canônicos a partir de um provider que devolveu times.
5. **Calendário:** ano-calendário, preliminares no início de fevereiro e final em novembro → `month >= 2 ? year : year - 1`.
6. **Times canônicos começam vazios** (bootstrap previsto no ADR 0005 / `scripts/generate-team-ids.ts`). Nomes passam direto (`canonicalizeOrPassthrough`), mas `getTeamForm`/`getH2H` da API-Football precisam do team id → **antes de ligar uma copa, rodar** `pnpm tsx scripts/generate-team-ids.ts --provider=api-football` com a key (1 request por liga), que semeia a lista canônica e o mapa de ids e confirma ao vivo que o plano devolve a temporada 2026.

## Alternativas rejeitadas

- **Ligar as copas já** — estoura os 500 créditos/mês junto das ligas europeias; a escolha de quais ligar fica com o dono.
- **Semear os canônicos à mão** — sem key não dá pra saber o elenco de clubes vivo no mata-mata de 2026 nem os ids; inventar lista quebraria form/h2h silenciosamente.
- **Resolver team id em runtime via `/teams`** — resolveria o bootstrap sem script, mas é mudança de adapter maior que o necessário enquanto as copas estão desligadas.

## Consequências

- Migration só adiciona valores ao enum (`ALTER TYPE ... ADD VALUE`), sem risco pra dados existentes.
- Nada sincroniza nem aquece odds das copas até entrarem em `ACTIVE_LEAGUES` → custo zero de quota hoje.
- Ativação = rodar o gerador de team ids + adicionar a linha em `ACTIVE_LEAGUES`, ambos num PR.
- **Final em jogo único e campo neutro:** hoje só `world_cup` é tratada como campo neutro (`lib/ai/predict.ts`, `app/actions/bets.ts`). As finais da Libertadores e da Sul-Americana são jogo único em sede neutra; sem ajuste, o mandante listado seria analisado como se jogasse em casa. Irrelevante enquanto as copas estão desligadas; resolver (por fase/rodada da fixture) antes de ligar uma copa no período da final.
