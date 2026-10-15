# PLAN-578: nome curto, sigla e escudo dos times (linhas 13 e 14 da revisão de design)

Rascunho anterior à implementação (ver `docs/plans/README.md`). Parte 5 de 6 da revisão de design. Depende da parte 1 (#574, PR #581) e da parte 2 (#575, PR #582), **as duas mergeadas em `main`**: referências conferidas no código em `7f059b9` (`main`). As partes 3 (#576, página do jogo) e 4 (#577, listas) e o #580 (ao vivo) estão abertas e mexem nos mesmos arquivos (`match-row`, `upcoming-matches-desktop`, página do jogo, `/apostas`, desempenho): quem mergear depois rebaseia (ver Riscos).

Regras herdadas dos PLAN-574/575: mudanças pequenas e mecânicas; **nenhum nome, link ou logo de casa de apostas**; **não mexer em prompt nem em valores do banco** que vão para o modelo. O nome canônico (`matches.home_team`/`away_team`, `CANONICAL_TEAMS`) **continua sendo a chave de matching** em todo o sistema (odds, prompts, H2H, settlement, rota `/time/[team]`). Nome curto, sigla e escudo são **só de exibição** e vivem na borda de view, como a tradução da Copa (#340) já faz.

---

## Estado atual (aterrado no código)

- **Seam único de time na view:** `lib/view/team.ts` `teamToTeam(canonical, league): Team` devolve `{ name, short, hue, flagCode? }` (`lib/view/types.ts:30-36`).
  - `name` = `displayTeamName(canonical, league)` (`lib/view/team-labels.ts`): na Copa traduz para PT-BR (48 seleções); em clube devolve o canônico **verbatim** ("SE Palmeiras", "SC Corinthians Paulista", "Club Atlético de Madrid").
  - `short` = `SHORT_BY_CANONICAL[canonical] ?? deriveShort(canonical)` (`team.ts:67-123,133-153`). O mapa cobre só Brasileirão (20) e Champions (36). Premier League, La Liga, Libertadores e Copa caem no `deriveShort`, que pode dar 1 ou 2 letras ("South Korea" → "SK", "Bosnia & Herzegovina" → "BH", "Manchester United FC" → "MU").
  - `hue` = `HUE_BY_CANONICAL` (mesmos 56 times) ou `hashHue` (a "cor aleatória" da revisão).
- **Quem usa `short` desde o PR 1:** a sigla de 3 letras entra nos rótulos estreitos: chip de odds e linha do modelo da lista (`lib/view/match.ts:80-82`), tabela do desempenho (`lib/view/dashboard.ts:205-206`), feed de recentes (`lib/view/recent-prediction.ts:58-59`) e o OG do `/p/[id]` (`app/p/[id]/opengraph-image.tsx:66-69`).
- **A colisão "AT":** os três avatares de time cortam a sigla para 2 letras: `team.short.slice(0, 2)` em `components/match-hero.tsx:46`, `components/match-row.tsx:89,95` e `components/upcoming-matches-desktop.tsx:73,77`. "ATM".slice(0,2) e "ATH".slice(0,2) dão "AT". O OG repete o corte em `components/palpites/og-palpite-image.tsx:48-50` (`initialsOf`).
- **Fonte abaixo do piso:** `components/team-avatar.tsx` usa `fontSize: size * 0.36` inline: 7,9px no avatar de 22px da lista e 9,4px no avatar de conta de 26px (`components/nav/account-menu.tsx:33-37`, via `UserAvatar` → `TeamAvatar`). A ADR 0056 (item 8) e o `DESIGN.md:27` registram isso como exceção "até o PR 5".
- **Telas que ainda mostram o canônico cru** (não passam pelo seam): `app/(app)/apostas/page.tsx:139` (título do cartão), `app/(app)/bolao/[id]/page.tsx:49,70,94,181,194-195` (título, resultado, rótulos das apostas, formulários), `app/(app)/bolao/page.tsx:109`, `lib/view/friend-pool.ts:65` (`poolMatchLabel`: select de criar bolão em `bolao/page.tsx:51`, lista em `:119` e cabeçalho em `bolao/[id]/page.tsx:73`), `components/palpites/public-palpite.tsx:60` e `app/p/[id]/page.tsx:53-54` (título do snapshot público), `lib/view/dashboard.ts:195-196` (linha da tabela do desempenho: "FC Bayern München × Paris Saint-Germain FC") e `:343-344` (título do detalhe, `components/dashboard/prediction-detail.tsx:70`), `lib/dashboard/kpis.ts:421` (tooltip do gráfico de banca, `components/dashboard/bankroll-line-chart.tsx:33`), e na página do jogo o objeto `teams` canônico (`app/(app)/match/[id]/page.tsx:306`), que alimenta a grade de apostas (`:318,333`) **e** o "Seu palpite" (`:348` e `:407,434` → `SeuPalpiteSection` em `:596,734`: "Vitória do SE Palmeiras", seletores de gols). Depois de uma ação, duas respostas também voltam com o canônico: a avaliação do cupom (`app/actions/bet-slip.ts:224-227`) e a análise do "Seu palpite" (`app/actions/user-palpite.ts:272,427`).
- **Escudo: nada guardado.** A tabela `matches` (`db/schema.ts:274-293`) não tem coluna de escudo; não existe tabela de times. O Zod do fixture da API-Football descarta o campo: `TeamRefSchema` (`lib/providers/sports-data/api-football/schemas.ts:51-55`, usado só em `:83-84`) só tem `id`, `name`, `winner`. O football-data.org já parseia `crest` (`lib/providers/sports-data/football-data-org/schemas.ts:10`) mas `toNormalizedFixture` (`football-data-org/adapter.ts:238-262`) não o repassa. `NormalizedFixtureSchema` (`lib/providers/sports-data/types.ts:22-41`) não tem campo de escudo.
- **Onde o sync grava:** `ensureUpcomingFixturesSynced` (`lib/sync/sync-upcoming-fixtures.ts`, cron de 6h + trigger `after()` da home) busca a **temporada inteira** de cada liga ativa e chama `upsertMatchesFromProvider` (`lib/db/queries/matches.ts:190-228`), único escritor de `matches` fora do seed. O cache do provider segura a coleção por no máximo 1 dia (`lib/providers/sports-data/cache-ttl.ts`).
- **CSP já libera:** `img-src 'self' data: blob: https:` nas duas variantes (`lib/security/csp.ts`, `buildCsp`), por causa do avatar de perfil do Google. Escudo em `https://media.api-sports.io/...` já passa **sem mudar a política**. `next.config.ts` não tem `images.remotePatterns` e o app não usa `next/image` para imagem remota (o `UserAvatar` usa `<img>` puro).
- **Bandeiras da Copa** (#341): `flagCode` → `public/flags/wc/<code>.svg`, com prioridade sobre as iniciais. Continua assim.

### Auditoria: quem lê `Team.name` e `displayTeamName` (por que mudar `name` em vez de criar `displayName`)

Conferido com `grep` em `main`:

- **Importadores de `lib/view/team` e `lib/view/team-labels`:** só `lib/view/{team,match,dashboard,recent-prediction,sections}.ts`, `app/actions/predictions.ts` (`displayTeams`, só rótulo da view devolvida em `:360,803`), `app/p/[id]/opengraph-image.tsx`, `app/(app)/match/[id]/page.tsx` (`displayTeams`: cards de odds, análises, leitura do modelo, todos `TeamLabels` de tela) e `app/(app)/time/[team]/page.tsx` (título). **Nenhum** arquivo em `lib/ai`, `lib/odds`, `lib/settlement`, `lib/providers`, `lib/ratings`, `lib/sync`, `lib/user-palpite`, `lib/model-base`, `lib/bets` ou `lib/pools` importa esses módulos.
- **Leitores de `Team.name`:** `match-row.tsx:91,97`, `upcoming-matches-desktop.tsx:74,78`, `match-hero.tsx:39,42`, o OG (`opengraph-image.tsx:66-67`) e os dois `displayTeams`. Os `team.name` de `lib/ai/judgments/state.ts` e `lib/ai/markets/types.ts` são outro tipo (input do JEV, montado do canônico).
- **Chaves de identidade continuam no canônico:** links `/time/` (`match/[id]/page.tsx:278-279`, `standings-section.tsx:50` via `teamKey`), `focus` da classificação (`sections.ts:132-133,171`), `compositeFixtureKey`, snapshots de odds, Dixon-Coles, settlement e o casamento de eventos da The Odds API leem `matches.home_team`/`away_team` ou o nome do provider canonicalizado, nunca a view.
- **Caminhos de modelo que recebem nomes de time pegam o canônico do banco, não da página:** `app/actions/user-palpite.ts:238,319` (extração, `checkClaims`, narração), `lib/ai/predict.ts:2027` (`applyUserClaims`), `app/actions/bets.ts` (`parseBetText` relê o match), `app/actions/bet-slip.ts` (relê o match). O `payload` do cupom (`components/bet-slip.tsx:274-296`) e o form do "Seu palpite" (`seu-palpite.tsx:401-403`) não mandam rótulo nenhum ao servidor.

Conclusão: **manter `name` e mudar a semântica** (nome curto) é seguro. Um campo `displayName` novo não traria proteção extra (ninguém fora da view lê `Team.name`) e obrigaria a trocar todos os leitores acima para ter o efeito desejado. A proteção fica num teste de fronteira (13, testes).

---

## Decisões de arquitetura

### Nome curto e sigla: mapa curado em código, com derivação determinística de reserva

**Escolha:** estender `lib/view/team-labels.ts` (que já é o módulo "nome de exibição por canônico") com dois mapas curados, chaveados pelo canônico: nome curto de clube e sigla de 3 letras. Time fora do mapa cai numa derivação determinística. Sem coluna no banco.

Por quê:
- São ~110 times nas ligas ativas (Brasileirão 20, Champions 36, Premier League 20, La Liga 20, Libertadores 4 fixos, Copa 48; com sobreposição). Cabe num arquivo revisável em PR, igual ao mapa da Copa e aos `team-ids.ts`.
- Testável: um teste garante, por liga de `CANONICAL_TEAMS`, que todo time tem nome e sigla curados, que a sigla tem 3 caracteres `[A-Z0-9]` e que **não repete dentro da liga**. É o que faltou para pegar o "AT".
- Uma coluna no banco exigiria seed, migration de dados e uma tela de admin para editar, e mesmo assim precisaria de reserva para o time que o sync acabou de criar. A API-Football não manda sigla no fixture (só no `/teams`), então o banco não teria de onde preencher sozinho.
- Mantém a mesma forma de `displayTeamName` (canônico + liga → texto), então classificação (`lib/view/sections.ts:163`) e página do time (`app/(app)/time/[team]/page.tsx:58`) ganham o nome curto sem mudar.

**Times desconhecidos** (clube que entra no mata-mata da Libertadores e passa direto com o nome da API-Football, ou promovido antes do mapa ser atualizado): derivação determinística (seção 13a). **Colisão dentro do mesmo jogo** (dois times derivados, ou "Palmeiras" PAL contra "Palestino" derivado PAL): um seam de par, `teamPair`, troca a sigla do lado derivado (ou a do visitante, se os dois forem do mesmo tipo) por uma alternativa. As siglas aparecem lado a lado exatamente nos lugares que montam o par (chip de odds, linha do modelo, tabela do desempenho, recentes, OG), então resolver no par cobre todos.

### Escudo: URL do provider gravada em `matches`, escrita pelo sync

**Escolha:** duas colunas anuláveis em `matches` (`home_team_crest_url`, `away_team_crest_url`), preenchidas por `upsertMatchesFromProvider` a partir do fixture normalizado (`teams.home.logo` da API-Football; `homeTeam.crest` do football-data.org quando o fallback serve). O `<img>` aponta direto para o CDN do provider, com as iniciais como reserva.

Por quê:
- A URL chega de graça no mesmo payload que o sync já baixa: **zero chamada nova de API**.
- Cobre as copas, cujos clubes não têm id estático (`RUNTIME_TEAM_ID_LEAGUES`, `leagues.ts:45-46`).
- O match já é lido inteiro (`db.select().from(matches)`) em `/jogos`, `/time/[team]` e `/match/[id]`, então o escudo chega à view sem query nova.
- Backfill automático: o primeiro sync depois do deploy regrava a temporada inteira de cada liga ativa, em até 6h (mais até 1 dia de cache do provider). Jogos de temporadas passadas ficam com `null` e mostram as iniciais.

Alternativas rejeitadas:
- **Montar a URL a partir de `API_FOOTBALL_TEAM_IDS`** (`https://media.api-sports.io/football/teams/<id>.png`): dispensa migration, mas não cobre os clubes das copas (sem id estático), fixa em código um padrão de URL do fornecedor e cria uma segunda fonte de verdade. Rejeitada pelo dono (decisão 3: migration).
- **Tabela `teams`/`team_crests` por time:** normaliza melhor, mas pede join em toda leitura e um escritor novo. Duas colunas no match são o menor passo; dá para extrair depois.
- **Vendorizar os PNGs em `public/`** (como as bandeiras): tira a requisição a terceiro, mas põe arquivos de marca registrada no repositório, não cobre clube novo das copas e precisa de refresh manual.
- **`next/image`:** exigiria `images.remotePatterns` e gasta o otimizador da Vercel por imagem. `<img>` puro com `width`/`height`, `loading="lazy"` e `decoding="async"` basta para um PNG de 22 a 56px.

---

## Ordem sugerida (commits)

1. `docs:` DESIGN.md (regras de nome curto, sigla e escudo; tira a exceção do `TeamAvatar`) e nota na ADR 0056 encerrando a exceção do item 8. A decisão vem antes do código.
2. `feat(view):` linha 13a/13b: nomes curtos e siglas curados em `team-labels.ts`, `teamToTeam` com `fullName`, `teamPair`, teste de fronteira e testes.
3. `feat(ui):` linha 13c: telas que mostravam o canônico cru passam a usar o nome curto.
4. `fix(ui):` linha 14e (parte 1): `TeamAvatar` com piso de 11px e sigla inteira; OG com 3 letras.
5. `feat(sync):` linha 14a-14c: migration `0058`, colunas no schema, escudo no fixture normalizado (`safeCrestUrl`), upsert com `COALESCE` e testes (incluindo pglite).
6. `feat(ui):` linha 14d-14f: `TeamCrest`, `Team.crestUrl`, `MatchInput` com escudo nos três call sites, teste de CSP, comentário do `csp.ts` e a frase da `/privacidade` (com bump do `LAST_UPDATED`). A frase legal entra no mesmo commit em que o navegador passa a buscar a imagem.
7. Conferência final: `pnpm test && pnpm lint && pnpm typecheck` e o build. O `pnpm build` roda `drizzle-kit migrate` antes do `next build` e falha aqui (`DATABASE_URL` vazio em `.env.local`); validar com `DATABASE_URL="postgresql://u:p@localhost:5432/d" SKIP_ENV_VALIDATION=1 pnpm exec next build` (como no `HANDOFF-card-settlement-e-386.md`). Obrigatório, porque o PR mexe em `app/actions/*` ("use server" só exporta função async). Depois, a revisão visual (critério de saída).

Cada commit deixa `pnpm test`, `pnpm lint` e `pnpm typecheck` verdes.

---

## Linha 13: nome curto de exibição e sigla de 3 letras

### 13a. Mapas curados e derivação (`lib/view/team-labels.ts`)

Mudanças no arquivo (o mapa da Copa e `displayTeamName` continuam no mesmo lugar):

- **Novo `CLUB_SHORT_NAMES: Record<string, string>`** (canônico → nome curto), tabela abaixo.
- **Novo `TEAM_CODES: Record<string, string>`** (canônico → sigla). Recebe o `SHORT_BY_CANONICAL` de `lib/view/team.ts` (movido, valores mantidos para não mudar o que o PR 1 já mostra), mais Premier League, La Liga, os 4 fixos da Libertadores e as 48 seleções (código FIFA).
- **`displayTeamName(canonical, league)`** muda de semântica para clube: Copa → `WC_TEAM_LABELS_PT` (como hoje); clube → `CLUB_SHORT_NAMES[canonical] ?? deriveDisplayName(canonical)`. Atualizar o comentário do topo: deixa de dizer "clubes passam verbatim"; o princípio "canônico é chave, isto é só exibição" continua.
- **Novo `officialTeamName(canonical, league)`**: o nome completo para `title`/tooltip (Copa → PT-BR; clube → canônico). É o `displayTeamName` de hoje, renomeado. Sem subtítulo novo em tela nenhuma neste PR.
- **Novo `teamCode(canonical): string`**: `TEAM_CODES[canonical] ?? deriveCode(canonical)`. Não depende da liga: o mesmo canônico tem a mesma sigla em qualquer competição ("Newcastle United FC" é NEW na Champions e na Premier League).
- **Novo `alternateCode(canonical, taken): string`**: usado só pelo `teamPair` quando as duas siglas do jogo empatam.
- Exportar os mapas e as derivações para os testes (como `WC_TEAM_LABELS_PT` já é).

**`deriveDisplayName(canonical)`** (pura, determinística): tira tokens de afixo **só nas pontas** (`FC`, `CF`, `SC`, `AC`, `CR`, `CA`, `EC`, `SE`, `FK`, `SK`, `KV`, `BC`, `SSC`, `PAE`, `SFP`, `AFC`, `AF`, `FBPA`, `FBC`, `UD`, `CD`, `Club`, `Clube`), preservando o miolo ("Club Atlético de Madrid" → "Atlético de Madrid"). Se sobrar menos de 3 letras, devolve o canônico.

**`deriveCode(canonical)`** (pura, sempre 3 caracteres `[A-Z0-9]`): dobra acento (NFD), maiúsculas, quebra em espaço/hífen/barra/`&`, remove os mesmos afixos e as partículas `DE`, `DO`, `DA`, `DEL`, `LA`, `E`. A regra imita a TV (RIV, BOC, PEÑ→PEN), não as iniciais:
- Primeiro token **genérico** (`ATLETICO`, `INDEPENDIENTE`, `UNIVERSIDAD`, `DEPORTIVO`, `DEPORTES`, `SPORTING`, `REAL`) seguido de outro token: inicial do primeiro + 2 primeiras letras do segundo ("Atletico-MG" → "AMG", "Independiente del Valle" → "IVA", "Universidad Catolica" → "UCA", "Sporting Cristal" → "SCR").
- Senão: 3 primeiras letras do primeiro token ("River Plate" → "RIV", "Boca Juniors" → "BOC", "Racing Club" → "RAC" depois de tirar `Club`, "LDU de Quito" → "LDU", "Palestino" → "PAL").
- Completar com `X` se o nome tiver menos de 3 letras úteis (caso de laboratório, mas o contrato "sempre 3" fica garantido).

Colisão entre derivados ("Independiente" e "Independiente Medellín" dão IND e IME; "Universidad de Chile" e "Universidad Católica" dão UCH e UCA) só importa dentro do mesmo jogo, e lá o `teamPair` resolve.

**`alternateCode(canonical, taken)`**: tenta, em ordem, (1) as 3 primeiras letras do último token significativo, (2) primeira letra + 2 consoantes seguintes do token principal, (3) as 2 primeiras letras do código + `2`. Devolve o primeiro candidato diferente de `taken` ("Palestino" com PAL tomado → PLS).

**Tabela curada** (nome curto · sigla). Siglas existentes mantidas; novas em negrito. Critério do nome: como a TV e os portais brasileiros chamam o time, até 18 caracteres.

Brasileirão: Botafogo FR → Botafogo · BOT; CA Mineiro → Atlético-MG · CAM; CA Paranaense → Athletico-PR · CAP; CR Flamengo → Flamengo · FLA; CR Vasco da Gama → Vasco · VAS; Chapecoense AF → Chapecoense · CHA; Clube do Remo → Remo · REM; Coritiba FBC → Coritiba · CFC; Cruzeiro EC → Cruzeiro · CRU; EC Bahia → Bahia · BAH; EC Vitória → Vitória · VIT; Fluminense FC → Fluminense · FLU; Grêmio FBPA → Grêmio · GRE; Mirassol FC → Mirassol · MIR; RB Bragantino → Bragantino · BRA; SC Corinthians Paulista → Corinthians · COR; SC Internacional → Internacional · INT; SE Palmeiras → Palmeiras · PAL; Santos FC → Santos · SAN; São Paulo FC → São Paulo · SAO.

Champions: AFC Ajax → Ajax · AJA; AS Monaco FC → Monaco · MON; Arsenal FC → Arsenal · ARS; Atalanta BC → Atalanta · ATA; Athletic Club → Athletic Bilbao · ATH; Bayer 04 Leverkusen → Leverkusen · LEV; Borussia Dortmund → Dortmund · BVB; Chelsea FC → Chelsea · CHE; Club Atlético de Madrid → Atlético de Madrid · ATM; Club Brugge KV → Club Brugge · BRU; Eintracht Frankfurt → Eintracht · EIN; FC Barcelona → Barcelona · BAR; FC Bayern München → Bayern · BAY; FC Internazionale Milano → Inter de Milão · INT; FC København → Copenhague · KOP; FK Bodø/Glimt → Bodø/Glimt · BOD; FK Kairat → Kairat · KAI; Galatasaray SK → Galatasaray · GAL; Juventus FC → Juventus · JUV; Liverpool FC → Liverpool · LIV; Manchester City FC → Manchester City · MCI; Newcastle United FC → Newcastle · NEW; Olympique de Marseille → Olympique de Marselha (21, passa do teto) → **Marselha** · MAR; PAE Olympiakos SFP → Olympiacos · OLY; PSV → PSV · PSV; Paphos FC → Pafos · PAP; Paris Saint-Germain FC → PSG · PSG; Qarabağ Ağdam FK → Qarabağ · QAR; Real Madrid CF → Real Madrid · RMA; Royale Union Saint-Gilloise → Union SG · USG; SK Slavia Praha → Slavia Praga · SLA; SSC Napoli → Napoli · NAP; Sport Lisboa e Benfica → Benfica · BEN; Sporting Clube de Portugal → Sporting · SCP; Tottenham Hotspur FC → Tottenham · TOT; Villarreal CF → Villarreal · VIL.

Premier League (além dos que já estão na Champions): AFC Bournemouth → Bournemouth · **BOU**; Aston Villa FC → Aston Villa · **AVL**; Brentford FC → Brentford · **BRE**; Brighton & Hove Albion FC → Brighton · **BHA**; Coventry City FC → Coventry · **COV**; Crystal Palace FC → Crystal Palace · **CRY**; Everton FC → Everton · **EVE**; Fulham FC → Fulham · **FUL**; Hull City AFC → Hull City · **HUL**; Ipswich Town FC → Ipswich · **IPS**; Leeds United FC → Leeds · **LEE**; Manchester United FC → Manchester United · **MUN**; Nottingham Forest FC → Nottingham Forest · **NFO**; Sunderland AFC → Sunderland · **SUN**.

La Liga (além de Athletic, Atlético, Barcelona, Real Madrid e Villarreal): CA Osasuna → Osasuna · **OSA**; Deportivo Alavés → Alavés · **ALA**; Elche CF → Elche · **ELC**; Getafe CF → Getafe · **GET**; Levante UD → Levante · **LVT** (LEV já é o Leverkusen; ligas diferentes, mas evitar de graça); Málaga CF → Málaga · **MAL**; RC Celta de Vigo → Celta · **CEL**; RC Deportivo La Coruña → La Coruña · **DEP**; RCD Espanyol → Espanyol · **ESP**; Racing Santander → Racing Santander · **RAC**; Rayo Vallecano → Rayo Vallecano · **RAY**; Real Betis Balompié → Betis · **BET**; Real Sociedad de Fútbol → Real Sociedad · **RSO**; Sevilla FC → Sevilla · **SEV**; Valencia CF → Valencia · **VAL**.

Libertadores (os 4 fixos de `CANONICAL_TEAMS.copa_libertadores`): Estudiantes de La Plata → Estudiantes · **EST**; Flamengo → Flamengo · FLA; Fluminense → Fluminense · FLU; Palmeiras → Palmeiras · PAL. O resto passa pela derivação.

Copa (nome continua o PT-BR de `WC_TEAM_LABELS_PT`; sigla = código FIFA): Algeria ALG, Argentina ARG, Australia AUS, Austria AUT, Belgium BEL, Bosnia & Herzegovina BIH, Brazil BRA, Canada CAN, Cape Verde Islands CPV, Colombia COL, Congo DR COD, Croatia CRO, Curaçao CUW, Czech Republic CZE, Ecuador ECU, Egypt EGY, England ENG, France FRA, Germany GER, Ghana GHA, Haiti HAI, Iran IRN, Iraq IRQ, Ivory Coast CIV, Japan JPN, Jordan JOR, Mexico MEX, Morocco MAR, Netherlands NED, New Zealand NZL, Norway NOR, Panama PAN, Paraguay PAR, Portugal POR, Qatar QAT, Saudi Arabia KSA, Scotland SCO, Senegal SEN, South Africa RSA, South Korea KOR, Spain ESP, Sweden SWE, Switzerland SUI, Tunisia TUN, Türkiye TUR, USA USA, Uruguay URU, Uzbekistan UZB.

Siglas repetidas entre ligas diferentes (INT para Internacional e Inter; MAR para Marselha e Marrocos; ESP para Espanyol e Espanha; BRA para Bragantino e Brasil) são aceitas (decisão 9 do dono): nunca jogam entre si na mesma competição, e se um dia jogarem o `teamPair` desempata. Conferido: as siglas da tabela não repetem dentro de nenhuma liga de `CANONICAL_TEAMS` (Brasileirão, Champions, Premier League, La Liga, Libertadores, Copa).

A tabela é a final (decisão 1 do dono); ajustes de nome viram troca de string no review do PR.

### 13b. Seam de time (`lib/view/team.ts`, `lib/view/types.ts`)

- `Team` ganha `fullName?: string` (nome oficial, para `title`) e, na linha 14, `crestUrl?: string`. `name` passa a ser o **nome curto**; `short` continua sendo a sigla de 3 letras (não renomear: ~15 call sites e o PR 1 já usam `short`). Atualizar o comentário do tipo.
- `teamToTeam(canonical, league, crestUrl?)`: `name: displayTeamName(...)`, `fullName: officialTeamName(...)`, `short: teamCode(canonical)`, `hue` como hoje, `flagCode` como hoje. Remove `SHORT_BY_CANONICAL` e `deriveShort` (movidos).
- Novo `teamPair(home, away, league, crests?: { home?: string | null; away?: string | null }): { home: Team; away: Team }`: chama `teamToTeam` duas vezes e, se `home.short === away.short`, troca a sigla do lado **derivado** (fora de `TEAM_CODES`) por `alternateCode(...)`; se os dois forem curados ou os dois derivados, troca a do visitante. Assim "Palestino" (derivado PAL) × "Palmeiras" (curado PAL) fica PLS × PAL com qualquer mando, e a sigla curada nunca muda.
- Trocar os pares de `teamToTeam` por `teamPair` **só onde a sigla aparece**: `lib/view/match.ts:78-79`, `lib/view/dashboard.ts:205-206`, `lib/view/recent-prediction.ts:58-59` e `app/p/[id]/opengraph-image.tsx:62-63`. Em `dashboard.ts:358-359`, `app/(app)/match/[id]/page.tsx:135-138` e `app/actions/predictions.ts:96-99` só se usa `.name`: ficam com `teamToTeam` (nome curto chega sozinho), sem churn.

O nome curto chega sozinho, pelo seam, a: lista de jogos (`match-row`, `upcoming-matches-desktop`), cabeçalho do jogo (`match-hero`), rótulos 1X2/dupla chance da página do jogo e da análise recém-feita (`displayTeams`, PR 1), detalhe do desempenho, classificação (`sections.ts:163`) e título da página do time. Nada disso chega ao modelo: `withTeamLabels` só monta rótulo de tela (conferido no PLAN-574, item 7) e o prompt usa o canônico.

### 13c. Telas que mostravam o canônico cru

Todas recebem `league` junto do match (`DbMatch` inteiro ou `match.league` na linha). Em cada uma, montar os nomes com `teamPair(match.homeTeam, match.awayTeam, leagueToKey(match.league))` (ou só `displayTeamName` quando não há sigla):

| Arquivo | Hoje | Depois |
|---|---|---|
| `lib/view/dashboard.ts:195-196` (`toPredictionRowView`) | `home: row.homeTeam` | `home: displayTeamName(...)`; `PredictionRowView` ganha `title` com os nomes oficiais, usado no `title=` de `components/dashboard/predictions-table.tsx:82` |
| `lib/view/dashboard.ts:343-344` (`toPredictionDetailView`) | `home: match.homeTeam` | nome curto (título do detalhe, `prediction-detail.tsx:70`) |
| `lib/dashboard/kpis.ts:421` (`computeBankrollSeries`) | `` `${r.homeTeam} × ${r.awayTeam}` `` | nomes curtos via `displayTeamName(r.homeTeam, leagueToKey(r.league))` (tooltip do gráfico) |
| `app/(app)/apostas/page.tsx:139` (`SlipCard`) | `{slip.match.homeTeam} × {slip.match.awayTeam}` | nomes curtos |
| `app/(app)/bolao/[id]/page.tsx:49` | `teams = { home: match.homeTeam, … }` | nomes curtos (alimenta `poolBetLabel`, título padrão, linha do resultado, `AddEntryForm`, formulário de placar; os `value` dos picks são chaves `home`/`draw`/`away`, `friend-pool-forms.tsx:141-154`) |
| `app/(app)/bolao/[id]/page.tsx:70,94,181,194-195` | `match.homeTeam` | `teams.home` (o objeto acima) |
| `app/(app)/bolao/page.tsx:109` | título padrão com canônico | nomes curtos |
| `lib/view/friend-pool.ts:65` (`poolMatchLabel`) | canônico | `displayTeamName(match.homeTeam, leagueToKey(match.league))` (o `match` já traz `league`) |
| `components/palpites/public-palpite.tsx:60` e `app/p/[id]/page.tsx:53-54` | canônico | nomes curtos (metadados do `/p` também) |
| `app/(app)/match/[id]/page.tsx:306` | `teams` canônico | apagar o objeto e usar `displayTeams` em todos os usos (`:318,333,348,407,434`): grade de apostas e "Seu palpite" |
| `app/actions/bet-slip.ts:224-227` | `toSlipEvaluationView(evaluation, { home: match.homeTeam, … })` | nomes curtos (avaliação que aparece depois de registrar) |
| `app/actions/user-palpite.ts:272,427` | `toUserPalpiteAnalysisView(record, teams, …)` | um `displayTeams` local só para essa chamada; o `teams` canônico continua em `extractPalpiteClaims`, `checkClaims`, `palpiteLabel` e na narração (`:238-255,319-358`), que vão ao modelo |

Por que é seguro (ver a auditoria acima): `BetGridView.teams` e o `teams` do "Seu palpite" só viram rótulo; nenhum rótulo é enviado à action (`bet-slip.tsx:274-296`, `seu-palpite.tsx:401-403`), e as actions (`bet-slip.ts`, `bets.ts`, `user-palpite.ts`) e o `predict.ts` releem o canônico do banco. **Correção desta revisão:** a versão anterior do plano dizia que o `teams` da página alimentava `analysis-context.ts`/`check-claims.ts`; não alimenta (esses recebem o `teams` montado do banco em `user-palpite.ts:238,319` e `predict.ts:2027`). Por isso o "Seu palpite" entra no escopo.

Fora do escopo: o `pool.title` gravado pelo usuário (texto dele), `betLegLabel` de `/apostas` (rótulo do mercado, é do PR 4), o **texto narrado** do "Seu palpite" e das análises (sai do modelo, que recebe o canônico; mexer exigiria mudar prompt), telas de admin (`app/(app)/admin/predictions/[id]/page.tsx:52` continua com o canônico, útil para depurar). `PredictionsTable`/`PredictionDetail` são compartilhados com o admin e seguem a regra de usuário (ADR 0056, item 7).

### Testes da linha 13

- **Teste de fronteira** (novo, `lib/view/__tests__/team-display-boundary.test.ts`, no molde de `components/__tests__/no-bookmaker-copy.test.ts`): varre `lib/ai`, `lib/odds`, `lib/settlement`, `lib/providers`, `lib/ratings`, `lib/sync`, `lib/user-palpite`, `lib/model-base`, `lib/bets`, `lib/pools` e `db/` e falha se algum arquivo (fora de teste) importar `@/lib/view/team` ou `@/lib/view/team-labels`. É a garantia de que o nome curto nunca chega a matching, settlement, odds ou prompt.
- `lib/view/team-labels.test.ts`:
  - para cada liga com `CANONICAL_TEAMS[liga]` não vazia: todo time tem entrada em `TEAM_CODES` e, se não for Copa, em `CLUB_SHORT_NAMES`; sigla casa `/^[A-Z0-9]{3}$/`; siglas **únicas dentro da liga**; nome curto com até 18 caracteres (Copa: até 20, "Bósnia e Herzegovina");
  - regressão do "AT": `teamCode("Club Atlético de Madrid") !== teamCode("Athletic Club")`;
  - `deriveCode` com valores esperados para nomes da Libertadores ("River Plate" RIV, "Boca Juniors" BOC, "Racing Club" RAC, "LDU de Quito" LDU, "Atletico-MG" AMG, "Palestino" PAL, "Independiente del Valle" IVA, "Universidad Catolica" UCA, "Peñarol" PEN) e casos limite (nome de 1 letra, só afixos, acento), sempre `/^[A-Z0-9]{3}$/`;
  - `deriveDisplayName`: tira afixo só nas pontas, nunca devolve vazio;
  - `displayTeamName("Mexico", "wc")` continua "México"; `displayTeamName("SE Palmeiras", "bsa")` vira "Palmeiras"; `officialTeamName("SE Palmeiras", "bsa")` é "SE Palmeiras".
- `lib/view/team.test.ts`: atualizar as expectativas de `name` (o teste "returns hue + short" passa a esperar "Palmeiras" e `fullName` "SE Palmeiras"); `teamToTeam("South Korea", "wc").short === "KOR"`; `teamPair` com "Palmeiras" × "Palestino" e "Palestino" × "Palmeiras" (libertadores) mantém PAL no Palmeiras e troca a do Palestino nos dois mandos; `teamPair` sem colisão não mexe em nada.
- Novos casos nas telas da 13c: `lib/view/__tests__/friend-pool.test.ts` (`poolMatchLabel` com "SE Palmeiras" vira "Palmeiras"), `lib/dashboard/__tests__/kpis.test.ts` (rótulo da série), `lib/view/dashboard.test.ts` (linha e detalhe), `app/actions/__tests__/bet-slip.test.ts` e `app/actions/__tests__/user-palpite.test.ts` (a view devolvida usa o nome curto **e** o mock de extração/narração continua recebendo o canônico).
- Atualizar expectativas que dependiam do canônico na tela: `lib/view/__tests__/match.test.tsx`, `lib/view/dashboard.test.ts`, `components/__tests__/desktop-live.test.tsx`, `components/__tests__/predictions-table.test.tsx`, `components/__tests__/odds-card-nway.test.tsx`, `app/p/__tests__/load-shared-palpite.test.ts` (rodar a suíte e ajustar só o que for rótulo de tela; um teste de `lib/ai/**`, `lib/odds/**`, `lib/providers/**` ou `lib/settlement/**` que quebrar é sinal de que o nome curto vazou para um caminho de matching, e o certo é corrigir o código, não o teste).
- Golden `components/__tests__/odds-card-parity.golden.test.tsx`: regenerar com `vitest -u` só se o diff for o nome do time, e revisar à mão.

---

## Linha 14: escudo do time, com as iniciais de reserva

### 14a. Migration e schema

- `db/schema.ts`, tabela `matches` (depois de `neutralVenue`):
  ```ts
  // Escudo de cada time (#578): URL do CDN do provider, gravada pelo sync de fixtures
  // (upsertMatchesFromProvider). Só exibição; null = sem escudo (a UI mostra as iniciais).
  homeTeamCrestUrl: text(),
  awayTeamCrestUrl: text(),
  ```
- Gerar com `pnpm db:generate --name match_team_crests` (não rodar `db:migrate`). Deve sair `db/migrations/0058_match_team_crests.sql` mais `meta/0058_snapshot.json` e a entrada no `_journal.json`. Editar o `.sql` à mão para o padrão do `0052`:
  ```sql
  -- Escudo do time (#578), preenchido pelo sync de fixtures. IF NOT EXISTS: o DB de preview da Vercel é compartilhado entre branches.
  ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "home_team_crest_url" text;--> statement-breakpoint
  ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "away_team_crest_url" text;
  ```
- Numeração conferida em `main` (`7f059b9`): a última é `0057_user_palpite_analyses` (idx 57 no `_journal.json`), então sai `0058`. Nenhum PR aberto traz migration hoje (só o #91, de docs). Se outra branch (#580, ao vivo) mergear uma `0058` antes, apagar os três artefatos desta, rebasear e gerar de novo (nunca editar o snapshot à mão).
- Por que o `IF NOT EXISTS` importa aqui: o `pnpm build` da Vercel roda `drizzle-kit migrate` contra o DB de preview compartilhado. Depois de um renumber no rebase, o preview já tem as colunas da versão antiga e o `ADD COLUMN` puro quebraria o build das outras branches.
- Os testes pglite aplicam `db/migrations` inteiro (`migrate(..., { migrationsFolder: "./db/migrations" })`), então um SQL quebrado aparece no `pnpm test`.

### 14b. Provider: escudo no fixture normalizado

- Novo `lib/providers/sports-data/crest-url.ts`:
  ```ts
  // Aceita só URL https de escudo de TIME nos CDNs dos providers de dados esportivos.
  // Caminho restrito a times: garante que nunca entra logo de liga, de casa de apostas
  // ou outro asset do fornecedor. Qualquer outra coisa vira undefined (a UI cai nas iniciais).
  export function safeCrestUrl(raw: string | null | undefined): string | undefined
  ```
  Regras: string até 300 caracteres; `new URL(raw)` sem lançar; `protocol === "https:"`; sem `username`/`password`, sem `port`, sem `search`, sem `hash`; host **exatamente** `/^media(-\d+)?\.api-sports\.io$/` (`media.api-sports.io` e os `media-N` que a API-Football alterna; nada de "qualquer subdomínio de api-sports.io", que incluiria o host da própria API) com caminho `/^\/football\/teams\/\d+\.png$/`, **ou** host exatamente `crests.football-data.org` com caminho `/^\/[A-Za-z0-9_-]+\.(png|svg)$/`. Devolve `url.href` (normalizado), não a string crua. SVG em `<img>` não executa script, então aceitar `.svg` do football-data.org é seguro.
- `lib/providers/sports-data/types.ts`, `NormalizedFixtureSchema`: `homeCrestUrl: z.url().optional()` e `awayCrestUrl` (aditivo, opcional: o cache de fixtures antigo continua válido). Precisa entrar no schema: `z.object` descarta chave desconhecida, e um parse no caminho do cache apagaria o campo em silêncio.
- **O escudo nunca entra em chave nem em prompt:** `compositeFixtureKey` continua com liga/kickoff/times; os `build-input.ts` dos cartuchos escolhem campo a campo do fixture (`buildFormMatches` em `lib/ai/markets/over_under/build-input.ts:84-115`, conferido: nenhum espalha `...f`), e o hash do JEV/da base do modelo (`lib/ai/judgments/state-hash.ts`, `lib/model-base/build-snapshot.ts:103`) é montado de campos derivados. Como o mesmo normalizador serve H2H e forma, esses fixtures também passam a carregar o escudo, sem efeito no modelo; os testes de `lib/ai/**` ficarem verdes sem mudança é a prova.
- `lib/providers/sports-data/api-football/schemas.ts`, `TeamRefSchema`: `logo: z.string().nullable().optional()`. **Tolerante de propósito:** um `logo` malformado não pode derrubar o parse do fixture inteiro (schema drift vira `Transient` e dispara o cascade). A validação fica no `safeCrestUrl`.
- `api-football/adapter.ts`, `toNormalizedFixture` (`:501-525`): `homeCrestUrl: safeCrestUrl(f.teams.home.logo)`, idem away. Só incluir a chave quando houver valor (`...(home ? { homeCrestUrl: home } : {})`), para não mexer nos `toStrictEqual`/snapshots dos testes de H2H/forma que reaproveitam o mesmo normalizador (o `toEqual` já ignora chave `undefined`).
- `football-data-org/adapter.ts`, `toNormalizedFixture` (`:238-262`): mesmo, com `m.homeTeam.crest` / `m.awayTeam.crest` (o schema do match já usa o `TeamRefSchema` com `crest`, `football-data-org/schemas.ts:10,84-85`). Decisão 6 do dono: grava também.
- Copa: a API-Football devolve o escudo da federação; ele é gravado, mas a view mantém a bandeira com prioridade (14d).

### 14c. Upsert (`lib/db/queries/matches.ts:190-228`)

- Nas `rows`: `homeTeamCrestUrl: f.homeCrestUrl ?? null`, `awayTeamCrestUrl: f.awayCrestUrl ?? null`.
- No `set` do conflito, **sem apagar** o que já existe quando o provider da vez não mandou escudo (fallback sem crest, cache antigo):
  ```ts
  homeTeamCrestUrl: sql`coalesce(excluded.home_team_crest_url, ${matches.homeTeamCrestUrl})`,
  awayTeamCrestUrl: sql`coalesce(excluded.away_team_crest_url, ${matches.awayTeamCrestUrl})`,
  ```
- No `ON CONFLICT DO UPDATE`, `${matches.homeTeamCrestUrl}` referencia a linha existente e `excluded.*` a nova: é o que dá o "nunca apaga". O pglite (14, testes) prova a renderização do Drizzle.
- Escudo velho grudado em time trocado não acontece: o `externalId` (`compositeFixtureKey`) inclui os nomes dos times, então um mata-mata que troca o placeholder pelo time real gera outra linha.
- Nenhum outro escritor de `matches` precisa mudar (conferido: só `upsertMatchesFromProvider` e `db/seed.ts` inserem; ninguém faz `update(matches)`). `db/seed.ts` fica sem escudo (ambiente local e preview sem key mostram as iniciais, que é o caso que precisa estar bonito).

### 14d. View: escudo no `Team`

- `lib/view/match.ts`, `MatchInput`: `homeTeamCrestUrl?: string | null; awayTeamCrestUrl?: string | null`. `toMatchRowView` passa os dois para `teamPair`.
- `teamToTeam(canonical, league, crestUrl?)`: `crestUrl: flagCode ? undefined : crestUrl ?? undefined`. Bandeira da Copa vence o escudo.
- Call sites que montam `MatchInput` campo a campo, mais duas linhas em cada: `app/(app)/jogos/page.tsx:179-189`, `app/(app)/time/[team]/page.tsx:84-94`, `app/(app)/match/[id]/page.tsx:225-235` (`homeTeamCrestUrl: m.homeTeamCrestUrl`, idem away).
- A view **não** revalida a URL (o único escritor já passou por `safeCrestUrl`); o componente só usa `crestUrl` se existir.

### 14e. Componentes: `TeamCrest` e o piso de 11px do `TeamAvatar`

**`components/team-avatar.tsx`** (continua server/puro, usado também pelo `UserAvatar`):
- Recebe a sigla inteira. Nada de `.slice(0, 2)` nos call sites.
- Exportar `monogramFontPx(size: number, chars: number): number | null`: `font = Math.max(11, Math.round(size * 0.36))`; devolve `font` se `chars * font * 0.75 <= size - 6`, senão `null`. O fator 0,75 em é a largura de maiúscula do Geist Sans médio com folga ("MUN", "MCI", "NEW" têm M/W largos; 0,62 subestimava e deixava "MUN" a 12px vazar num círculo de 32px). Com `null` o círculo sai **sem letra** (só a cor; é `aria-hidden` e o nome está ao lado; decisão 2 do dono). Resultados nos tamanhos em uso: 22px com 3 letras → sem letra; 26px com 2 letras (avatar de conta) → 11px; 56px com 3 letras → 20px. Nenhum caminho gera fonte abaixo de 11px.
- O `hue` continua o de hoje (curado ou `hashHue`; decisão 8 do dono).

**Novo `components/team-crest.tsx`** (`"use client"`, porque precisa de `onError`):
```tsx
type Props = { team: Team; size: number; priority?: boolean; className?: string };
```
- Ordem: `flagCode` → `<TeamAvatar flagCode>` (bandeira, como hoje); `crestUrl` sem falha → `<img>`; senão → `<TeamAvatar initials={team.short} hue={team.hue} size={size} />`.
- `<img>` do escudo: `src={team.crestUrl}`, `alt=""`, `aria-hidden="true"`, `width`/`height` = `size`, `loading={priority ? "eager" : "lazy"}`, `decoding="async"`, `referrerPolicy="no-referrer"` (não manda a URL da página ao CDN do provider), `className="inline-block shrink-0 object-contain"`, sem círculo nem borda (o escudo tem forma própria). `// eslint-disable-next-line @next/next/no-img-element -- escudo remoto pequeno; next/image exigiria remotePatterns e gastaria o otimizador`.
- Falha: `useState<string | null>` com o `src` que falhou (mesmo padrão do `UserAvatar`, que reseta se a URL mudar) + `onError`. Como o erro pode acontecer **antes da hidratação** (o evento `error` do `<img>` do HTML do servidor dispara antes de o React anexar o handler e não é reemitido), um `useEffect` com `ref` confere `img.complete && img.naturalWidth === 0` na montagem e marca a falha. Imagem `lazy` ainda não pedida tem `complete === false`, então não é marcada por engano. Estado inicial igual no servidor e no cliente: sem mismatch de hidratação. Até o efeito rodar, a imagem quebrada com `alt=""` não desenha ícone (fica vazia), então não há flash de "imagem quebrada".
- Por que não uma camada só de CSS (monograma por baixo, `<img>` por cima, sem JS): escudo é PNG com fundo transparente, e o círculo colorido apareceria em volta. O componente client é o menor caminho correto.
- `match-row.tsx` é server e `upcoming-matches-desktop.tsx` já é client: os dois podem renderizar `TeamCrest`; `Team` é serializável.
- Trocar nos três call sites: `components/match-row.tsx:89,95` e `components/upcoming-matches-desktop.tsx:73,77` → `<TeamCrest team={m.home} size={22} />`; `components/match-hero.tsx:46` → `<TeamCrest team={team} size={56} priority />` (acima da dobra, não faz sentido `lazy`). Dar `title={team.fullName}` aos nomes truncados de `match-row.tsx:90-92,96-98`.

**OG** (`components/palpites/og-palpite-image.tsx:48-50`): `initialsOf` passa a usar a sigla inteira (3 letras cabem no chip de 96px com fonte 40). Sem escudo no OG nem no cabeçalho da página do time neste PR (decisão 7 do dono). Ajustar `components/palpites/__tests__/og-palpite-image.test.tsx` e o comentário "Iniciais ≤2" da função.

### 14f. CSP (ADR 0040)

- **Política não muda:** `img-src` já tem `https:` nas duas variantes. Não dá para trocar por uma lista de hosts porque o avatar de perfil é URL https arbitrária.
- `lib/security/csp.ts:72-73`: atualizar o comentário da diretiva para registrar o segundo consumidor ("avatar de perfil e escudo de time do provider esportivo: `media.api-sports.io`, `crests.football-data.org`"). Sem ADR nova e sem editar o texto da ADR 0040 (decisão 5 do dono): o registro fica neste comentário, no DESIGN.md e na nota da ADR 0056.
- Outros cabeçalhos não bloqueiam: não há `Cross-Origin-Embedder-Policy` (que exigiria CORP do CDN); o `Referrer-Policy` global é `strict-origin-when-cross-origin` (`next.config.ts:124`) e o `referrerPolicy="no-referrer"` do `<img>` é mais estrito.
- `lib/security/csp.test.tsx`: caso novo "img-src libera escudo de time" que confere `https:` em `img-src` nas variantes com e sem nonce. Quem um dia apertar a política para lista de hosts vê este teste quebrar e lembra dos escudos.
- `next.config.ts`: sem mudança (sem `next/image`).

### Testes da linha 14

- `lib/providers/sports-data/__tests__/crest-url.test.ts` (novo): aceita `https://media.api-sports.io/football/teams/121.png`, `https://media-4.api-sports.io/football/teams/121.png`, `https://crests.football-data.org/1769.png` e `.svg`; recusa `http:`, `javascript:`, `data:`, host fora da lista (`evil.api-sports.io.example.com`, `v3.football.api-sports.io`, `api-sports.io`), userinfo (`https://x@media.api-sports.io/...`), porta, caminho de liga (`/football/leagues/71.png`), caminho de bookmaker (`/football/bookmakers/8.png`), query string, fragmento, string acima de 300, string vazia, `null`, `undefined`.
- `api-football-adapter.test.ts`: fixture com `logo` vira `homeCrestUrl`; `logo` ausente ou inválido não quebra o parse e não cria a chave.
- `football-data-org-adapter.test.ts`: `crest` vira `homeCrestUrl`.
- `lib/db/queries/__tests__/matches.test.ts` (mock): `insertedRows` carrega o escudo; `conflictSet` tem `homeTeamCrestUrl`/`awayTeamCrestUrl`.
- `lib/db/queries/__tests__/upsert-matches-crest.pglite.test.ts` (novo, banco real com as migrations): grava com escudo; regrava o mesmo jogo **sem** escudo e o escudo continua; regrava com escudo novo e ele troca. É a propriedade que o `COALESCE` garante, e só um banco de verdade prova.
- `lib/view/team.test.ts`: `crestUrl` passa; na Copa a bandeira vence o escudo.
- `lib/view/__tests__/match.test.tsx`: `toMatchRowView` com e sem escudo.
- `components/__tests__/team-avatar.test.tsx`: `monogramFontPx` nunca abaixo de 11 para tamanhos de 16 a 64 e 1 a 3 letras; 22px com "PAL" não renderiza texto; 56px com "ATM" renderiza "ATM"; 26px com 2 letras renderiza a 11px; os casos de bandeira continuam.
- `components/__tests__/team-crest.test.tsx` (novo): com `crestUrl` renderiza `<img>` com `loading="lazy"`, `referrerpolicy="no-referrer"`, `alt=""`, `width`/`height`; com `priority`, `loading="eager"`; sem `crestUrl` cai no monograma; com `flagCode` usa a bandeira mesmo havendo `crestUrl`; `onError` troca para o monograma; montagem com uma imagem já `complete` e `naturalWidth === 0` (simulando erro antes da hidratação, via `Object.defineProperty` no protótipo) também cai no monograma; trocar o `crestUrl` depois de uma falha volta a tentar a imagem.
- `lib/security/csp.test.tsx`: o caso de `img-src` (14f).
- `app/privacidade`: `components/__tests__/legal-pages.test.tsx` segue verde; conferir que a frase nova aparece.
- `components/__tests__/preview-ui-a11y.test.tsx` e `user-avatar.test.tsx` seguem passando (o avatar de conta de 26px mantém as 2 letras).

---

## Documentação (commit 1)

- `DESIGN.md:27`: tirar "Known exception: `TeamAvatar` initials…". Acrescentar um parágrafo curto "Times": nome curto de exibição (`teamToTeam(...).name`) em toda tela de usuário, nome oficial só em `title`; sigla de 3 letras (`.short`) onde a coluna é estreita; escudo via `TeamCrest`, com bandeira na Copa e iniciais de reserva; monograma nunca abaixo de 11px (abaixo disso, só a cor); nunca logo de casa de apostas.
- `docs/decisions/0056-…md`: no item 8, uma linha "Encerrada pelo #578: o monograma respeita o piso (sem letra quando não cabe) e o escudo substitui as iniciais." Sem ADR nova (decisão 5 do dono).

## Texto legal (commit 6)

Decisão 4 do dono: uma frase na `/privacidade` e bump do `LAST_UPDATED` (`app/privacidade/page.tsx:20`, hoje "13 de outubro de 2026", vai para a data do merge). O lugar é o parágrafo do fim do item 5 (`page.tsx:178-181`), que hoje diz "Dados de partidas e odds vêm de provedores esportivos […]; nada seu é enviado nessas consultas". Com o escudo, o navegador do usuário passa a falar com o servidor de imagens do provedor, então o parágrafo ganha, depois dessa frase:

> "A exceção são os escudos dos times: seu navegador os carrega direto do servidor de imagens do provedor de dados esportivos, que recebe o endereço IP do seu navegador, mas não a página que você está vendo."

(O "A exceção" evita contradizer o "nada seu é enviado" logo antes.)

Frase sem nome de fornecedor (a lista de operadores do item 5 é de quem trata dado nosso; o CDN só recebe a requisição do navegador). Citar o texto exato na descrição do PR, por ser texto legal (ADR 0047/0048).

---

## Riscos

1. **Nome curto vazar para matching.** `name` muda de semântica. Mitigação: a auditoria acima (nenhum consumidor fora da view), o teste de fronteira, o canônico continua em `matches`, nas rotas e em todo `teams` montado dentro das actions e do `predict.ts`. Se um teste de `lib/ai/**`, `lib/odds/**`, `lib/settlement/**`, `lib/providers/**` ou `lib/user-palpite/**` quebrar, o código está errado, não o teste.
2. **Escudo escuro no tema escuro** (Juventus, Botafogo, Newcastle com preto). Conferir na revisão visual. Se sumirem, um contorno claro só no escuro (`dark:drop-shadow`) resolve sem moldura.
3. **Requisição a terceiro.** O navegador busca o PNG no CDN da API-Sports, que recebe o IP do usuário. `referrerPolicy="no-referrer"` evita mandar a URL da página. Coberto pela frase nova da `/privacidade` (decisão 4).
4. **Limite do CDN da API-Sports.** Imagens não contam na cota diária da API, mas o CDN tem limite por segundo. Com poucos usuários, cache do navegador e `loading="lazy"`, o risco é baixo; se estourar, o `onError` cai nas iniciais e nada quebra.
5. **Backfill depende do próximo sync em produção.** Não há key da API-Football neste ambiente, então nada é preenchido localmente nem no preview: a tela sem escudo (`null`) é o estado que o review visual precisa aprovar. Em produção o cron de 6h preenche a temporada atual (mais até 1 dia de cache do provider). Jogos de temporadas passadas ficam com as iniciais.
6. **Número da migration.** `0058` pode colidir com o #580; regenerar no rebase (14a).
7. **Hidratação.** `TeamCrest` vira client: são até ~100 instâncias na lista. Cada uma é um `useState` e um `useEffect` pequenos; aceitável. A camada só de CSS (monograma por baixo, `<img>` por cima) não serve de reserva, porque o círculo aparece em volta do PNG transparente (14e).
8. **Golden e testes de rótulo.** O nome curto muda texto em vários testes de view. Regenerar só o que for rótulo, no commit que causa a mudança.
9. **Texto do modelo com o nome oficial.** A narração do "Seu palpite" e o racional das análises vêm do modelo, que recebe o canônico; o texto pode dizer "SE Palmeiras" ao lado de um rótulo "Palmeiras". Aceito: mudar isso exigiria mexer em prompt (fora das regras deste PR).
10. **Conflito com as partes 3 e 4 e com o #580.** Os três mexem em `match-row`, `upcoming-matches-desktop`, página do jogo, `/apostas` e desempenho. As mudanças daqui nesses arquivos são de uma ou duas linhas por call site; quem mergear depois rebaseia e reaplica. Se a parte 3 trocar o cabeçalho do jogo, o `TeamCrest` vai junto para o componente novo.

---

## Critério de saída

- `pnpm test && pnpm lint && pnpm typecheck` verdes, `next build` verde (comando do passo 7 da ordem); checks do PR verdes.
- Nenhum **rótulo** de tela de usuário mostra "SE Palmeiras", "SC Corinthians Paulista" ou "Club Atlético de Madrid" (lista, jogo, grade de apostas, "Seu palpite", avaliação do cupom, desempenho com tabela, detalhe e gráfico, Suas apostas, bolão e o select de criar bolão, `/p/[id]`, página do time, classificação). O nome oficial só aparece em `title`. Exceção registrada: texto gerado pelo modelo (Risco 9).
- Atlético de Madrid × Athletic: siglas ATM e ATH no chip de odds da lista; nenhum avatar mostra "AT".
- DevTools nas telas logadas: nenhum `font-size` abaixo de 11px, **sem exceção** (a do `TeamAvatar` acabou).
- Com `crest_url` nulo (estado do preview): lista e cabeçalho do jogo alinhados, círculo sem letra a 22px e sigla de 3 letras a 56px, sem ícone de imagem quebrada.
- Com escudo preenchido à mão (`UPDATE matches SET home_team_crest_url = 'https://media.api-sports.io/football/teams/121.png' WHERE id = …`, de preferência num banco local; se for no DB de preview, que é compartilhado entre branches, voltar para `NULL` no fim): escudo aparece em lista, jogo e página do time; nenhuma violação de CSP no console; URL inválida ou 404 cai nas iniciais.
- Copa: bandeiras inalteradas.
- Nenhum logo de casa de apostas em lugar nenhum (o `safeCrestUrl` só aceita caminho de time).
- `/como-usar` e tour: nenhum alvo `data-tour` muda (`match-row` continua no mesmo elemento); o texto de `/como-usar` ("Palmeiras vence…") já usa nome curto.

---

## Decisões do dono (resolvidas)

Todas fechadas no padrão que o próprio plano recomendava:

1. **Nomes curtos:** a tabela da seção 13a, teto de 18 caracteres ("Bayern", "Atlético-MG", "Inter de Milão", "Marselha", "PSG"). Ajuste de nome no review do PR é troca de string.
2. **Monograma que não cabe:** círculo só com a cor (sem letra) quando a sigla não cabe no piso de 11px; os avatares da lista ficam em 22px.
3. **Migration com as colunas de escudo** em `matches` (não a URL montada pelo id estático).
4. **`/privacidade`:** uma frase sobre o servidor de imagens receber o IP do navegador e bump do `LAST_UPDATED` (seção "Texto legal").
5. **Sem ADR nova:** registro no DESIGN.md, no comentário do `csp.ts` e na nota da ADR 0056.
6. **Escudo do football-data.org também é gravado.**
7. **Sem escudo no OG do `/p/[id]` nem no cabeçalho da página do time** neste PR.
8. **`hue` por time mantido** (curado ou hash).
9. **Sigla repetida entre ligas aceita**; unicidade por liga no teste e desempate por jogo no `teamPair`.

---

### Arquivos críticos para a implementação

- `lib/view/team-labels.ts`, `lib/view/team.ts`, `lib/view/types.ts` (nome, sigla, `teamPair`, `crestUrl`)
- `lib/view/match.ts`, `lib/view/dashboard.ts`, `lib/view/recent-prediction.ts`, `lib/view/friend-pool.ts`, `lib/dashboard/kpis.ts`, `app/p/[id]/opengraph-image.tsx`, `lib/view/__tests__/team-display-boundary.test.ts` (novo)
- `app/actions/bet-slip.ts` e `app/actions/user-palpite.ts` (só a view devolvida; o `teams` que vai ao modelo continua canônico)
- `app/(app)/jogos/page.tsx`, `app/(app)/time/[team]/page.tsx`, `app/(app)/match/[id]/page.tsx`, `app/(app)/apostas/page.tsx`, `app/(app)/bolao/[id]/page.tsx`, `app/(app)/bolao/page.tsx`, `app/p/[id]/page.tsx`, `components/palpites/public-palpite.tsx`
- `components/team-avatar.tsx`, `components/team-crest.tsx` (novo), `components/match-row.tsx`, `components/upcoming-matches-desktop.tsx`, `components/match-hero.tsx`, `components/palpites/og-palpite-image.tsx`
- `db/schema.ts`, `db/migrations/0058_match_team_crests.sql` (gerada), `lib/db/queries/matches.ts`
- `lib/providers/sports-data/crest-url.ts` (novo), `lib/providers/sports-data/types.ts`, `lib/providers/sports-data/api-football/schemas.ts`, `lib/providers/sports-data/api-football/adapter.ts`, `lib/providers/sports-data/football-data-org/adapter.ts`
- `lib/security/csp.ts` (comentário), `lib/security/csp.test.tsx`
- `DESIGN.md`, `docs/decisions/0056-piso-de-11px-mono-so-em-numero-e-vocabulario-de-tela.md`, `app/privacidade/page.tsx` (frase e `LAST_UPDATED`)

---

## Revisão do plano

Revisão adversarial contra o código em `main` (`7f059b9`, partes 1 e 2 mergeadas). Referências `arquivo:linha` conferidas uma a uma; as erradas foram corrigidas no texto (`leagues.ts:45-46`, `api-football/schemas.ts:51-55`, `csp.ts:72-73`).

**Erros corrigidos**

1. **Justificativa falsa do "Seu palpite".** O plano dizia que o `teams` canônico da página do jogo alimentava `analysis-context.ts`/`check-claims.ts` (contexto do modelo) e por isso ficava canônico. Não alimenta: o form do "Seu palpite" só manda `matchId` e o palpite, e as actions (`user-palpite.ts:238,319`) e o `predict.ts:2027` montam `teams` do banco. O `teams` da página é só rótulo. Resultado: o "Seu palpite" entra no escopo (a página passa a usar `displayTeams` em tudo) e o critério de saída fica coerente.
2. **Call sites que faltavam** (todos mostram o canônico ao usuário): `lib/view/friend-pool.ts:65` (`poolMatchLabel`, três telas do bolão), `lib/view/dashboard.ts:343-344` (título do detalhe), `lib/dashboard/kpis.ts:421` (tooltip do gráfico), `app/actions/bet-slip.ts:224-227` (avaliação depois de registrar) e `app/actions/user-palpite.ts:272,427` (análise devolvida). Entraram na tabela da 13c, com testes.
3. **`teamPair` trocava a sigla curada.** "Palestino" (derivado) em casa contra "Palmeiras" fazia o Palmeiras virar PLS. Agora troca o lado derivado; só desempata pelo visitante quando os dois são do mesmo tipo.
4. **`deriveCode` dava siglas que ninguém usa** ("River Plate" RPL, "Boca Juniors" BJU). Agora: 3 primeiras letras do primeiro token (RIV, BOC, RAC, LDU), com inicial + 2 letras só quando o primeiro token é genérico (AMG, IVA, UCA).
5. **Fator de largura do monograma** 0,62 em subestimava maiúscula larga ("MUN" a 12px vazava no círculo de 32px). Subiu para 0,75; nos tamanhos em uso (22, 26, 56) o resultado é o mesmo do plano.
6. **`safeCrestUrl` largo demais:** "`api-sports.io` ou subdomínio" aceitaria o host da própria API. Fechado em `media(-N).api-sports.io` e `crests.football-data.org` exatos, sem userinfo/porta/query/fragmento, devolvendo `url.href`.
7. **Build local:** `pnpm build` roda `drizzle-kit migrate` e falha sem `DATABASE_URL`; o passo 7 agora usa o `next build` direto, como no handoff do #386.

**Conferido e mantido**

- **`name` muda de semântica, sem `displayName` novo.** Auditoria completa na seção "Estado atual": nenhum código fora de `lib/view`, de duas páginas, do OG e de `app/actions/predictions.ts` (só rótulo) lê `Team.name` ou importa o seam; links, `focus` da classificação, chave de fixture, odds, Dixon-Coles, settlement e prompts usam o canônico do banco ou do provider. Um `displayName` obrigaria a mexer nos mesmos leitores sem proteger nada a mais. A proteção vira o teste de fronteira novo.
- **Escudo fora do modelo:** os `build-input.ts` escolhem campos do fixture; o hash do JEV e o fingerprint da base usam campos derivados; `compositeFixtureKey` não muda.
- **Migration:** última em `main` é a `0057`; `0058` está livre; `IF NOT EXISTS` no padrão da `0052`; nenhum PR aberto com migration.
- **`COALESCE` no upsert:** correto para `ON CONFLICT DO UPDATE` (coluna sem `excluded.` é a linha existente); o pglite prova. Único escritor de `matches` além do seed.
- **CSP:** `img-src ... https:` já cobre; sem COEP; teste novo trava a regressão.
- **`TeamCrest`:** client é necessário (`onError`), a checagem `complete && naturalWidth === 0` cobre o erro antes da hidratação, e a alternativa só-CSS não serve para PNG transparente.

**Escopo cortado**

- `teamPair` em `dashboard.ts:358-359`, `match/[id]/page.tsx:135-138` e `predictions.ts:96-99` (só usam `.name`).
- "Subtítulo" com o nome oficial (nenhuma tela pedia).
- Escudo no OG e no cabeçalho da página do time (decisão 7).

**Decisões do dono aplicadas:** as nove, na seção "Decisões do dono (resolvidas)"; a frase da `/privacidade` está escrita na seção "Texto legal".

**Riscos que continuam**

- Texto gerado pelo modelo segue com o nome oficial ao lado de rótulos curtos (Risco 9).
- Conflito de rebase com #576, #577 e #580 nos mesmos componentes (Risco 10) e possível renumeração da `0058`.
- Backfill do escudo só em produção, no próximo sync (até 6h mais 1 dia de cache); preview e local mostram só monograma.
- Contraste de escudo escuro no tema escuro só se confere na revisão visual com escudo preenchido à mão.
- O "sem letra" a 22px deixa a lista sem identificação visual no avatar quando não há escudo (aceito na decisão 2; o nome curto está ao lado).
