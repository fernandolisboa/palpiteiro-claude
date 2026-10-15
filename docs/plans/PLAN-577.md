# PLAN-577: listas (linhas 20 a 23 da revisão de design + sobras do bolão)

Rascunho anterior à implementação (ver `docs/plans/README.md`). Parte 4 de 6 da revisão de design. Depende da parte 2 (#575, PR #582), **mergeada**; as partes 1 (#574) e 5 (#578) também estão em `main`. Referências conferidas no código em `2f050fd` (`main`). A parte 3 (#576, página do jogo) está **em andamento na mesma árvore** e o #580 (ao vivo) vem depois: ver "Conflitos" no fim.

Regras herdadas dos PLAN-574/575/578: mudanças de apresentação; nenhum nome, link ou logo de casa de apostas; **não mexer em prompt nem em valores do banco**; vocabulário de tela da ADR 0056 (`lib/view/markets/display.ts`, `lib/view/result-state.ts`); tokens ADR 0029/0056 (piso de 11px, mono só em número com `tabular-nums`, zero `text-[Npx]`, `muted-fg-2` só ≥12px; guardas em `components/__tests__/design-scale-guard.test.ts`); `ResultBadge` para resultado; `PageHeader`/`PageContainer` (guarda `__tests__/page-header-coverage.test.ts`); nome curto/sigla/escudo via `lib/view/team.ts` (#578); alvos `data-tour` (`lib/tour/steps.ts`) e rótulos de `/como-usar` sempre consistentes com a tela.

**Fora de escopo e intocável neste PR** (o PR 3 está editando agora; lista conferida no `git diff origin/main..HEAD` da branch dele): `app/(app)/match/[id]/**`, `components/bet-slip.tsx`, `components/bet-slip-bridge.tsx`, `components/bet-slip-section.tsx`, `components/palpites/**`, `components/seu-palpite.tsx`, `components/seu-palpite-section.tsx`, `components/full-analysis.tsx`, `components/market-analysis-section.tsx`, `components/previous-analyses.tsx`, `components/match-odds-cards.tsx`, `components/match-hero.tsx`, `components/back-link.tsx`, `lib/view/match-availability.ts`, `lib/view/bet-slip.ts` (view do cupom), `lib/user-palpite/**` e `components/tour/guided-tour.tsx`. Nada aqui precisa mudar neles; `lib/view/bet-slip.ts` (`slipLegLabel`) e `lib/view/match-availability.ts` (via `poolBetsOpen`) são só **importados**.

**Arquivos que os dois PRs editam** (conflito de rebase esperado, trechos diferentes): `lib/tour/steps.ts` (o PR 3 muda o passo `palpite`; aqui só o passo "Período"), `app/(app)/como-usar/como-usar-content.tsx` e o teste dele (o PR 3 troca "ver análise por mercado" por "Ler análise completa" e mexe na lista de rótulos), `DESIGN.md` (o PR 3 reescreve o parágrafo "Layout & motion"). Quem mergear depois rebaseia e confere.

---

## Estado verificado (o que já está em `main`)

- **Bolão, coluna ✓ vazia: já resolvida pelo #575.** O commit `7f059b9` tirou o `<span className="w-5 shrink-0">` com ✓/✗ que ficava antes do nome e trocou por `{hit !== null && <ResultBadge …/>}` depois da aposta (`app/(app)/bolao/[id]/page.tsx:158`). Em bolão aberto `hit` é `null` e nada é renderizado. Nada a fazer aqui (ver Bolão).
- `/apostas` já se chama "Suas apostas", usa `PageHeader` e `ResultBadge` (`app/(app)/apostas/page.tsx:73-76,186-194`). Falta resumo, filtro, status único, detalhe enxuto e identificar a combinada. **Não tem `loading.tsx` nem `error.tsx`** (o CLAUDE.md pede os dois; é a única rota de `app/(app)/` de usuário sem eles).
- O rótulo da perna em `/apostas` é `betLegLabel` (`lib/view/free-bet.ts:20`), **sem time**: "Vitória do mandante", "Os dois times marcam". O cupom usa `slipLegLabel(kind, params, teams)` (`lib/view/bet-slip.ts:77-98`): "Vitória do Palmeiras", "Ambas marcam: sim". O PLAN-578 deixou o `betLegLabel` de `/apostas` para este PR.
- Liquidação de perna só grava `won`/`lost` (`lib/db/queries/user-bets.ts:111-116`; não há caminho de override de `bet_leg_outcomes` no código). O enum aceita `void`/`push`, mas hoje não aparecem; `deriveSlipStatus` os trataria como `pendente`. Jogo cancelado/adiado **nunca** liquida (`settle-user-bets` só liquida com placar de 90'), então a perna fica `pendente` para sempre.
- No cupom, a stake da simples fica na **perna** (`app/actions/bet-slip.ts:188-196`, `slip.stakeUnits = null`) e a da combinada no **slip** (`:199-208`, perna com `stakeUnits = null`); combinada exige 2+ pernas (`lib/bets/slip-schema.ts:88`). Slips da aposta em texto antiga: `mode = null`, sem stake.
- Fuso no servidor: `getRequestTimeZone()` (`lib/server/request-timezone.ts`) lê o cookie `tz`, que o `<TimezoneSync>` (`components/timezone-sync.tsx`) grava no navegador; sem cookie (primeira visita) ou inválido cai em `DEFAULT_TIME_ZONE` (**BRT**, não UTC), e o `TimezoneSync` dá refresh quando o fuso do navegador é outro. O "fuso do runtime" (UTC na Vercel) só morde quem chama um formatador **sem** `timeZone`.
- `/dashboard`: filtro de status com as palavras do selo (#575, `dashboard-filters.tsx:44-55`), linha da tabela truncada (#574), eixo do gráfico sem data repetida (#574, `lib/view/chart-ticks.ts`). Falta tudo da linha 21. `app/(app)/dashboard/loading.tsx` desenha 4 cartões de KPI + gráfico + tabela (muda junto). A página **não tem** nenhuma frase de "passado não garante futuro" (hoje só nos Termos §4, `app/termos/page.tsx:108`: "Desempenho passado não garante desempenho futuro."), embora a ADR 0048 D4 peça "desempenho só como histórico verificável e com 'passado não garante futuro'".
- `KpiCards` mostra retorno, taxa de acerto, jogos sem aposta e lucro total, cada um com `n=` (`kpi-cards.tsx:63-125`); `profitPositive` é `>= 0` (zero sai verde). "D9" aparece em três textos de `market-segments.tsx`: `:24`, `:157` (vazio: "a régua D9 e o retorno por banda…") e `:179`.
- **CLV "da mesma cor":** o tom por sinal existe (`market-segments.tsx:66-70`), mas `view.lowSample ? "text-warn-fg" : tone` (`:76`) pinta todo CLV de amostra pequena de âmbar, então positivo e negativo saem iguais. O sinal já vem escrito (`formatClvValue` → `formatEdge`, "+7,7%"/"-2,1 pp", `lib/view/dashboard.ts:73-76`).
- **Tabela do desempenho:** `toPredictionRowView` usa `row.createdAt` na coluna data (`lib/view/dashboard.ts:202`); `DashboardRow` já traz `kickoffAt` (`lib/db/queries/dashboard.ts:105`, `lib/dashboard/kpis.ts:48`). Sem paginação: `deriveDashboardView` devolve todas as linhas (`derive-view.ts:141-143`).
- `/jogos`: dois subárvores (`lg:hidden` / `hidden lg:block`, `jogos/page.tsx:235-252`); o período aparece no `meta` do `PageHeader` (`:296`, `:385`), no `SectionLabel` (`:318`, só celular) e na aba ativa. O horário vem de `formatKickoffRelative` (`lib/format.ts:131-154`: "em 16h 09min" / "amanhã, 19:00" / "sáb, 08:30" / "18 out"). Linha do modelo em `font-mono text-meta` (`components/match-model-line.tsx:19`). Odds empilhadas em `flex-col` (`match-row.tsx:144-151`, `upcoming-matches-desktop.tsx:331-373`). Coluna Status no desktop (`components/desktop-status-cell.tsx`). "Suas predições recentes" = 5 predições (`RECENT_LIMIT`, `jogos/page.tsx:57`), um cartão por mercado (`getRecentPredictionsByUser`, `lib/db/queries/predictions.ts:363-390`).
- **`MatchRow` também é usado por `/time/[team]`** (`app/(app)/time/[team]/page.tsx:169`), que não agrupa por dia e precisa continuar mostrando a data na linha.
- `countdown` (`formatCountdown`, <24h no mesmo dia) alimenta só o `match-hero` (PR 3). Não muda.
- `components/ui/sheet.tsx` tem `side="bottom"`; `components/ui/popover.tsx` existe. O tour rola o alvo com `scrollIntoView` sem `inline`, o que também rola um contêiner horizontal até o alvo (`guided-tour.tsx:207`).

---

## Divisão em PRs

Dois PRs, na ordem abaixo. Os dois não dependem um do outro em código além dos formatadores do commit 1 e do `FilterChipLink` (commit 3).

- **PR A — "Suas apostas, Desempenho e bolão" (linhas 20, 21 e sobras do bolão).** Não toca a lista de jogos; conflito só com o #580 se ele mexer no bolão.
- **PR B — "Lista de jogos" (linhas 22 e 23).** Mexe em `match-row`, `upcoming-matches-*`, filtros e `/como-usar`/tour. É o que o #580 vai estender: entra antes dele.

Motivo: a lista é o ponto de conflito (PR 3 regenera o golden `odds-card-parity`, #580 adiciona estado ao vivo nas linhas); isolar deixa o PR A mergear sem esperar.

---

## Formatadores compartilhados (commit 1, PR A)

`lib/format.ts` (puro, já tem `partsOf`/`weekdayOf`/`isSameDay`/`isNextDay`/`hhmm`):
- `formatTimeOfDay(d, timeZone?) → "19:00"`.
- `dayKeyOf(d, timeZone?) → "2026-10-18"` (data civil no fuso do usuário; chave de grupo).
- `formatDayHeading(d, now, timeZone?) → "Hoje" | "Amanhã" | "Ontem" | "Sábado 18/10"` (dia da semana por extenso sem "-feira": Domingo, Segunda, Terça, Quarta, Quinta, Sexta, Sábado; ano só quando difere do de `now`: "Sábado 18/10/2025"). Hoje/Amanhã/Ontem comparam a **data civil** no fuso (`partsOf` + `isSameDay`/`isNextDay`, que já usam `Date.UTC` sobre as partes), nunca `now ± 24h`: dia de 23h/25h na troca de horário não quebra.
- `formatStartsIn(d, now, windowMs = 3h) → "em 2h 15min" | "em 40min" | undefined` (só com `0 < delta ≤ windowMs`; reaproveita a conta de `formatKickoffRelative`).
- Constante `COUNTDOWN_WINDOW_MS = 3 * 60 * 60 * 1000` exportada de `lib/format.ts`. **Não reaproveitar** `IN_PROGRESS_WINDOW_MS` (`lib/view/date-range.ts:35`): é outra coisa (cauda de jogo apitado); coincidir em 3h é acaso.

Testes: `lib/format.test.ts` (existente): virada de dia no fuso (`America/Sao_Paulo` 23:30 vs UTC), "Ontem", ano diferente, `formatStartsIn` nas bordas (3h exatas entra, 3h01 não, passado não). São Paulo não tem horário de verão desde 2019, então um caso em `Europe/London` na volta do horário (25/10/2026): `now` 24/10 23:00 local e jogo 25/10 00:30 → "Amanhã"; `dayKeyOf` de 00:30 e 23:30 de 25/10 dá a mesma chave.

O countdown é calculado no render do servidor (a página é `force-dynamic`, sem relógio no cliente): com a aba aberta ele envelhece, como já acontece com o "em 16h 09min" de hoje. Aceito.

---

## Linha 20: Suas apostas (`/apostas`)

### Desenho
```
Suas apostas
Registradas por você. Privado, só você vê.

┌ resumo ─────────────────────────────────────────┐
│ EM ABERTO   ACERTOS        SALDO                │
│ 3           4 de 7         +2,35 u              │
│ apostas sem stake não entram no saldo           │  (meta, só se houver)
└─────────────────────────────────────────────────┘
[ Em aberto ] [ Encerradas ]                      ← links (?status=), sem contagem

┌ COMBINADA · 2 SELEÇÕES                 Em aberto ┐
│ Palmeiras × Flamengo                             │
│ Brasileirão · hoje, 19:00                        │
│ odd 4,26 · stake 0,5u                            │
├──────────────────────────────────────────────────┤
│ Ambas marcam: sim                 [Em aberto]    │
│ odd 1,85 · chance 47,8%                          │
│ ▸ detalhes                                        │
│ Vitória do Palmeiras              [Em aberto]    │
│ odd 2,30 · chance 41,3%                          │
│ ▸ detalhes                                        │
└──────────────────────────────────────────────────┘
┌ Arsenal × Tottenham                      Acertou ┐
│ Premier League · sáb, 17 out                     │
├──────────────────────────────────────────────────┤
│ Mais de 2,5 gols                                 │   ← sem selo na perna (simples)
│ odd 1,88 · stake 1u · chance 49,2%               │
│ ▸ detalhes                                        │
└──────────────────────────────────────────────────┘
```

### Dados (novo, sem migration)
`lib/db/queries/user-bets.ts`:
- `getUserBetSlipLedger(userId, now = new Date()): Promise<SlipLedgerRow[]>`: uma query `bet_slips ⨝ matches ⨝ bet_legs ⟕ bet_leg_outcomes` filtrada por `userId` (sempre do `auth()`), só colunas enxutas: `slip.id, slip.mode, slip.stakeUnits, slip.comboUserOdd, matches.status, matches.kickoffAt, leg.settleable, leg.userOdd, leg.stakeUnits, outcome.result`. Agrupada em memória como `getUserBetSlipsForMatch` (`:207-229`). Cada linha sai com `matchStatus` e `matchOver: boolean` = `status ∈ {finished, cancelled}` **ou** `kickoffAt < now − SETTLEMENT_MIN_ELAPSED_MS` (a constante já é importada em `user-bets.ts:12`; a conta fica na query para o módulo puro não importar `lib/db`). O `kickoffAt` cobre o jogo cujo status o cron ainda não virou (ou nunca vira): sem ele, uma não conferida ficaria "Em aberto" para sempre. Usa o índice `bet_slips_user_id_created_at_idx` + `bet_legs_slip_id_idx`.
- `getUserBetSlipsPage` ganha `slipIds?: readonly string[]` opcional: quando presente, `inArray(betSlips.id, slipIds)` entra no `and(...)` (`:310-323`); lista vazia → `{ slips: [], nextCursor: null }` sem ir ao banco. O keyset `(createdAt, id)` não muda, então o cursor vale dentro do recorte (um slip que muda de recorte entre duas páginas só aparece na outra lista; nada duplica). `BetSlipMatch` (`:250-255`) ganha `status` (mais uma coluna no select de `:302-307`) para o cartão do jogo cancelado.

Novo `lib/bets/slip-ledger.ts` (puro, ao lado de `evaluate-slip.ts`; **não** em `lib/view/bet-slip.ts`, que o PR 3 está editando):
- `slipBucket(slip): "open" | "closed"` em cima de `deriveSlipStatus` (fonte única da derivação, `user-bets.ts:240-248`): `acertou`/`errou` → closed; `pendente` → open, **exceto** `matchStatus === "cancelled"` (nunca liquida) → closed; `nao_conferida` → closed quando `matchOver`, senão open. Adiado (`postponed`) com `pendente` fica open (o jogo ainda pode ser jogado). Pendente de jogo já encerrado e ainda não liquidado fica open até o cron liquidar (é o certo: não tem resultado).
- `slipProfitUnits(slip): number | null`: só `acertou`/`errou`. Simples (`mode === "simples"` ou 1 perna): stake/odd da perna (`leg.stakeUnits`, `leg.userOdd`). Combinada: `slip.stakeUnits` × `slip.comboUserOdd`. Ganhou: `stake × (odd − 1)`; errou: `−stake`. Sem stake ou sem odd → `null` (fica fora do saldo; slips da aposta em texto anteriores ao cupom). Soma arredondada a 2 casas no fim (não por slip).
- `summarizeSlipLedger(rows) → { open, closed, won, lost, settledWithStake, settledWithoutStake, balanceUnits, openIds, closedIds }`. A ordem dos ids não importa (a página ordena no SQL).

### Página (`app/(app)/apostas/page.tsx`)
- `searchParams: { cursor?, status? }`. `status` aceita `abertas` | `encerradas` (valores em português, curtos; recomendado, ver Q2). Sem `status`: `abertas` se `open > 0`, senão `encerradas`. Valor inválido cai no padrão. `?cursor=` antigo sem `status` continua funcionando (cai no padrão e o keyset vale).
- `Promise.all([getUserBetSlipLedger(userId, now), getRequestTimeZone()])` (um `now` só no request), depois `summarizeSlipLedger`, depois `getUserBetSlipsPage({ userId, cursor, slipIds: bucket === "abertas" ? openIds : closedIds })`. São 3 idas ao banco (hoje 2); aceito na escala de amigos (ver Riscos).
- Novo `components/bets/slips-summary.tsx` (server): três números (`text-display-xs`, mono `tabular-nums`): "em aberto" (contagem), "acertos" ("4 de 7" = `won` de `won + lost`, sem %, ver Q3), "saldo" (`formatUnitsSigned`: "+2,35 u" / "-1,00 u", o mesmo formato do saldo do Desempenho; `formatUnitsCompact` **não** escreve o "+"; cor por sinal, ver Q4). Sem `won + lost`, "acertos" mostra "—". Linha `text-meta` só quando `settledWithoutStake > 0`: "apostas sem stake não entram no saldo". (Sai o "{closed} encerradas · …": repetia contagem.)
- Filtro: novo `components/bets/slip-filter.tsx` (server, dois `Link` com `aria-current="page"`), com o chip de `components/filter-chip.tsx` (novo neste PR: `FilterChipLink`, `h-8 rounded-full px-3 text-body-sm`, ativo `bg-card text-foreground shadow-sm border-border`; o PR B reaproveita nos chips de período). Rótulos **literais** no `.tsx`: "Em aberto" e "Encerradas" (o teste do `/como-usar` só varre `.tsx`; `RESULT_LABEL` mora num `.ts`). **Sem contagem no chip:** o "em aberto" já está no resumo logo acima (um número num lugar só). `href` = `/apostas?status=…` (sem cursor).
- Paginação: os links "apostas mais antigas →" e "← voltar ao topo" (`:97-116`) passam a carregar `status` (o "voltar ao topo" vira `/apostas?status=…`).
- Vazio por recorte: "Nenhuma aposta em aberto." / "Nenhuma aposta encerrada ainda." (o `EmptyState` atual fica para o zero absoluto, `ledger.length === 0`, e aí não renderiza resumo nem filtro).
- Aviso §3 (`:118-120`) **fica**, uma vez (ADR 0048 D4 como atualizada pela ADR 0053; ADR 0057 item 6, na branch do PR 3: "o §3 uma vez onde se registra ou lista aposta").

### Cartão (`SlipCard`, mesmo arquivo; extrair para `components/bets/slip-card.tsx`)
- Combinada (`slip.legs.length >= 2`): eyebrow sans no topo "Combinada · N seleções" (`text-meta uppercase tracking-label`), e a linha "odd 4,26 · stake 0,5u" logo abaixo do cabeçalho (mono nos números). Somem as duas faixas de rodapé "seu stake na combinada" / "odd da combinada" (`:161-181`). Simples: sem eyebrow.
- Status **uma vez**: selo do slip no cabeçalho (como hoje). Perna de simples: **sem** selo (era o duplicado "Pendente"/"pendente"). Perna de combinada: mantém o `ResultBadge` por perna (mostra qual perna caiu); perna não conferível mantém "não conferimos".
- Jogo cancelado com slip `pendente` (vai para "Encerradas"): selo neutro `Badge variant="outline"` "Jogo cancelado" no lugar do "Em aberto" (senão a lista de encerradas mostraria "Em aberto"). Não é resultado nem "Anulada" (o app não sabe o que a casa do usuário fez); fica fora do saldo.
- Rótulo da perna: `slipLegLabel(leg.kind, leg.params, { home: teams.home, away: teams.away })` (só import de `lib/view/bet-slip.ts`, o mesmo rótulo com que a aposta foi registrada no cupom: "Vitória do Palmeiras", "Ambas marcam: sim"), no lugar do `betLegLabel` sem time. Se o PR 3 mover a função, ajustar o import no rebase.
- Detalhe enxuto: novo `historyLegView(leg)` em `lib/bets/slip-ledger.ts` (ou `lib/view/slip-history.ts`, puro) → `{ visible: string[]; details: string[] }`. Visível: `odd 1,85`, `stake 0,5u` (só simples; na combinada o stake é do slip), `chance 47,8%`. Detalhes: `retorno esperado`, `vantagem do modelo`, `sugerido`, fonte (Dixon-Coles/modelo simplificado/sua análise). Mesmos formatadores e regras de `historyLegSummary` (`lib/view/bet-slip.ts:421-450`), que **não é editado** (PR 3 mexe no arquivo); vira código morto em `/apostas` e sai num commit de limpeza depois do rebase sobre o PR 3 (ou fica, se o PR 3 passar a usá-lo; conferir no rebase).
- "detalhes" = `<details>` nativo (server, sem JS), `summary` em `text-meta text-muted-foreground`, conteúdo mono `text-meta` com `tabular-nums`. Sem detalhes (perna sem chance) → sem `<details>`.
- `teams` continua `displayMatchTeams` (nome curto, #578).

### Estados de rota
- `app/(app)/apostas/loading.tsx` (novo): `PageContainer width="reading"` + `PageHeaderSkeleton title="Suas apostas" description` + três `Skeleton` do resumo + dois cartões.
- `app/(app)/apostas/error.tsx` (novo): copiar `app/(app)/bolao/error.tsx` trocando o texto.

### Testes
- `lib/bets/__tests__/slip-ledger.test.ts` (novo): tabela de `slipBucket` (acertou, errou, pendente, pendente adiado → open, pendente com jogo cancelado → closed, não conferida com `matchOver` false/true, combinada com perna não conferível que perdeu → errou/closed); `slipProfitUnits` (simples ganha/perde, combinada ganha/perde com a stake no slip, sem stake → null, `mode = null` antigo → null, não conferida → null); `summarizeSlipLedger` (contagens, saldo arredondado, `settledWithoutStake`); `historyLegView` (simples vs combinada, perna sem chance).
- `lib/db/queries/__tests__/user-bet-slips-page.pglite.test.ts` (existente): casos novos para `slipIds` (recorte + cursor dentro do recorte, lista vazia sem query) e para `getUserBetSlipLedger` (perna sem outcome vem com `result: null`; `matchOver` por status e por `kickoffAt` antigo com status `scheduled`; não vaza slip de outro usuário); `match.status` no `getUserBetSlipsPage`.
- `components/bets/__tests__/slip-card.test.tsx` (novo, `renderToStaticMarkup` do `SlipCard` extraído; fora de `app/` porque o componente mora em `components/bets/`): simples tem 1 selo só; combinada tem o eyebrow "Combinada · 2 seleções" no topo e não tem "seu stake na combinada"; "detalhes" contém "vantagem do modelo" e a linha visível não; perna 1X2 diz "Vitória do" + nome curto; jogo cancelado pendente mostra "Jogo cancelado" e não "Em aberto".
- `components/bets/__tests__/slips-summary.test.tsx` (novo): "+2,35 u" com `text-edge-fg`, negativo `text-destructive`, zero neutro; "—" sem liquidadas; a linha "sem stake" só com `settledWithoutStake > 0`.
- `__tests__/page-header-coverage.test.ts` segue verde (o h1 continua no `PageHeader`).

### Riscos
- `inArray` com a lista inteira de ids do recorte: um parâmetro por id; ok para centenas/poucos milhares de slips por usuário (app de amigos; o teto do Postgres é 65.535 parâmetros). Acima disso, trocar por predicado SQL com `EXISTS` espelhando `slipBucket` (anotado no código). Alternativa mais simples se o ledger crescer em colunas: buscar tudo numa query só e paginar em memória; não vale agora.
- O ledger lê todos os slips do usuário a cada visita. Mesmo argumento; uma query só, colunas enxutas.
- "Acertos" e saldo em tela privada: são o histórico do **próprio usuário** (as apostas dele), não desempenho do app, e não são marketing (ADR 0048 D4: "sem '% de acerto'/ROI de marketing"). O §3 já está na tela; não entra a frase de "passado não garante futuro" aqui (um aviso por tela, ADR 0057 item 6). Nada disso vai para `/p` nem OG (ADR 0036 §13).

---

## Linha 21: Desempenho (`/dashboard`)

### Desenho (de cima para baixo)
1. `PageHeader` (igual).
2. Filtros liga e mercado (igual, `DashboardFiltersBar dimensions={["league","market"]}`).
3. **Resumo** (novo `components/dashboard/summary-cards.tsx`, server): três cartões `grid-cols-1 sm:grid-cols-3`: **retorno** (`kpis.yieldPct.value`, cor por sinal), **taxa de acerto** (`kpis.winRate.value`, neutro), **saldo** (`kpis.totalProfit`, cor por sinal; rótulo era "lucro total"). A cor sai de um campo novo da view, não do texto: `DashboardKpiView` ganha `yieldTone` e `profitTone: "positive" | "negative" | "zero"` (em `toDashboardKpiView`, `lib/view/dashboard.ts:89`; yield sem amostra → `"zero"`, "—" neutro). `profitPositive` fica (o `KpiCards` do admin usa). O sinal vai escrito no retorno também ("+5,2%"): `formatPct` escreve o "-" mas não o "+" (`lib/format-number.ts:31-39`), então a view ganha `yieldSigned` (`formatClvValue(kpis.yield.value, "%")`, o mesmo de `:73-76`; "—" sem amostra), usado **só no resumo**; o `yieldPct` atual fica para o `KpiCards`/segmentos. Sob cada número, sans `text-body-sm`: "em {settled} apostas liquidadas" e, com `lowSample`, "amostra pequena" em `text-warn-fg` com o `HelpHint` atual (`kpi-cards.tsx:20-24`). **Sem `n=`.** Mesmos `HelpHint` de retorno/taxa de acerto/saldo (copiar os blurbs de `kpi-cards.tsx:72-101`, trocando "lucro total" por "saldo"). Uma linha `text-meta` sob os cartões: **"Desempenho passado não garante desempenho futuro."** (a frase dos Termos §4, `app/termos/page.tsx:108`, que cumpre o "passado não garante futuro" da ADR 0048 D4; ver Q6). Constante local no componente, com teste.
4. **Gráfico** logo abaixo: a seção de `page.tsx:104-114` sobe para cá; rótulo "bankroll hipotético (u)" → "saldo hipotético (u)". O admin (`admin/users/[userId]/page.tsx:121-123`) fica com o rótulo dele.
5. **Detalhe técnico** (fechado por padrão): `MatchCollapsible` (`components/match-collapsible.tsx`, reaproveitado sem editar) com `title="Detalhe técnico"` e **sem `meta`** (o `meta` do componente é `font-mono`, `match-collapsible.tsx:37`; texto em mono quebra a ADR 0056 item 2). A explicação ("CLV, amostra e graduação por mercado") vai como primeira linha sans `text-body-sm text-muted-foreground` dentro. Dentro: `KpiCards` com **`variant="technical"`** (novo, padrão `"full"`): só o cartão "jogos sem aposta" (com `n=`) e a linha de contagens (`:117-123`); retorno, taxa de acerto e lucro **não** se repetem (já estão no resumo, a mesma tela não mostra o mesmo número duas vezes). Depois `MarketSegments`. O admin (`app/(app)/admin/users/[userId]/page.tsx:117-119`) continua com `KpiCards` `"full"` e tudo aberto.
6. **Tabela** com o filtro de status (igual) e paginação.

`app/(app)/dashboard/loading.tsx`: três cartões (`grid-cols-1 sm:grid-cols-3`) no lugar dos quatro, gráfico, uma faixa do "Detalhe técnico" fechado (`h-12`) e a tabela.

### CLV com cor por sinal (`components/dashboard/market-segments.tsx`)
- `ClvMetric` (`:59-87`): cor **sempre** pelo sinal (`+` → `text-edge-fg`, `-` → `text-destructive`, resto `text-muted-foreground`). `lowSample` deixa de mudar a cor e vira texto no rótulo: "razão de odds · n=4 · amostra pequena" (`text-warn-fg` só nas palavras "amostra pequena").
- O sinal já é escrito por `formatEdge`; acrescentar teste que o positivo leva "+".
- Cabeçalho da seção "por mercado — régua D9 + banda de stake" (`:179`) → "por mercado"; "graduação D9" (`:24`) → "graduação"; o vazio "a régua D9 e o retorno por banda aparecem…" (`:157`) → "a graduação e o retorno por banda aparecem…". Ficam dentro do detalhe técnico; CLV e no-vig continuam com os nomes técnicos ali, como a issue pede. Vale para o admin também (componente compartilhado, ADR 0056 item 7).

### Tabela: data do jogo e paginação
- `lib/view/dashboard.ts:202`: `when: formatKickoffAbsolute(row.kickoffAt, now, timeZone)` ("hoje, 19:00" / "sáb, 18 out"). O cabeçalho "data" (`predictions-table.tsx:52`) fica e passa a ser a data do jogo (Q7). `toPredictionRowView` é compartilhado com o admin: a tabela do admin também passa a mostrar a data do jogo (aceitável; o detalhe da predição mostra as duas).
- Ordem: `deriveDashboardView` ordena `tableRows` por `kickoffAt desc`, desempate `createdAt desc` (hoje é a ordem de inserção do `Map` do dedup, que segue `createdAt desc`). Vale para o admin também.
- Paginação só na página do usuário, pura e fora do `deriveDashboardView` (o admin continua vendo tudo): novo `lib/view/paginate.ts` → `paginate<T>(items, rawPage: string | undefined, pageSize = 25) → { items, page, pageCount, total }` (página inválida/menor que 1 → 1; maior que o total → última).
- `searchParams` do `/dashboard` ganha `page`. `currentDashboardHref(filters, basePath, page?)` (`dashboard-filters.tsx:17-27`): `page` só entra na URL quando > 1. `buildDashboardHref` (troca de filtro, inclusive o de status junto da tabela) **não** carrega `page` (volta para a 1). O `listHref` passado à tabela leva a página atual (voltar do detalhe cai na mesma página: `resolveBackHref`, `lib/view/back-href.ts`, aceita qualquer query sob `/dashboard`, conferido). A paginação corta `tableRows` **depois** do filtro de status (`applyTableFilters`, `derive-view.ts:141`), então "Página N de M" é do recorte.
- Novo `components/dashboard/table-pagination.tsx` (server): "← mais recentes · Página 2 de 4 · mais antigas →", links com `aria-label`, oculto com `pageCount === 1`. Meta acima da tabela: "{total} análises".

### Testes
- `lib/view/__tests__/paginate.test.ts` (novo): bordas (vazio, página 0/NaN/"abc", última, além da última).
- `lib/view/dashboard.test.ts`: `when` usa `kickoffAt` (fixture com `createdAt` e `kickoffAt` em dias diferentes).
- `lib/dashboard/__tests__/derive-view.test.ts`: ordem por `kickoffAt desc` com desempate.
- `components/__tests__/dashboard-filters.test.ts`: `currentDashboardHref` com `page` (omitido na 1, presente na 2) e `buildDashboardHref` zera `page`.
- `components/__tests__/market-segments.test.tsx`: CLV positivo com amostra pequena sai `text-edge-fg` e com "+"; negativo sai `text-destructive`; "amostra pequena" escrito.
- `components/__tests__/summary-cards.test.tsx` (novo): três rótulos (retorno, taxa de acerto, saldo), nenhum `n=`, "amostra pequena" quando `lowSample`, cor por `profitTone`/`yieldTone` (zero neutro), e a frase "Desempenho passado não garante desempenho futuro." presente.
- `components/__tests__/kpi-cards.test.tsx` (novo; não há teste do `KpiCards` hoje): `variant="technical"` não tem "retorno" nem "lucro total"; `"full"` (padrão, admin) igual a hoje.
- `lib/view/dashboard.test.ts`: `yieldTone`/`profitTone` (positivo, negativo, zero, sem amostra).

### Riscos
- O admin herda a data do jogo e a nova ordem na tabela (componente compartilhado; ADR 0056 item 7 já aceita isso).
- `MatchCollapsible` é client; o PR 3 não o edita (não está no diff da branch dele), só o usa; reaproveitar sem tocar. Se o PR 3 renomear/mover, ajustar o import no rebase. `KpiCards` e `MarketSegments` são server e entram como `children` do client: sem problema.

---

## Bolão (sobras)

Arquivos: `app/(app)/bolao/page.tsx`, `app/(app)/bolao/[id]/page.tsx`, `lib/view/friend-pool.ts`.

1. **Coluna ✓ vazia:** já resolvida (#575). **Nada a fazer** (cortado na revisão: extrair a `<ul>` só para um teste de regressão puxaria o `form action={removeFriendPoolEntry}`, uma server action com banco, para o teste; o ganho não paga).
2. **Palpite dos amigos com sigla:** novo `poolBetShortLabel(kind, params, codes)` em `lib/view/friend-pool.ts`: `exact_score` → "PAL 2 × 1 FLA" (sigla de `teamPair(...).home.short`/`.away.short`, que desempata siglas iguais); os outros tipos continuam com `poolBetLabel` e o nome curto ("Vitória do Flamengo", "Mais de 2,5 gols"). Na lista (`[id]/page.tsx:152-157`), o tipo e a aposta numa linha só, sem `flex-[2]` (que forçava a quebra): `"Placar · PAL 2 × 1 FLA"`, placar em mono `tabular-nums`. `poolBetLabel` continua para os formulários e títulos.
3. **Selo invertido com hora da trava** (`bolao/page.tsx:91-98`, `statusOf`): virar `poolStatusView(row, now)` puro em `lib/view/friend-pool.ts` devolvendo `{ label, tone: "open" | "soon" | "neutral" }`:
   - aberto e trava em mais de 3h → `open`: "apostas abertas", `border-accent-border bg-accent-soft text-accent-fg` (destaque do DESIGN.md). **Sem a hora no selo:** a trava é o apito e a linha do bolão já mostra data e hora do jogo logo abaixo do título (`poolMatchLabel` → `formatKickoffDateTime`, `bolao/page.tsx:125-127`); repetir no selo seria a mesma hora duas vezes no cartão;
   - aberto e trava em até 3h (`COUNTDOWN_WINDOW_MS`) → `soon`: "fecham em 2h 10min" (`formatStartsIn`), `border-warn-border bg-warn-soft text-warn-fg` (é aqui que o "horário de trava" da revisão entra: quanto falta);
   - placar conhecido → `neutral`: "placar 3 × 1" (contorno, `text-muted-foreground`);
   - adiado/cancelado/esperando o placar → `neutral` (textos de hoje: "jogo adiado", "jogo cancelado", "esperando o placar").
   A trava é o apito (`poolBetsOpen` = `matchUnavailableReason(...) === null`, `lib/pools/pool-state.ts`). O `timeZone` não entra (o countdown é delta, não relógio). No bolão aberto (`[id]/page.tsx`), o `description` já tem a hora do jogo (`:76`); só nas últimas 3h o `meta` ganha "· apostas fecham em 2h 10min".
4. **Vazio "Escolha um jogo acima" sem jogo acima** (`bolao/page.tsx:67-72`): descrição condicionada a `options.length > 0`; sem opções: "Quando houver jogo nos próximos 14 dias, crie o bolão aqui em cima e anote a aposta de cada amigo."

Testes: `lib/view/__tests__/friend-pool.test.ts` (existente): `poolBetShortLabel` (placar com siglas; sigla repetida desempatada; os outros tipos iguais a `poolBetLabel`), `poolStatusView` (aberto longe, aberto em 2h, 3h exatas, placar, adiado, cancelado, esperando) com `now` fixo. A assinatura vira `poolStatusView(row, now)`.

---

## Linha 22: Lista de jogos (`/jogos`)

### View
`lib/view/match.ts` ganha `toMatchListRowView(args) → MatchListRowView` = `toMatchRowView(args)` + campos de lista. **`MatchRowView` e `MatchHeroView` não mudam** (o hero é do PR 3; `/time` e os goldens seguem iguais):
```ts
// lib/view/types.ts
export type MatchListRowView = MatchRowView & {
  day: { key: string; label: string }; // "2026-10-18", "Sábado 18/10" | "Hoje"
  time: string;                         // "19:00"
  startsIn?: string;                    // "em 2h 15min" só nas últimas 3h
};
```
Novo `lib/view/match-list.ts` (puro):
- `groupByDay(rows: MatchListRowView[]) → { key, label, rows }[]` preservando a ordem (`range.order` é sempre `asc`; agrupa linhas consecutivas pela `day.key`).
- `matchRowPhase(m: MatchRowView) → "live" | "finished" | "off" | "upcoming"` (`live` = `status === "live" || isInProgress`; `off` = adiado/cancelado). Hoje esse `if/else` está duplicado em `match-row.tsx:71-156`, `upcoming-matches-desktop.tsx:332-376` e `desktop-status-cell.tsx`; passa a ser um lugar só. **Encaixe do #580:** ele acrescenta dados ao ramo `live` (minuto, placar ao vivo) sem mudar a estrutura; se quiser um grupo "Ao vivo" no topo, troca o `day` dessas linhas no mapper (`{ key: "live", label: "Ao vivo" }`) e o `groupByDay` não muda.

### Componentes
Novos, compartilhados pelas duas árvores (server-safe, sem `"use client"`, como `MatchModelLine`):
- `components/match-list/day-heading.tsx`: `<h2>` sans `text-body-sm font-medium` com o `label` ("Hoje", "Amanhã", "Sábado 18/10"); no celular, `px-5 pt-5 pb-2` fora do cartão; no desktop, faixa `bg-surface-2` dentro do `Card`.
- `components/match-list/odds-inline.tsx`: as odds lado a lado numa linha: `grid` com uma célula por outcome (`grid-cols-3` no 1X2, `grid-cols-2` no total de gols), rótulo `text-meta text-muted-foreground` em cima e odd mono `text-body-sm tabular-nums` embaixo. Rótulos já curtos (sigla/"Empate"/"Mais de 2,5", `lib/view/odds.ts:124-140`).
- `components/match-list/row-trailing.tsx`: o lado direito da linha por `matchRowPhase`: `live` → placar parcial + legenda (ou "—"); `finished` → placar + "encerrado"; `off` → "Adiado"/"Cancelado"; `upcoming` → `OddsInline` ou "sem odd". **É o ponto de extensão do #580.**
- `components/match-list/analyzed-badge.tsx`: `Badge size="xs"` `border-accent-border bg-accent-soft text-accent-fg` com `Check` + "analisado" (palavra sempre presente).

`components/match-row.tsx` (celular e `/time`):
- Nova prop opcional `timeLabel?: string`; sem ela usa `m.kickoff` (o `/time` não muda de comportamento).
- Linha de cima: à esquerda o horário (`timeLabel ?? m.kickoff`, mono) e, no `live`, o `LiveBadge` no lugar do horário; depois o selo da liga. À direita, o `AnalyzedBadge` (ver Q8).
- Meio: times (escudo + nome curto) à esquerda; `RowTrailing` à direita (odds em uma linha de duas alturas, alinhada com os dois times). Some o `flex-col` de três linhas de odds.
- Linha do modelo (`MatchModelLine`) embaixo, como hoje.
- `data-tour="match-row"` continua na `Link`.

`components/upcoming-matches-desktop.tsx`:
- Sai a coluna Status e o `DesktopStatusCell` (arquivo removido; o teste `desktop-live.test.tsx` e `match-row-finished-prediction.test.tsx` migram para o `RowTrailing`/linha). Grade nova `UPCOMING_GRID = "grid-cols-[132px_1fr_auto_24px]"` (liga + hora · jogo · odds/estado · chevron); o cabeçalho da grade some (o dia vira a faixa de grupo).
- "analisado" ao lado dos nomes, na célula do jogo (`AnalyzedBadge` à direita do bloco dos dois times, centralizado na altura deles). Encerrado-analisado continua mostrando o selo (regra do #99).
- "AO VIVO" aparece **uma vez** (na coluna da hora, no lugar do horário).
- `components/skeletons/match-list-skeleton.tsx` acompanha a grade nova.

Os dois `UpcomingMatches*` recebem `MatchListRowView[]`, fatiam o lote (`INITIAL_BATCH` 15, igual), calculam `tourMatchIndex(slice)` na lista plana e só então agrupam (`groupByDay(slice)`): o reveal e o alvo do tour não mudam de regra. O grupo do fim de um lote cresce quando "Carregar mais" traz o resto do dia.

**Horário:** dentro do grupo, a linha mostra `startsIn` quando existe (últimas 3h), senão `time`. "amanhã, 19:00", "sáb, 08:30" e "em 16h 09min" deixam de aparecer na lista.

**Linha do modelo legível** (`components/match-model-line.tsx`): `text-body-sm` (12px), rótulo sans ("Modelo:") e números mono: "Modelo: PAL 42% · Menos de 2,5 59%". `text-muted-foreground` (12px permite `muted-fg-2`, mas a linha é a informação mais útil da lista: fica no cinza mais forte). A barra de três cores da revisão fica fora (Q9).

**Suas predições recentes, um cartão por jogo:**
- **Colide com a ADR 0020 Decisão 4**, que fixou o "recentes" como feed **sem** dedup ("Deduplicar também a lista de recentes: rejeitado — colapsaria reanálises do mesmo jogo", `docs/decisions/0020-historico-predicoes-e-contagem-no-yield.md:49-55,84-87`; o comentário de `getRecentPredictionsByUser`, `predictions.ts:357-362`, repete). O dono aprovou a mudança na revisão (linha 22, "Fazer"), mas decisão registrada só muda com ADR (CLAUDE.md). Primeiro commit do PR B: **ADR curta `0058` (ou o próximo número livre) "Suas predições recentes: um cartão por jogo"**, que emenda a 0020 D4: o cartão é por jogo e mostra a análise mais recente de cada mercado; a contagem de KPI (0020 D2) não muda; a reanálise continua visível no detalhe do jogo ("análises anteriores") e no Desempenho. Status da 0020 ganha "D4 emendada pela 0058".
- Nova query `getRecentPredictedMatchesByUser(userId, matchLimit = 5)` em `lib/db/queries/predictions.ts`: (1) `select matchId, max(createdAt) as last from predictions where userId group by matchId order by last desc limit 5`; (2) as predições do usuário nesses jogos com as mesmas colunas de `getRecentPredictionsByUser` (`:368-381`) mais `matches.kickoffAt`. `getRecentPredictionsByUser` fica (usado em `recommendation-labels.pglite.test.ts`); se ficar sem uso de produção, sai num commit de limpeza.
- `lib/view/recent-prediction.ts`: `toRecentMatchViews(rows, timeZone) → RecentMatchView[]`: agrupa por jogo, mantém a mais recente por `marketKey` (mesma chave do `keepLatestPerMatch`, ADR 0020), ordena os jogos pela análise mais recente. Por jogo: `{ matchId, league, home, away (siglas), when (data do jogo, "sáb 18/10"), bets: { market, rec, edge }[], passCount }`, apostas antes, no máximo 2 visíveis + "+N".
- `components/recent-pred-card.tsx`: um cartão por jogo: liga · data do jogo; "PAL × FLA"; até duas linhas "Ambas marcam · **Não** · vantagem +5,6"; depois "3 mercados sem aposta" (ou, sem nenhuma aposta, "Sem aposta em 5 mercados"). "PASS" não aparece (já é "Sem aposta" via `recommendationLabel`, #575). Tipo novo `RecentMatchView` em `lib/view/types.ts`; `RecentPredictionView` sai se ficar sem uso. O link do cartão vai para o jogo (`/match/{id}` com `back`, como hoje; o `listHref` continua). O wrapper `data-tour="recent-predictions"` (`jogos/page.tsx:333`, `:419`) fica onde está.

### Testes (linha 22)
- `lib/view/__tests__/match-list.test.ts` (novo): `groupByDay` (ordem preservada, rótulos Hoje/Amanhã/dia da semana no fuso, virada de dia em São Paulo, jogo de 22h de SP que é 01h UTC cai no dia de SP), `matchRowPhase` (as quatro fases, inclusive `isInProgress` de jogo ainda `scheduled`).
- `lib/view/__tests__/match.test.tsx`: `toMatchListRowView` com `startsIn` só ≤3h; `toMatchRowView` intacto (mesmos asserts).
- `lib/view/__tests__/recent-prediction.test.ts`: agrupamento por jogo, dedup por mercado (reanálise vence), contagem de "sem aposta", ordem dos jogos.
- `lib/db/queries/__tests__/recommendation-labels.pglite.test.ts` (ou novo `recent-predicted-matches.pglite.test.ts`): `getRecentPredictedMatchesByUser` devolve no máximo 5 jogos, todos os mercados deles, e nada de outro usuário.
- `components/__tests__/upcoming-matches.test.tsx`: reveal continua (contar `href="/match/`), cabeçalho de dia presente, odds numa linha (um contêiner `grid` com 3 células no 1X2), linha do modelo com `text-body-sm`.
- `components/__tests__/desktop-live.test.tsx` e `match-row-finished-prediction.test.tsx`: reescritos sobre `RowTrailing`/`MatchRow` (um "ao vivo" só; "encerrado" + "analisado").
- Golden `components/__tests__/odds-card-parity.golden.test.tsx` (snapshots **inline**, no próprio arquivo): o PLAN-576 (Remoções, `:224`) **apaga o arquivo inteiro** junto com o `OddsCard`. Se o PR 3 já tiver mergeado quando o PR B rebasear, não há nada a regenerar: a cobertura da linha fica nos testes estruturais acima (não recriar golden de lista). Se o arquivo ainda existir, atualizar só os dois casos da lista (`pnpm vitest run components/__tests__/odds-card-parity.golden.test.tsx -u -t "MatchRow chip|UpcomingMatchesDesktop chip"`; o `-u` reescreve só os inline dos testes que rodaram) e revisar o diff à mão; o caso do `OddsCard` não pode mudar.
- `lib/tour/__tests__/steps.test.ts`: `tourMatchIndex` sem mudança. O contrato "todo alvo tem `data-tour` no código" (`:70-95`) varre `.tsx` de `app/` e `components/` com a regex `data-tour=[^\n]*"<alvo>"`: o `data-tour={tourTarget ? "match-row" : undefined}` tem que continuar **numa linha só** (o Prettier pode quebrar; conferir).

---

## Linha 23: filtros da lista em chips

### Desenho
Uma linha rolável (`flex gap-2 overflow-x-auto [scrollbar-width:none]`, `-mx-5 px-5` no celular para sangrar até a borda), na ordem:
```
[ Todas as ligas ▾ ] | [ 5 dias ] [ 14 dias ] [ Competição ] [ Escolher datas ]
```
- **Liga:** o `LeaguePicker` atual vira chip (`<select>` nativo com aparência de chip: `h-8 rounded-full`, largura pelo conteúdo). Mantém optgroups por região, estado otimista e `buildLeagueHref`. Ver Q1 (chips por liga em vez do select).
- **Período:** `DateRangeTabs` vira chips `Link` com o `FilterChipLink` do PR A (`aria-current="page"`), mesmos `href` de hoje (`buildRangeHref`). O chip "Escolher datas" é um botão; com `preset=custom` ativo ele mostra o intervalo ("18/10 – 25/10", de `rangeLabel`) e fica selecionado. **É o único lugar onde o período aparece.**
- **Escolher datas:** novo `components/date-range-sheet.tsx` (client). Celular: `Sheet side="bottom"` com título "Escolher datas", os dois `<input type="date">` rotulados **De** e **Até** (mesmos `aria-label` de hoje), botão "Aplicar" (desabilitado sem as duas datas) que navega para `buildRangeHref({ league }, { preset: "custom", from, to })`, e "Limpar" que volta para 5 dias. Desktop: o mesmo conteúdo num `Popover` ancorado no chip (prop `surface: "sheet" | "popover"`; cada árvore da página passa a sua).
- Alvos do tour: `data-tour="league-picker"` no chip da liga e `data-tour="date-range"` no grupo dos chips de período, os dois dentro da linha. Conferido em `guided-tour.tsx`: o `scrollIntoView({ block })` (`:207-210`) não passa `inline`, cujo padrão é `"nearest"`, então rola também o contêiner horizontal até o alvo; e o spotlight remede em `scroll` com `capture: true` (`:240`), que pega a rolagem do contêiner. O alvo "date-range" (4 chips, ~370px) cabe em 390px com o `px-5`. Tour sem mudança de código; só o texto do passo "Período" (`lib/tour/steps.ts:59-61`): "Escolha a janela: 5 dias, 14 dias, a competição inteira ou, em \"Escolher datas\", um intervalo seu." Conferir no tour real em 390px (o teste de jsdom não mede layout).

### Página (`app/(app)/jogos/page.tsx`)
- `PageHeader` das duas árvores: `meta` = "{n} jogos" só (sai `· {label}` e `· {liga}`: a liga está no chip, o período também). Desktop: os chips saem de `actions` e vão para uma linha própria abaixo do cabeçalho (a linha rolável não cabe à direita do título).
- Celular: sai o `SectionLabel {label}` (`:318`); o primeiro cabeçalho de dia ocupa o lugar. Sai o bloco `flex-col gap-2` de dois controles empilhados (`:304-316`).
- `rangeNavProps`, `listHref`, `listKey` e a validação de liga/redirect não mudam. **Parâmetros de URL não mudam** (`league`, `preset`, `from`, `to`, `tour`): links salvos continuam funcionando.
- `app/(app)/jogos/loading.tsx`: o esqueleto do filtro vira uma linha de chips (`h-8 rounded-full`) e sai o `SectionLabel "Próximas 48h"` (texto velho).
- `DESIGN.md` (Layout & motion): uma frase: listas de jogos agrupadas por dia no fuso do usuário; filtros de lista numa linha de chips rolável.

### `/como-usar` (`app/(app)/como-usar/como-usar-content.tsx`)
- `:145-151`: "Escolha o campeonato no primeiro botão da linha de filtros (…)" e "Escolha o período: 5 dias, 14 dias, Competição ou um intervalo seu em Escolher datas (campos De e Até)."
- `:158-165`: "Os jogos vêm separados por dia (Hoje, Amanhã, …). Cada linha traz o horário (nas últimas 3 horas, quanto falta), o campeonato, os times e as odds de referência lado a lado (…). Aparece ✓ analisado …" (o rótulo "✓ analisado" continua batendo com a tela).
- `:168-169`: "Suas predições recentes mostra os últimos jogos que você analisou, um cartão por jogo com os mercados."
- `:355-361` (Suas apostas): "No topo, quantas estão em aberto, quantas você acertou e o saldo em unidades; o filtro separa Em aberto e Encerradas."
- `:349-353` (Desempenho): "retorno, taxa de acerto, jogos sem aposta, lucro hipotético em unidades, o gráfico da banca" → "retorno, taxa de acerto e saldo no topo, o gráfico do saldo, e em <Ui>Detalhe técnico</Ui> os números por mercado (CLV, amostra, graduação)"; a tabela "mostra 25 análises por página".
- O teste `como-usar-content.test.tsx` checa cada rótulo no HTML do guia **e** em algum `.tsx` de `app/`/`components/` (`:11-23`; `.ts` de `lib/` não conta). Acrescentar "Escolher datas", "Em aberto", "Encerradas" e "Detalhe técnico" à lista; os quatro têm de estar **literais** num `.tsx` (`date-range-sheet.tsx`, `slip-filter.tsx`, `dashboard/page.tsx`). "Hoje"/"Amanhã" vêm de `lib/format.ts`: se o guia citá-los, citar em texto corrido, não na lista do teste. A lista também é editada pelo PR 3: rebase.

### Testes (linha 23)
- `components/__tests__/league-picker.test.tsx`: continua (o select é o mesmo); asserção nova da classe de chip.
- `components/__tests__/date-range-chips.test.tsx` (novo): os três chips têm os `href` de hoje (comparados com `buildRangeHref({ league }, { preset })`, não com string montada à mão); com `preset=custom`, o chip de datas mostra "18/10 – 25/10" e está `aria-current`; o período aparece uma vez no HTML da linha.
- `lib/view/__tests__/range-href.test.ts`: sem mudança (os `href` são os mesmos).
- Sem teste de interação do Sheet (Radix em jsdom); conferir na tela.

---

## Ordem dos commits

PR A (`feat(ui): revisão de design 4/6 — Suas apostas, Desempenho e bolão (#577)`):
1. `feat(format):` `formatTimeOfDay`, `dayKeyOf`, `formatDayHeading`, `formatStartsIn`, `COUNTDOWN_WINDOW_MS` + testes.
2. `feat(apostas):` ledger (`getUserBetSlipLedger` com `matchOver`, `slipIds` e `match.status` no page), `lib/bets/slip-ledger.ts` + testes (pglite e puros). Sem mudança de tela.
3. `feat(apostas):` `FilterChipLink`, resumo, filtro Em aberto/Encerradas, cartão (combinada no topo, status único, rótulo com time, "Jogo cancelado", detalhes), `loading.tsx`/`error.tsx` + testes.
4. `feat(desempenho):` data do jogo e ordem na tabela + `paginate` + paginação por `?page=` + testes.
5. `feat(desempenho):` resumo no topo (tons e retorno com sinal na view, frase de "passado não garante futuro"), gráfico acima, "Detalhe técnico" recolhido com `KpiCards variant="technical"`, CLV com cor por sinal, "D9" fora dos três textos, `loading.tsx` + testes.
6. `feat(bolao):` sigla no palpite, selo em destaque/âmbar nas últimas 3h, vazio sem jogo + testes.
7. `docs:` `/como-usar` (apostas e desempenho) + rótulos novos no teste.

PR B (`feat(ui): revisão de design 4/6 — lista de jogos por dia e filtros em chips (#577)`), sobre `main` com o PR A:
8. `docs:` ADR 0058 (ou o próximo número livre) "Suas predições recentes: um cartão por jogo", emendando a ADR 0020 D4; status da 0020 atualizado.
9. `feat(jogos):` `toMatchListRowView`, `groupByDay`, `matchRowPhase` + testes (sem mudança de tela).
10. `feat(jogos):` linha nova (odds numa linha, `RowTrailing`, `AnalyzedBadge`, modelo legível), agrupamento por dia nas duas árvores, coluna Status removida, esqueleto + golden (só se o arquivo ainda existir, ver Testes).
11. `feat(jogos):` Suas predições recentes por jogo (query, view, cartão) + testes.
12. `feat(jogos):` chips de liga e período, `DateRangeSheet`, período uma vez, `meta` enxuto, `loading.tsx` + testes.
13. `docs:` `/como-usar` (lista e filtros), texto do passo "Período" do tour, `DESIGN.md`.

Cada commit: `pnpm test && pnpm lint && pnpm typecheck`; fim de cada PR: `pnpm build` e conferência visual em 390px e 1440px, claro e escuro (`/jogos` com hoje/amanhã/sábado e um jogo ao vivo; `/apostas` com simples, combinada, não conferida e vazio por filtro; `/dashboard` com 30+ análises, página 2 e detalhe técnico aberto; bolão aberto, travando em breve e encerrado). Rodar `pnpm install --ignore-workspace` localmente e **não** commitar `pnpm-workspace.yaml` nem `.playwright-mcp/`.

---

## Decisões (resolvidas na revisão do plano)

1. **Liga como `<select>` em chip ou chips por liga?** **Resolvido: select em chip.** Com até 10 ligas ativas, chips por liga empurrariam o período para fora da tela no celular; o select nativo mantém os grupos por região e cabe em ~130px.
2. **Valores do filtro de `/apostas`.** **Resolvido: `?status=abertas|encerradas`** (sem parâmetro: "abertas" quando há alguma aberta, senão "encerradas"; valor inválido cai no padrão). Sem opção "Todas" (a issue pede só os dois). Chips **sem contagem** (ajuste da revisão: o "em aberto" já está no resumo).
3. **"Acertos" em contagem ou %?** **Resolvido: contagem "4 de 7".** A porcentagem já está no Desempenho; em `/apostas` a contagem lê melhor com poucas apostas e evita "taxa" sobre amostra pequena.
4. **Cor do saldo.** **Resolvido:** positivo `text-edge-fg`, negativo `text-destructive`, zero neutro, com o sinal escrito por `formatUnitsSigned` ("+2,35 u", "-1,00 u"; ajuste da revisão: `formatUnitsCompact` não escreve o "+"), igual à tabela do desempenho (`predictions-table.tsx:128-139`). O `edge-*` é "vantagem"; usar no saldo segue o precedente do `KpiCards` (`kpi-cards.tsx:107`).
5. **Não conferida (perna de cartões etc.):** **Resolvido: "Em aberto" até o jogo acabar, depois "Encerradas"**, fora do saldo. "Acabar" = `finished`/`cancelled` **ou** 150 min depois do apito (ajuste da revisão, para não depender do cron virar o status). Pendente de jogo cancelado vai para "Encerradas" com o selo "Jogo cancelado".
6. **Frase de "passado não garante futuro" no resumo do Desempenho.** **Resolvido: sim, com o texto dos Termos §4: "Desempenho passado não garante desempenho futuro."** (ajuste da revisão: o rascunho dizia "Resultado passado não garante resultado futuro.", que não existe em lugar nenhum; a ADR 0048 D4 cita "passado não garante futuro" e o report 11/compliance não fixam texto verbatim, então vale a frase que o app já publica). Em `/apostas` não: o §3 já está na tela (um aviso por tela).
7. **Coluna "data" da tabela.** **Resolvido:** manter o cabeçalho "data", agora com a do jogo, e ordenar por jogo (mais recente primeiro).
8. **"analisado" no celular.** **Resolvido: no topo da linha, à direita**, porque ao lado dos nomes disputa a largura com as odds em 390px. No desktop, ao lado dos nomes, como a revisão pede.
9. **Linha do modelo em texto de 12px ou barra de três cores?** **Resolvido: texto de 12px.** A barra é outra peça de gráfico (cores de `chart-*` mudam entre temas, linha 28 da revisão) e não diz o rótulo sem legenda.
10. **Unificar as duas árvores de `/jogos` numa só?** **Resolvido: não neste PR.** Os subcomponentes novos já são compartilhados; unificar mexe no tour (`findTarget` procura o primeiro visível) e aumenta o conflito com o #580.
11. **Tamanho da página da tabela do Desempenho.** **Resolvido: 25.**
12. **Detalhe técnico ou mover para `/admin/calibration`?** **Resolvido: recolhido no próprio Desempenho** (a issue escolheu isso), sem repetir os números do resumo; o admin continua com tudo aberto.
13. **(nova) Suas predições recentes por jogo × ADR 0020 D4.** **Resolvido: fazer, com ADR curta emendando a D4** (commit 8). Alternativa rejeitada: manter o feed sem dedup e só agrupar visualmente (cinco cartões do mesmo jogo voltariam a aparecer, que é o problema da revisão).

---

## Riscos e conflitos

- **PR 3 (#576) na mesma árvore.** Arquivos editados pelos dois: `lib/tour/steps.ts`, `app/(app)/como-usar/como-usar-content.tsx` + teste e `DESIGN.md` (trechos diferentes; rebase manual). Pontos de contato só de leitura: `lib/view/bet-slip.ts` (`slipLegLabel` importado; limpeza do `historyLegSummary` só depois do rebase), `lib/view/match-availability.ts` (via `poolBetsOpen`) e `MatchCollapsible`. O golden `odds-card-parity.golden.test.tsx` o PR 3 apaga (ver Testes da linha 22).
- **#580 (ao vivo).** Vai mexer na linha da lista: o `RowTrailing` + `matchRowPhase` são o encaixe (dados novos no ramo `live`, sem mudar a estrutura); grupo "Ao vivo" é troca do `day` no mapper. O PR B deve mergear antes dele.
- **Fuso.** Tudo que agrupa por dia passa o `timeZone` do `getRequestTimeZone()` (cookie `tz` do `<TimezoneSync>`; sem cookie, BRT). Esquecer de passar o `timeZone` a um formatador cai no fuso do runtime (UTC na Vercel), o bug do #409/#410: os formatadores novos recebem `timeZone` obrigatório nas chamadas da página (o `?` da assinatura é só para testes legados). Na primeira visita de quem está fora do BRT, o primeiro render agrupa em BRT e o `TimezoneSync` corrige com um refresh. Testes com `America/Sao_Paulo` perto da meia-noite e um caso de horário de verão (`Europe/London`).
- **Range `custom` usa dia UTC** (`date-range.ts:73-79`) e o agrupamento usa o dia local: um jogo às 22h de 25/10 em São Paulo (01h UTC de 26/10) fica fora de "18/10–25/10". Comportamento de hoje, não muda aqui; anotar como follow-up.
- **ADR 0048.** Nenhuma tela pública muda. Taxa de acerto, acertos e saldo só em `/apostas` e `/dashboard` (privadas, histórico verificável). O Desempenho ganha a frase de "passado não garante futuro" que a D4 pede. Nenhum nome de casa entra.
- **ADR 0020 D4** emendada por ADR nova (Suas predições recentes); sem ela o PR B contradiz decisão registrada.
- **Altura da linha no celular.** As odds viram duas linhas de altura (rótulo e odd), alinhadas com os dois times; a meta é sair de ~104px para ~76px por jogo. Conferir truncamento de nomes longos ("Atlético de Madrid") com três células de odd em 390px; se apertar, a sigla substitui o nome no celular (decidir na tela, não no código).

## Critério de saída

- `/apostas`: resumo (em aberto, acertos, saldo em unidades com sinal) no topo; filtro Em aberto / Encerradas e paginação que respeita o filtro; simples com um selo só; combinada com "Combinada · N seleções" no topo; perna com o nome do time; jogo cancelado sem "Em aberto" na lista de encerradas; linha visível só com odd, stake e chance; o resto em "detalhes"; `loading.tsx` e `error.tsx`.
- `/dashboard`: retorno (com sinal), taxa de acerto, saldo, "Desempenho passado não garante desempenho futuro." e gráfico antes de qualquer cartão por mercado; nenhum número do resumo repetido e nenhum `n=` fora do "Detalhe técnico"; nenhum "D9" na tela; CLV positivo verde com "+", negativo vermelho com "-", inclusive com amostra pequena; tabela com a data do jogo, 25 por página, `?page=` preservado ao abrir e voltar do detalhe; `loading.tsx` com o desenho novo.
- `/jogos`: jogos agrupados por dia (Hoje, Amanhã, "Sábado 18/10") no fuso do usuário; hora simples na linha e contagem só nas últimas 3h; odds lado a lado; linha do modelo em 12px; sem coluna Status; "analisado" como selo; um cartão por jogo em Suas predições recentes; uma linha de chips rolável; "Escolher datas" abre uma folha (popover no desktop); o período aparece uma vez; links antigos (`?league=`, `?preset=`, `?from=&to=`, `?tour=1`) funcionam.
- Bolão: aposta de placar "PAL 2 × 1 FLA" numa linha; selo de aberto em destaque, âmbar com "fecham em …" nas últimas 3h, placar em contorno; vazio sem "Escolha um jogo acima" quando não há jogo.
- ADR nova emendando a 0020 D4 mergeada junto com o PR B.
- Tour (os seis passos de `/jogos`) e `/como-usar` batendo com a tela; guardas de escala, cabeçalho e bookmaker verdes; `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` verdes.

## Arquivos

Novos: `lib/bets/slip-ledger.ts`, `lib/view/paginate.ts`, `lib/view/match-list.ts`, `components/filter-chip.tsx`, `components/bets/slips-summary.tsx`, `components/bets/slip-filter.tsx`, `components/bets/slip-card.tsx`, `components/dashboard/summary-cards.tsx`, `components/dashboard/table-pagination.tsx`, `components/match-list/{day-heading,odds-inline,row-trailing,analyzed-badge}.tsx`, `components/date-range-sheet.tsx`, `app/(app)/apostas/{loading,error}.tsx`, `docs/decisions/0058-*.md` (número a conferir) e os testes citados.

Alterados: `lib/format.ts`, `lib/db/queries/user-bets.ts`, `lib/db/queries/predictions.ts`, `lib/view/{dashboard,match,recent-prediction,friend-pool,types}.ts`, `lib/dashboard/derive-view.ts`, `lib/tour/steps.ts` (texto), `components/dashboard/{market-segments,dashboard-filters,kpi-cards}.tsx`, `components/{match-row,match-model-line,upcoming-matches-desktop,upcoming-matches-mobile,recent-pred-card,league-picker,date-range-tabs}.tsx`, `components/skeletons/match-list-skeleton.tsx`, `app/(app)/{apostas,dashboard,jogos,bolao}/page.tsx`, `app/(app)/bolao/[id]/page.tsx`, `app/(app)/{jogos,dashboard}/loading.tsx`, `app/(app)/como-usar/como-usar-content.tsx` + teste, `docs/decisions/0020-*.md` (status), `DESIGN.md`.

Removido: `components/desktop-status-cell.tsx` (vira `RowTrailing`).

---

## Revisão do plano

Revisão adversarial contra `origin/main` (`2f050fd`) e a branch do PR 3 (`d1e458e`, mesma árvore). As referências de linha do rascunho bateram, com as exceções corrigidas acima (`market-segments.tsx` `:23`/`:178` → `:24`/`:179`). Padrão do dono: aceitar cada recomendação, salvo problema concreto; nesses casos ficou a opção mais segura. As correções já estão no corpo; aqui o porquê.

**Erros corrigidos**
1. **Frase de "passado não garante futuro".** "Resultado passado não garante resultado futuro." não existe na ADR 0048, no report 11 nem no compliance (`docs/ops/05-legal-compliance.md:178` diz só "passado não garante futuro"). Fica a frase que o app já publica nos Termos §4: "Desempenho passado não garante desempenho futuro." (Q6).
2. **Saldo com sinal.** `formatUnitsCompact` não escreve "+" (`lib/format-number.ts:98-103`) e corta zeros ("-1u", não "-1,00u"). Trocado por `formatUnitsSigned`, o formato do saldo do Desempenho (Q4). O retorno do resumo também não teria "+" com `formatPct`: a view ganha `yieldSigned` e tons explícitos (`yieldTone`/`profitTone`), em vez de cor tirada do texto.
3. **Fuso.** O rascunho dizia que sem fuso cai em UTC. `getRequestTimeZone()` lê o cookie `tz` do `<TimezoneSync>` e cai em **BRT**; UTC só morde quem chama o formatador sem `timeZone`. Corrigido em "Estado verificado" e Riscos; caso de horário de verão (`Europe/London`, 25/10/2026) acrescentado, porque São Paulo não tem mais horário de verão e não exercita a borda.
4. **Golden.** O PLAN-576 apaga `odds-card-parity.golden.test.tsx` inteiro (snapshots inline). "Regenerar só dois casos" vira condicional: se o arquivo já sumiu, não há nada a fazer e não se recria golden de lista.
5. **Conflitos com o PR 3.** "Nenhum arquivo deste plano está na lista dele" era falso: `lib/tour/steps.ts`, `como-usar-content.tsx` + teste e `DESIGN.md` já estão (ou vão estar) no diff dele. Lista de intocáveis ampliada com o que o diff real da branch mostra.
6. **Referência legal de `/apostas`.** "ADR 0056 item 4" é vocabulário de tela, não privacidade. A base é a ADR 0048 D4 (histórico do próprio usuário, sem marketing) e a ADR 0036 §13 (nada de slip no `/p`/OG); o §3 fica pela ADR 0057 item 6.
7. **`MatchCollapsible` com `meta` textual.** O `meta` é `font-mono` (`match-collapsible.tsx:37`): "CLV, amostra e graduação por mercado" em mono quebra a ADR 0056 item 2. Sem `meta`; a frase vai dentro.

**`/apostas`: ledger, filtro e cursor (conferido)**
- O keyset `(createdAt, id)` dentro de `inArray(ids)` é correto: o cursor é posição, não pertença; um slip que muda de recorte entre páginas só migra de lista. Lista vazia não vai ao banco. 3 idas ao banco por visita (hoje 2): aceito na escala; o teto real do `inArray` é o de parâmetros do Postgres, longe.
- Derivação aberta/encerrada: liquidação só grava `won`/`lost` e jogo cancelado/adiado nunca liquida. Ajustes: (a) `nao_conferida` fecha também por tempo (`kickoffAt` + 150 min, a mesma constante do settlement), senão depende do cron virar o status; (b) `pendente` de jogo cancelado vai para "Encerradas" com selo "Jogo cancelado" (antes mostraria "Em aberto" dentro de "Encerradas"; exige `match.status` no `getUserBetSlipsPage`); (c) adiado continua aberto. `void`/`push` não são gravados hoje; ficam como `deriveSlipStatus` já os trata (pendente), sem escopo novo.
- Stake: simples na perna, combinada no slip (conferido em `app/actions/bet-slip.ts:186-208`); a regra de `slipProfitUnits` do rascunho estava certa.
- Rótulo da perna: `betLegLabel` diz "Vitória do mandante"; o desenho do rascunho já mostrava "Vitória do Palmeiras" sem dizer de onde vinha. Fica `slipLegLabel` (import de `lib/view/bet-slip.ts`, o rótulo do cupom). Era pendência deixada pelo PLAN-578.
- Contagem nos chips cortada: o "em aberto" do resumo e o "Em aberto (3)" do chip repetiam o mesmo número; a linha "{closed} encerradas · …" também saiu. O desenho tinha "7 encerradas" e "Encerradas (9)" ao mesmo tempo, sinal de que a contagem confundia.
- Rótulos novos literais em `.tsx` (o teste do `/como-usar` não varre `lib/*.ts`).

**`/dashboard`**
- Paginação e filtros: `buildDashboardHref` já não carrega `page` (volta à 1 em qualquer troca, inclusive status); `resolveBackHref` aceita `?page=` sob `/dashboard`; a página corta o recorte depois do filtro de status. Admin sem paginação, como planejado.
- "Detalhe técnico" repetia retorno, taxa de acerto e lucro do resumo (o mesmo número duas vezes na tela, a queixa central da revisão). `KpiCards` ganha `variant="technical"` (só "jogos sem aposta" + contagens); o admin segue com `"full"`.
- Faltavam: `app/(app)/dashboard/loading.tsx` (desenha 4 cartões), o terceiro "D9" (`market-segments.tsx:157`) e o texto do `/como-usar` que ainda diz "lucro hipotético" e "gráfico da banca".

**Bolão**
- Cortado: extrair a lista de apostadores só para teste de regressão de um bug já resolvido (puxaria a server action `removeFriendPoolEntry` para o teste).
- Selo aberto sem hora: a trava é o apito e o cartão já mostra data e hora do jogo na linha de baixo (`poolMatchLabel`), assim como o cabeçalho do bolão. A hora de trava entra como contagem "fecham em 2h 10min" nas últimas 3h, que é o que pede atenção. `poolStatusView` não precisa de `timeZone`.

**`/jogos`**
- **ADR 0020 D4.** Um cartão por jogo com a análise mais recente por mercado é exatamente a alternativa que a 0020 rejeitou ("deduplicar também a lista de recentes"). O dono aprovou a mudança na revisão, mas decisão registrada muda por ADR (CLAUDE.md). Acrescentada ADR curta como primeiro commit do PR B (Q13).
- Countdown: `0 < delta ≤ 3h`, delta puro (sem fuso), render do servidor sem relógio; envelhece com a aba aberta como o formato de hoje. `COUNTDOWN_WINDOW_MS` separado de `IN_PROGRESS_WINDOW_MS`: certo.
- Tour: alvos `league-picker`/`date-range`/`match-row`/`recent-predictions` conferidos; o `scrollIntoView` sem `inline` rola o contêiner horizontal e o spotlight remede em scroll com `capture`. O contrato de `steps.test.ts` exige `data-tour=… "alvo"` numa linha só.
- `range.order` é sempre `asc` hoje (`date-range.ts`), mas o `groupByDay` por chave consecutiva vale para os dois sentidos.

**Riscos que ficam**
- Três arquivos editados pelos dois PRs (tour, `/como-usar` + teste, `DESIGN.md`): rebase manual.
- `slipLegLabel` e `MatchCollapsible` vêm de arquivos que o PR 3 pode mover: ajustar imports no rebase.
- Número da ADR nova (0058) a conferir no momento do commit.
- Altura da linha em 390px com três odds e nomes longos: decidir na tela (sigla no celular), como já estava.
- Range `custom` em dia UTC × agrupamento em dia local: follow-up, sem mudança aqui.
