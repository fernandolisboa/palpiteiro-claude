# ADR 0049 — Premier League e La Liga como ligas suportadas e ativas

## Status

Accepted (2026-09-24). Opção A do card "quais competições adicionar" (thread "Missing games and more competitions"). Irmãos: ADR 0044 (Serie A/Bundesliga/Ligue 1, registradas e desligadas) e o thread Libertadores/Sul-Americana.

## Contexto

Pós-Copa (#491) o app tem só Brasileirão + Champions ativas. O dono pediu as grandes ligas europeias. O CLAUDE.md exige ADR pra liga nova. Premier League e La Liga não pedem abstração nova: são ligas de clube de calendário cruzado, como a Champions, e os dois providers de dados as cobrem (API-Football: 39 / 140; football-data.org grátis: `PL` / `PD`). O que decide é o **orçamento da The Odds API** (plano grátis, 500 créditos/mês; o dono não vai subir de plano agora).

## Decisão

### 1. Registro aditivo das duas ligas

`premier_league` e `la_liga` entram no fim de `SUPPORTED_LEAGUES`, do enum `league` (migration própria, `ALTER TYPE … ADD VALUE`), dos mapas de provider (API-Football 39/140, football-data `PL`/`PD`, Odds API `soccer_epl`/`soccer_spain_la_liga`) e da UI (keys `epl`/`laliga`, região "Europa"). `currentSeason` usa a regra cruzada da Champions (agosto–maio). Mercados ficam no default (1X2 + over/under 2.5); `lib/odds/market-descriptor.ts` não muda.

### 2. Times canônicos e ids (temporada 2026/27)

Elencos: PL 2025/26 − Wolves, Burnley, West Ham + Coventry, Ipswich, Hull; La Liga 2025/26 − Oviedo, Girona, Mallorca + Racing Santander, Deportivo, Málaga. Canônicos seguem os nomes do football-data (como na Champions). Sem key de provider no ambiente, os ids foram conferidos fora da API: API-Football pelos 40 ids no footlab.ai (que usa ids da API-Football), football-data pelos escudos em `crests.football-data.org/{id}.png`. Nomes da API-Football que o fuzzy não resolve viram `TEAM_NAME_ALIASES`. Continua na estratégia de mapas estáticos da ADR-0005 (~144 times, abaixo do limiar de 200).

### 3. Lacuna conhecida: Racing Santander no football-data

O id do Racing no football-data não foi confirmado, então ficou fora do mapa, e o teste de cobertura lista a lacuna explicitamente. A API-Football (primária) cobre o time, então só um jogo do Racing durante uma queda da API-Football perde forma/H2H. Pra fechar: `pnpm tsx scripts/generate-team-ids.ts --provider=football-data-org` com a key local.

### 4. Casamento de nomes com a The Odds API (correção de `normalizeTeamName`)

`teamsMatch` casa por igualdade **ou inclusão** do nome normalizado. Com `atletico`/`athletic` como stopwords, "Atlético Madrid" virava "madrid" e casava com "Real Madrid CF" e "Rayo Vallecano de Madrid" (no dérbi, o 1X2 inverteria casa/fora), e "Athletic Club" virava "" (nunca achava as odds de "Athletic Bilbao"). Decisões: tirar `atletico`/`athletic` das stopwords e adicionar `and` ("Brighton and Hove Albion" × "Brighton & Hove Albion FC"). Encurtar dois canônicos pra o nome não conter o do rival da mesma cidade: "RCD Espanyol" (não "… de Barcelona") e "Rayo Vallecano" (não "… de Madrid"), com alias pro nome longo do football-data. Um teste pina que cada nome da Odds API casa **exatamente um** canônico e que nenhum par de canônicos se casa. Os nomes da Odds API do teste vêm da convenção conhecida do provider e não foram validados ao vivo, porque não há `ODDS_API_KEY` neste ambiente. A mudança de stopwords foi conferida contra Brasileirão e Champions pela suíte existente.

### 5. Orçamento: janela de prewarm 48h → 24h, e as duas ligadas por decisão do dono

Custo por fonte, lido do código:

- **Prewarm** (`lib/odds/prewarm-odds.ts`, cron a cada 6h = 4 runs/dia): uma liga só gasta num run se tem jogo nas próximas `ODDS_PREWARM_WINDOW_HOURS`. Nesse caso são 2 chamadas featured (totals + h2h, região `eu`) = **2 créditos por liga por run**. Teto: 4 × 30 × 2 = 240/mês por liga.
- **Página do jogo**: um snapshot com mais de 30 minutos refaz as 2 chamadas featured da liga (2 créditos). O gasto acompanha o uso, não o número de ligas.
- **Análise e CLV** (`capture-closing-odds`, a cada 30min, só jogos com predição non-pass em KO ≤ 90min): também acompanham o uso.

Estimativa mensal do prewarm com janela de 24h, contando os runs com jogo nas próximas 24h numa semana típica:

| Liga | Runs/semana | Créditos/mês |
|---|---|---|
| Brasileirão (quarta + fim de semana, calendário apertado pós-Copa) | ~22–26 | ~190–220 |
| Champions (terça/quarta, ~2 rodadas/mês) | ~4–5 | ~35–45 |
| Premier League (concentrada sáb/dom, pausas FIFA) | ~10–15 | ~90–130 |
| La Liga (sexta a segunda quase toda semana) | ~13–16 | ~110–140 |

Brasileirão + Champions + as duas = **~425–535** só de prewarm, antes do uso (~30–80 pra um usuário). Isso fica **no limite ou acima** dos 500. Estourar a cota derruba as odds de **todas** as ligas até o reset mensal. Só a Premier League daria ~345–475 com o uso. Com a janela antiga de 48h, cada liga somaria ~50% a mais.

**Decisão do dono (2026-09-24): as duas ligadas**, ciente do risco de estouro. Ambas entram em `ACTIVE_LEAGUES`, e nenhuma fica em `HIDE_WHEN_INACTIVE`. Quando o Brasileirão acabar (dezembro), abrem ~200 créditos/mês e a folga volta.

**Recuo se a cota apertar** (acompanhar `quotaMonthlyUsed` no log `prewarm_odds.run_complete`; se passar de ~400 antes do dia 20): tirar `"la_liga"` de `ACTIVE_LEAGUES` (`lib/config/active-leagues.ts`) e pôr `"laliga"` em `HIDE_WHEN_INACTIVE` (`lib/view/league-picker.ts`). É o mesmo mecanismo da ADR 0044.

## Alternativas rejeitadas

1. **Só a Premier League ligada**: cabe com folga, mas o dono preferiu ter as duas e aceitar o risco de cota (§5).
2. **Prewarm só em ligas com análise recente**: economiza, mas muda a política de cache de todas as ligas. Fica como follow-up se o dono quiser as duas no plano grátis.
3. **Odds featured via API-Football (plano Pro pago)**: o roteador de odds (ADR 0025) manda featured pra The Odds API. Trocar isso é decisão de provider, com ADR próprio.
4. **Canônicos longos do football-data sem mexer em stopwords**: mantém o 1X2 invertido nos dérbis de Madri/Barcelona e as odds do Athletic ausentes.

## Consequências

- /jogos ganha Premier League e La Liga (região Europa).
- O sync de fixtures (football-data grátis cobre `PL`/`PD`) passa a buscar as duas temporadas a cada 6h.
- O teto real da cota continua sendo a medição do `prewarm_odds.run_complete` (`quotaMonthlyUsed`). Se passar de ~400 no meio do mês, aplique o recuo do §5.
