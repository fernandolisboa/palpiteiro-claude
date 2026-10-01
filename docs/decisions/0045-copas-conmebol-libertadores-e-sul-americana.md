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

## Emenda (2026-09-27) — ids de times em runtime, Libertadores ativável pelo admin

Pedido do dono: "adicionar a Libertadores e a Copa do Brasil na lista". Com o ADR 0050 a ativação virou toggle no `/admin/leagues`, mas o toggle recusa liga sem times canônicos, e semear exige o script com a `API_FOOTBALL_KEY`, que só existe no deploy. A alternativa rejeitada acima ("resolver team id em runtime via `/teams`") passa a ser a decisão pras copas.

1. **`RUNTIME_TEAM_ID_LEAGUES`** (`lib/providers/sports-data/leagues.ts`) = Libertadores + Sul-Americana. Quando o mapa estático (`api-football/team-ids.ts`) não tem o time, `resolveApiFootballTeamId` busca `/teams?league&season` (1 request, cache de 1 dia por instância) e casa passando cada nome pelo mesmo `canonicalizeOrPassthrough` do sync de fixtures. Zero ou mais de um resultado → `SportsDataTransientError`, como antes. Ligas de mapa estático não mudam (nunca chamam `/teams`).
2. **Lista canônica da Libertadores = os 4 semifinalistas de 2026**, com grafia escolhida pra casar os dois providers: `Flamengo`, `Palmeiras`, `Fluminense` (nome curto da API-Football; o canônico do Brasileirão "SE Palmeiras" não pareia "Palmeiras-SP" da The Odds API) e `Estudiantes de La Plata` (alias `Estudiantes L.P.`). Grafias da The Odds API conferidas em `/v4/sports/soccer_conmebol_copa_libertadores/events` (endpoint grátis) em 2026-09-27: Estudiantes La Plata x Flamengo-RJ e Fluminense-RJ x Palmeiras-SP. A lista não precisa cobrir clubes eliminados; clube fora dela passa direto com o nome da API-Football. Numa edição nova, conferir a grafia dos clubes vivos antes de ligar.
3. **Gate do toggle inalterado** (exige lista canônica não vazia): a Libertadores fica ativável; a Sul-Americana continua bloqueada até alguém fixar a grafia dos clubes dela (hoje: Boca Juniors, Vasco da Gama, Clube Atlético Mineiro, Montevideo City Torque).
4. **Custo:** sem jogo da Libertadores até 13/10, ligar agora custa 0 crédito em setembro. Restam ~5 jogos em 2026 (ida e volta das semis, final em 28/11): ~30–40 créditos em outubro e ~8 em novembro, abaixo dos 40/mês estimados em `odds-credits.ts`.
5. **Final em jogo único:** continua analisada com mando do time listado como mandante (item de Consequências acima). Issue própria; resolver antes de 28/11.

**Copa do Brasil, reconferida:** `GET /v4/sports?all=true` (grátis, 179 esportes, 2026-09-27) não lista Copa do Brasil (só Brasileirão A e B, Libertadores, Sul-Americana e Copa América). Segue fora (§2 acima).

## Emenda (2026-10-01) — final em jogo único como campo neutro (#529)

Fecha o item "Final em jogo único e campo neutro" das Consequências e o item 5 da emenda anterior.

1. **Detecção pela fase do fixture, não por data.** `NormalizedFixture` ganha `round` (cru do provider: `league.round` da API-Football, `stage` do football-data.org). `isNeutralFinalFixture` (`lib/providers/sports-data/neutral-venue.ts`) marca como neutra a fixture cuja fase é exatamente "final" (sem caixa/espaço) numa copa de final em jogo único: Libertadores, Sul-Americana e Champions League (a final da Champions tem o mesmo problema, e a liga está ligada). Semifinal, "3rd Place Final" e fase de grupos não casam.
2. **Coluna `matches.neutral_venue`** (boolean, default false, migration com `IF NOT EXISTS`), gravada e atualizada no upsert do sync de fixtures a cada 6h. `isNeutralVenue(match)` = `world_cup` OU `neutral_venue`; substitui os dois `match.league === "world_cup"` em `lib/ai/predict.ts` e `app/actions/bets.ts`. O modelo de placar (Dixon-Coles e heurístico) já aceitava o flag `neutral`.
3. **Sem override manual.** Afeta um jogo por copa por ano, e o rótulo "Final" é estável na API-Football. Se um dia o provider mudar o rótulo, o sintoma é a final analisada com mando; o conserto é no helper, não num toggle. Rejeitado também: comparar o estádio da fixture com o do mandante (não temos o estádio de cada clube) e data fixa (exigiria manutenção a cada edição).
4. **Fora do escopo:** os prompts LLM não recebem um aviso de campo neutro (continuam vendo só o nome do estádio em "Local"); no motor `code_jev`, que decide 1X2, over/under, BTTS e dupla chance, o λ já sai neutro. O ajuste de ratings (Dixon-Coles) continua tratando finais passadas como jogo com mando; efeito desprezível (um jogo por temporada).
