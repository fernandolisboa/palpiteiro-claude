# Discovery #407 — Histórico do time: resolução de identidade + shape do #408

> Snapshot 2026-06-20. Aterrado no código real (file:line). Resolve o nó central do #407: **qual string identifica um time** ao linkar de um jogo (hero) e da classificação para uma tela `/time/[team]`, e qual o shape do build #408.

## TL;DR

- **Route key = o nome canônico do time** (= `matches.homeTeam/awayTeam` = `t.team` cru da classificação), **URL-encoded via `encodeURIComponent`, NÃO slugificado**. Não existe team-id no sistema.
- **Hero** é trivial e **imune a mismatch por construção** — link e query saem da mesma row persistida.
- **Classificação** precisa de UMA mudança: threadar o canonical cru (`teamKey: t.team`) pela view, porque hoje só o display traduzido (PT-BR p/ Copa) sobrevive no `StandingsViewRow`.
- A identidade **NÃO é "byte-for-byte incondicional"**: é **provider-acoplada**. Há um modo de falha silencioso por-time sob fallback de provider. Não bloqueia o #408 — vira auditoria não-bloqueante.

## 1. Resolução de identidade (com evidência)

### A string da classificação == a string das fixtures

Ambas passam pela MESMA função `canonicalizeOrPassthrough(name, league)` (fonte única: `lib/providers/sports-data/team-names.ts:133-138`), keyed na MESMA liga:

- **Standings team** (`NormalizedStanding.team`): `canonicalizeOrPassthrough(row.team.name, league)` — `lib/providers/sports-data/api-football/adapter.ts:632` e `lib/providers/sports-data/football-data-org/adapter.ts:332`.
- **Fixtures** (que persistem em `matches.homeTeam/awayTeam`): `canonicalizeOrPassthrough(f.teams.home.name, league)` — `api-football/adapter.ts:474-475`, `football-data-org/adapter.ts:230-231`; persistido verbatim em `lib/db/queries/matches.ts:114-123`.

**Prova de runtime já shippada:** `toStandingsView` compara `t.team === args.homeTeam` com `===` cru — lookups em `lib/view/sections.ts:132-133,135-136` e a flag `focus` em `:167`. Isso só funciona em prod porque as duas strings são idênticas.

### A tradução é DISPLAY-ONLY (não polui identidade)

`displayTeamName(canonicalName, league)` retorna o canonical **inalterado** p/ toda liga ≠ `wc` (`lib/view/team-labels.ts:74`: `if (league !== "wc") return canonicalName`); p/ `wc` retorna rótulo PT-BR (Brazil→Brasil). Aplicada SÓ no campo `team` renderizado (`sections.ts:163`); o `focus` em `:167` mantém o canonical cru. Mesmo padrão em `teamToTeam` (`lib/view/team.ts:159`).

### O wrinkle (não é um map — é um thread)

`StandingsViewRow` (`lib/view/types.ts:237-244`) carrega HOJE só `team: string` (o display traduzido); o canonical cru `t.team` é dropado no mapper. P/ a Copa, `/time/Brasil ≠ matches.homeTeam="Brazil"`. **Fix = adicionar `teamKey: t.team` (canonical cru)** ao lado de `team: displayTeamName(...)` em `sections.ts:161-168`. Pra clubes os dois são iguais (inerte); pra Copa é obrigatório.

### CORREÇÃO de enquadramento: a identidade é PROVIDER-ACOPLADA, não incondicional

A prova `===` é **cosmética** (drive só do highlight `focus`); um miss é silencioso. Logo, código verde NÃO prova que todo time casa — só os que alguém olhou.

O acoplamento real:
- Ambos os providers servem `world_cup` (`api-football/adapter.ts:835-838`, `football-data-org/adapter.ts:482-485`), e o default (`index.ts:45-61`) é primary=api-football + fallback=football-data-org → **`FallbackProvider` está vivo**.
- **Standings são buscadas LIVE no render** (`components/match-sections.tsx:87`, `provider.getStandings`) e nunca persistidas; **fixtures são persistidas por cron separado** (`lib/sync/sync-upcoming-fixtures.ts`). São chamadas independentes, em momentos diferentes, cada uma sujeita a cascade independente.
- O canonicalizer NÃO é robusto a drift arbitrário de spelling: `TEAM_NAME_ALIASES.world_cup` tem só **3 entradas** (`team-names.ts:93-97`: Czechia/Turkey/United States), e nomes não-casados **passam through inalterados** (`team-names.ts:137`). O canonical list usa `"Bosnia & Herzegovina"` e `"Cape Verde Islands"`; spellings plausíveis de outro provider (`Korea Republic`, `DR Congo`, `Cabo Verde`, `Côte d'Ivoire`, `Bosnia and Herzegovina`) passam through SEM casar.

**Consequência:** se durante um fallback o provider B serve standings com spelling X enquanto a fixture persistida usou o canonical do provider A, a row da classificação e a row do jogo carregam strings diferentes → `focus` não destaca E `/time/<standings-key>` não resolve as fixtures daquele time. Falha **silenciosa, por-time**. Não observada hoje só porque em steady state ambas as chamadas batem no primary saudável (mesmo spelling).

**A escolha de route key (string canônica) continua CORRETA** — o problema é completude de canonicalização upstream, não o design da rota. O team-history link só torna **user-visível** (404/tela vazia) um mismatch que antes era um highlight faltando.

## 2. Route key

**Escolhido: o nome canônico das fixtures (= `t.team` / `matches.homeTeam`), URL-encoded via `encodeURIComponent`, NÃO slugificado.**

Rota: `app/time/[team]/page.tsx`, `params: Promise<{ team: string }>`, `const { team } = await params; const name = decodeURIComponent(team);`, query direta contra `matches.homeTeam/awayTeam`.

Por que canonical-name e não slug/id:
- **NÃO há id.** `db/schema.ts:235-236` = `homeTeam: text()`/`awayTeam: text()`; sem teams table, sem coluna team-id. Ids numéricos de provider vivem só transientemente dentro dos adapters (`football-data-org/adapter.ts:333-334`), nunca normalizados/persistidos/surfaced. O nome canônico É a chave de-facto do time em odds/prompts/H2H/settlement (`team-labels.ts:5-8`).
- **Slug rejeitado:** lossy e não-reversível ao canonical exato que o DB guarda → forçaria um map slug→canonical (o exato map que esta discovery existe pra evitar). `encodeURIComponent` round-trips lossless (`lib/view/back-href.ts:24` já usa). Nomes canônicos têm espaços/acentos/barras (`"FK Bodø/Glimt"`, `"São Paulo FC"`), então encoding é obrigatório de qualquer jeito — encode o canonical, não slugifique.

> Nota: NÃO carregar adiante a sugestão de slug do EXPLORE-#3 ("slugify … then resolve back") — contradiz esta seção; o `encodeURIComponent` prevalece.

## 3. Shape do build #408

### `getMatchesByTeam` — nova fn em `lib/db/queries/matches.ts`

Espelha `getMatchesInRange` (template em `:28-52`, mesmo skeleton `db.select().from(matches).where(and(...)).orderBy(...)`). **Adicionar `or` ao import da linha 1** (hoje `and,asc,desc,eq,gte,inArray,lte,sql` — sem `or`).

Assinatura: `getMatchesByTeam(team: string, opts?: { league?: SupportedLeague; pastLimit?: number; futureLimit?: number }): Promise<{ past: DbMatch[]; future: DbMatch[] }>`.

- Filtro de time: `or(eq(matches.homeTeam, team), eq(matches.awayTeam, team))` (string canônica).
- Liga opcional: `eq(matches.league, league)`.
- **DUAS fatias ordenadas, não um range:** PAST = `kickoffAt < now` + `status='finished'` (só finished tem score confiável) + `desc` + `.limit(pastLimit ?? 5)`; FUTURE = `kickoffAt >= now` + `inArray(status,['scheduled','live'])` + `asc` + `.limit(futureLimit ?? 10)`.
- Colunas disponíveis (`db/schema.ts:229-244`): id/externalId/league/homeTeam/awayTeam/kickoffAt/status/homeScore/awayScore/updatedAt — **SEM coluna venue**. Índice só em `kickoffAt` (`matches_kickoff_at_idx`, schema.ts:243); nenhum em homeTeam/awayTeam (ok nos row counts da Copa — índice composto é otimização futura, ver riscos).
- Teste unit espelhando `lib/db/queries/__tests__/matches.test.ts` (padrão mock-builder que assere os operandos drizzle, não pglite).

### Rota — greenfield, não existe `/time`

`app/time/[team]/page.tsx` espelha `app/match/[id]/page.tsx:57-77,186-230` EXATAMENTE: `export const dynamic = "force-dynamic"` (lê cookie tz); `auth()` → `redirect("/signin")`; `getRequestTimeZone()` (`lib/server/request-timezone.ts`); `notFound()` quando AMBAS as fatias vazias; split mobile/desktop `lg:hidden`/`hidden lg:block`, desktop em `DesktopShell`, seções via `SectionLabel`, lista em `Card`. **OBRIGATÓRIO: adicionar `app/time/[team]/loading.tsx` + `error.tsx`** (regra de route-state do CLAUDE.md; nenhum existe).

### Reuso de view — `toMatchRowView` (`lib/view/match.ts:45-78`) pras DUAS fatias

Montar um `MatchInput` por row (mapeamento em `match/[id]/page.tsx:112-122`), passar `timeZone` + `now`. Past/finished: `toMatchRowView` já gate-ia homeScore/awayScore a `status==='finished'` (`match.ts:73-74`) e `formatKickoffRelative` retorna "DD mmm" p/ datas distantes (`format.ts:125`). Future: scores null → renderiza como próximo (`match.ts:59-60,76`). Cada row linka a `/match/[id]?back=<encoded /time/[team] href>` p/ preservar back-param #405/#406 (`resolveBackHref`).

## 4. Ordem das superfícies clicáveis (risco de identidade por ÚLTIMO + isolado)

1. **`getMatchesByTeam` + teste** — tracer-bullet; nada renderiza sem isso.
2. **Rota + view de histórico** (loading/error, tz-threaded, mobile+desktop, empty states) — deep-linkável/testável sozinha via `/time/Brazil`.
3. **HERO linka PRIMEIRO entre as superfícies — TRIVIAL, ZERO risco de identidade.** A página já tem `match.homeTeam`/`match.awayTeam` canônico em `match/[id]/page.tsx:116-117`; wrap os dois nomes do `MatchHero` em `<Link href={/time/${encodeURIComponent(match.homeTeam)}}>`. Hrefs montados em nível de página, passados ao MatchHero — SEM mudança de view-type. **Imune a mismatch por construção:** link key e o `WHERE homeTeam = $name` vêm da MESMA row persistida. Isso sozinho satisfaz a AC "a partir de um jogo, clicar num time abre a tela".
4. **CLASSIFICAÇÃO linka POR ÚLTIMO** — único passo que muda mapper: threadar `teamKey: t.team` (canonical cru) por `toStandingsView` (`sections.ts:161-168`) → `StandingsViewRow` (`types.ts:237-244`) → `StandingsSection` (`components/standings-section.tsx:44-45` wrap `{r.team}` em `<Link href={/time/${encodeURIComponent(r.teamKey)}}>`, ainda EXIBINDO o PT-BR `r.team`). Atualiza golden/snapshot da classificação (view type mudou). Por último p/ um bug de mapping não ser confundido com bug de rota.

## 5. Estados + timezone

- **EmptyState** (`components/empty-state.tsx`) sob cada seção — "Sem jogos agendados." (sem future) / "Sem resultados recentes." (sem past). `notFound()` SÓ quando AMBAS vazias (time só em liga inativa — `ACTIVE_LEAGUES=["world_cup"]`, `active-leagues.ts:14` — não retorna nada).
- **TZ é hard requirement (#409/#410):** chamar `getRequestTimeZone()` uma vez, passar `timeZone` em TODA chamada de `toMatchRowView`; omitir reverte p/ UTC (o bug exato do #409). Helpers `format.ts:103,132,151` aceitam timeZone opcional.
- **Título/header de `/time/[team]`:** exibir o `displayTeamName` (PT-BR p/ Copa) enquanto keia a rota no canonical — mesmo split display/identity de todo lugar.

## 6. #385 NÃO é dependência

`isInProgress` (#385) está `in_progress`, sem refs em lib/components/app. Sequenciar #408 p/ NÃO depender: past=finished, future=scheduled/live via status cru é suficiente. Se #385 landar antes, a fatia future pode aditivamente destacar jogos live.

## 7. Riscos abertos

Ver `openRisks` no output estruturado (auditoria de aliases provider, limits default, índice composto futuro, colisão cross-liga, status da fatia past).
