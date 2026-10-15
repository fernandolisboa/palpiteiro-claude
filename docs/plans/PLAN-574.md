# PLAN-574: correções, textos e formatação (linhas 4–12, 15 e 28 da revisão de design)

Rascunho anterior à implementação (ver `docs/plans/README.md`). Todas as referências foram conferidas no código em `46c389d` (e revisadas de novo; ver "Revisão do plano" no fim).
Regras: mudanças pequenas e locais. Nenhum nome, link ou logo de casa de apostas em lugar nenhum da tela (regra de produto). Não mexer em texto de prompt nem em valores do banco. Manter os alvos `data-tour` (`lib/tour/steps.ts`) e os testes de rótulo de `/como-usar` (`app/(app)/como-usar/__tests__/como-usar-content.test.tsx`).

**Decisões do dono (fechadas):**
- Placar ao vivo: mostrar o placar parcial com a legenda "parcial · atualizado há X". Sem esconder por idade. Placar ao vivo de verdade fica para o #580.
- Rótulos 1X2/dupla chance: listas (onde falta espaço) usam a sigla de 3 letras; a página do jogo usa o nome de exibição.
- Cores do gráfico no escuro: os valores propostos em 28c (mesmos matizes do claro).
- O custo de renderizar o 404 no servidor é aceito.

## Ordem sugerida (commits)
1. Linha 15 (formatador). Vem primeiro porque o resto dos testes já nasce com vírgula.
2. Linha 4 (textos e rótulos com o nome do time).
3. Linhas 5, 8, 9 e 11 (layout, independentes).
4. Linhas 6 e 7 (ao vivo e odds antes do jogo).
5. Linha 10 (odds na página do time).
6. Linha 12 (404 e CSP). Exige `pnpm build`.
7. Linha 28 (avatar, tema, gráfico).
8. `/como-usar` e o tour, conferidos no fim. Depois `pnpm test && pnpm lint && pnpm typecheck && pnpm build`.

---

## Linha 15: um formatador pt-BR

**Situação hoje.** `lib/format.ts` usa `toFixed` com ponto em `formatOdd`, `formatPct`, `formatEdge`, `formatEvPct`, `formatUnitsSigned` e `formatStakeUnits`. Os únicos consumidores desses formatadores numéricos são `lib/view/{analysis,bet-slip,dashboard,odds,match-model,recent-prediction}.ts` (mais o teste `lib/odds/scenario.test.ts`). `lib/ai` importa `lib/format`, mas só `LEAGUE_LABEL`/`leagueToKey` (`lib/ai/markets/_narrator/context.ts:2`); nenhum formatador numérico chega a prompt. `lib/ai` também importa `lib/view/markets/presentation` (`predict.ts:54`, `palpites/synthesis-input.ts:7`) e `lib/view/best-bet` (`best-bet.ts:2`, que chama `toAnalysisView` só para a view, não para o prompt). Em paralelo há soluções avulsas com vírgula:
- `components/bet-slip.tsx:69-72` (`ptOdd`)
- `lib/view/friend-pool.ts:18-20` e `components/friend-pool-forms.tsx:161` (`lineLabel`)
- `lib/user-palpite/reading.ts:155-157` (`ptPct`). **Não tocar:** `ptPct` é importado por `lib/ai/user-palpite/fallback.ts` e `lib/ai/user-palpite/narrate-cartridge.ts` (texto que vai para o modelo) e já sai com vírgula.

E outras com ponto:
- `components/bet-slip.tsx:687` (`toFixed(1)%`)
- `app/(app)/apostas/page.tsx:163,174`
- `components/dashboard/bankroll-line-chart.tsx:40` (`signed`)
- `lib/view/bet-slip.ts:233` (`stakeText`) e `:288` (`units`), ambos no formato compacto "0.5u" (cortam zeros à direita)
- `lib/view/sections.ts:114-115` (`avgGoals.toFixed(1)`)
- `lib/view/recommendation.ts:44` `marketContextLabel` ("Over/Under gols 3.5", usado em `dashboard.ts:197,340` e `recent-prediction.ts:67`)

E dois lugares que **convertem a saída formatada de volta** e quebram em silêncio com a vírgula:
- `lib/view/analysis.ts:385`: `Number(formatOdd(minOddNum)) > Number(formatOdd(oddAtRecNum))`. Com vírgula, `Number("2,67")` é `NaN`, a comparação fica sempre `false` e o aviso "a odd registrada estava abaixo da mínima" some.
- `lib/view/analysis.ts:394`: `formatEvPct(evPerUnit) !== "0.0%"`. Com vírgula, a string vira "0,0%", a condição fica sempre verdadeira e o retorno zero sai com tom positivo.

**Mudança.**
- Novo `lib/format-number.ts`, puro e sem imports, seguro no cliente. Hoje `lib/format.ts` importa `lib/ai/engine/analysis-engine`. Funções:
  - `formatDecimal(n, decimals)`: `toFixed`, depois `.replace(".", ",")`. Manter o sinal negativo em ASCII, porque `startsWith("-")` é usado para definir o tom em `components/dashboard/market-segments.tsx:67`, `prediction-detail.tsx:58,137`, `predictions-table.tsx:140` e `analysis-scenarios.tsx:261`.
  - `formatOdd` → `"2,67"`.
  - `formatPct` → `"42,5%"`, mesma regra de casas decimais.
  - `formatEdge` → `"+7,3"`.
  - `formatEvPct`: o caso "0.0" vira `"0,0%"`.
  - `formatLine(2.5)` → `"2,5"`.
  - `formatUnits(n, { signed, decimals })` → `"+1,50 u"`.
  - `formatUnitsCompact(n)` → `"0,5u"` / `"1u"` (o formato compacto que já existe, só com vírgula).
- `lib/format.ts` reexporta as funções de `format-number`, então os imports atuais de `lib/view` não mudam. `formatUnitsSigned` e `formatStakeUnits` passam a usar `formatUnits`. `formatCostUsd*` continua com ponto (admin, em US$).
- Componentes de cliente (`bet-slip.tsx`, `friend-pool-forms.tsx` e `bankroll-line-chart.tsx` têm `"use client"`) importam direto de `@/lib/format-number`, nunca de `@/lib/format` (que puxa `lib/ai/engine/analysis-engine`).
- Trocar as soluções avulsas pelos formatadores. Em `components/bet-slip.tsx`, `ptOdd` vira `formatOdd`. `userOddLabel` (linha 72) mantém as casas que o usuário digitou e só troca o separador. A linha 687 passa a usar `formatPct(…, { decimals: 1 })`. `lib/view/friend-pool.ts` e `components/friend-pool-forms.tsx` usam `formatLine`. `app/(app)/apostas/page.tsx:163` usa `formatUnitsCompact` e `:174` usa `formatOdd`. `bankroll-line-chart.tsx` usa `formatUnits` no `signed` e `formatDecimal` no `tickFormatter` do eixo Y. `lib/view/bet-slip.ts:233,288` usam `formatUnitsCompact` (mantém "0,5u", sem virar "0,50 u"). `lib/view/sections.ts:114-115` usa `formatDecimal(avg, 1)`. `marketContextLabel` usa `formatLine`.
- Linhas de gol no cupom: em `lib/view/bet-slip.ts`, `groupTitle` ("Total de gols 2,5"), `buttonLabel` ("Mais de 2,5") e `slipLegLabel` passam a usar `formatLine`. O mesmo vale para `lib/view/free-bet.ts` `betLegLabel`, que só alimenta a tela: `/apostas` e o chip de `app/actions/bets.ts:128` (não é gravado no banco).
- Correções obrigatórias (a troca de separador cria os bugs):
  - `lib/view/analysis.ts:385`: comparar na precisão de exibição com números, sem passar pela string: `Math.round(minOddNum * 100) > Math.round(oddAtRecNum * 100)`.
  - `lib/view/analysis.ts:394`: trocar `!== "0.0%"` por um teste numérico (`Math.abs(evPerUnit * 100) >= 0.05`), ou comparar com a constante exportada de `format-number`. Não deixar literal de string com ponto.
  - `components/analysis-scenarios.tsx:36-40` `parsePct`: hoje funciona, mas com a vírgula `Number.parseFloat("58,5%")` devolve 58 e perde a fração (só afeta mercados com mais de 5 colunas, como placar exato). Trocar a vírgula por ponto antes de converter, ou levar o número cru na view.
- **Fora do escopo** (anotar no PR): `presentation.outcomeLabel` ("Over 2.5"), porque também vai para o texto do modelo e o renome é da linha 16 (glossário, PR 2). `lib/user-palpite/reading.ts` (`ptPct`, ver acima). Os números fixos de `/como-funciona` também ficam de fora, porque a página é reescrita na linha 25. Telas de admin (`calibration`, `team-ratings-panel`) também ficam de fora.

**Testes.**
- `lib/__tests__/format-number.test.ts` novo: vírgula, sinal ASCII, `0,0%`, `formatLine(1.5|2.5|3)`, `formatUnits`, `formatUnitsCompact(0.5|1|1.25)`, e "—" em null/NaN.
- Atualizar `lib/format.test.ts` e as expectativas com ponto. Cerca de 30 a 40 arquivos: `lib/view/*.test.ts`, `lib/view/__tests__/*`, `components/__tests__/{analysis-result,analysis-scenarios,market-analysis-section,odds-card-nway,match-odds-cards,match-model-reading,market-segments,upcoming-matches}`, os inline snapshots de `odds-card-parity.golden` (rodar com `vitest -u` só nos goldens e revisar o diff) e `lib/odds/scenario.test.ts:95-96`.
- **Asserções negativas com ponto viram vazias** depois da troca e passam sem testar nada. Exemplo: `components/__tests__/desktop-live.test.tsx:77-78` (`not.toContain("1.85")`). Rodar `grep -rnE 'not\.toContain\("[^"]*[0-9]\.[0-9]' components lib app` e converter cada uma para vírgula.
- Teste de `parsePct` com "58,5%".
- `lib/view/analysis.test.ts`: um caso com mínima acima da odd registrada (o aviso aparece) e um com EV que arredonda a zero (tom neutro), já com a saída em vírgula.
- Não alterar fixtures de entrada que imitam o numeric do Drizzle ("1.92" como entrada). Só mudam as saídas.

**Riscos.** Muito churn de teste. Os únicos lugares que convertiam a string formatada de volta são os três listados acima (`grep` de `Number(format`, `parseFloat` e comparação com literal `"0.0%"` em `lib`, `app` e `components`); repetir o grep no fim. A imagem OG (`components/palpites/__tests__/og-palpite-image.test.tsx`) pode mudar.

---

## Linha 4: textos com "casa" e rótulos 1X2 com o nome do time

### 4a. Textos (troca direta)
| Arquivo:linha | Hoje | Novo |
|---|---|---|
| `components/match-model-reading.tsx:55` | "compare com a odd da sua casa." | "compare com a odd de mercado." |
| `app/landing-content.tsx:36` | "compara a IA com a casa" | "compara a IA com as odds de mercado" |
| `app/como-funciona/como-funciona-content.tsx:20` | "compara as odds da casa" | "compara as odds de mercado" |
| `…como-funciona-content.tsx:26` | "Você aposta por fora, na casa, com seu próprio dinheiro; o dinheiro…" | "As apostas são entre vocês; o app só anota e faz a conta. O dinheiro…" |
| `…:85` (texto do link `#overround`) | "margem da casa" | "margem embutida na odd" |
| `…:124` e `…:216` | "Odds da casa:" | "Odds de mercado:" |
| `…:136` | "(margem da casa)" | "(margem embutida na odd)" |
| `…:189-247, 251, 320-345` (exemplo do 1X2 e da dupla chance) | casa / fora como seleção | mandante / visitante ("mandante 2.10 / empate 3.40 / visitante 3.60", "recomenda mandante", "mandante ou empate"…) |
| `…:557` | "casa de cada termo do app" | "o significado de cada termo do app" |
| `app/(app)/como-usar/como-usar-content.tsx:155` | "(casa / empate / fora, ou over / under) quando a casa já publicou" | "(mandante / empate / visitante, ou mais / menos gols) quando o mercado já tem odd" |
| `components/odds-card.tsx:102` | "descontada a margem da casa" | "descontada a margem embutida na odd" |
| `components/odds-card.tsx:118` | "A margem embutida pela casa." | "A margem embutida na odd." |
| `components/analysis-scenarios.tsx:249` | "descontada a margem da casa" | "descontada a margem embutida na odd" |
| `components/help/glossary.ts:113,116,141,144,312` | "casa, empate e fora" / "casa ou empate…" | "mandante, empate e visitante" / "mandante ou empate, empate ou visitante e mandante ou visitante" |
| `components/help/glossary.ts:152` | "**na casa (Betano etc.)**" | "As apostas são entre você e seus amigos; o app só anota e faz a conta. O app não movimenta dinheiro nenhum." (nome de casa removido) |
| `components/help/glossary.ts:159,175` | "margem da casa" / "pela casa" | "margem embutida na odd" |
| `components/help/glossary.ts:197` | "compare com a odd da sua casa" | "compare com a odd de mercado" |
| `components/help/glossary.ts:216` | "Se a casa baixar abaixo disso" | "Se a odd de mercado cair abaixo disso" |
| `components/help/glossary.ts:223` | "A casa pode ter mudado depois — por isso o card de odds atuais…" | "A odd de mercado pode ter mudado depois — por isso o card de odds…" |
| `lib/tour/steps.ts:89` | "Fez uma aposta na sua casa?" | "Fez uma aposta com os amigos?" |
| `lib/tour/steps.ts:93-94` | "Odds da casa" / "das casas" | "Odds de mercado" / "As odds de mercado pra este jogo." |
| `components/bet-slip.tsx:565` | `title="… (sem margem de casa)"` | `title="odd justa pelo modelo (sem margem)"` |
| `components/bet-slip.tsx:763` | "A odd única que a casa paga pelas N seleções juntas." | "A odd única da combinada, pras N seleções juntas." |
| `components/match-hero.tsx:93` | `role="casa"` | `role="mandante"` |
| `components/match-sections-auxiliary.tsx:139,175` | "casa" / "visitante" | "mandante" / "visitante" |
| `components/palpites/palpite-hero.tsx:584` (placeholder) | "o time da casa está sem…" | "o mandante está sem…" |
| `app/(app)/admin/predictions/[id]/override-form.tsx:48` | "gols casa (90')" | "gols mandante (90')" |

**Não mexer.** "Não é casa de apostas" (avisos legais em `site-footer`, `layout.tsx` metadata, termos, privacidade, `lib/view/share/disclaimer.ts`, landing:57, como-funciona:608). Isso é negação, e os testes legais exigem o texto. Também ficam: `lib/ai/**` (prompts), `lib/view/markets/public-category.ts` (normalizador da resposta do modelo), comentários e "fonte: the-odds-api" (`components/odds-card.tsx:47`, fornecedor de dados, não casa). `app/termos/page.tsx:117-120` diz que "o nome de uma casa" pode aparecer como fonte da cotação, o que já não acontece; é texto legal (ADR 0048), então só anotar como follow-up no PR, sem mexer aqui. "Time da casa" em `palpite-hero.tsx:584` é português correto e não casa o teste de guarda; troca por "mandante" só pela consistência com o resto da tela.

### 4b. "Casa/Empate/Fora" vira o nome do time nas grades
**Restrição.** `presentation.ts` (`MATCH_RESULT_SELECTION_LABELS`, `DOUBLE_CHANCE_SELECTION_LABELS`) espelha o seed (`market_selections.label`, preso por `presentation-seed-parity.pglite.test.ts`). `outcomeLabel` é lido por `lib/ai/palpites/synthesis-input.ts:123`, que vai para o modelo. **Não alterar a presentation.**

**Conferido.** `lib/view/analysis.ts` só prefere o `label` do banco em mercados `dynamicSelections` (artilheiro, `analysis.ts:344-346,404-405`); em 1X2 e dupla chance o rótulo sai da presentation (`analysis.ts:306`), então envolver a presentation basta. `recommendationLabel` também usa a presentation antes do `market_selections.label` do banco ("Casa"), então o mesmo vale lá.

**Mudança.**
- Novo `lib/view/markets/with-team-labels.ts` (não `team-labels.ts`: já existe `lib/view/team-labels.ts`, com `displayTeamName` e teste próprio), puro, com `withTeamLabels(p: MarketPresentation, teams: {home: string; away: string}): MarketPresentation`. Devolve um objeto novo; nunca muta a presentation do registry. Para `match_result`: home vira `teams.home`, away vira `teams.away` e draw continua "Empate". Para `double_chance`: "`${home} ou empate`", "Empate ou `${away}`", "`${home} ou ${away}`", as mesmas frases que a grade de apostas já usa (`lib/view/bet-slip.ts:52-58`). Isso vale em `selectionLabel`, `outcomeLabel`, `scenarioLabel`, `framingLabel` e `betSummary.market`. Os outros mercados passam direto.
- Passar `teams?` (opcional, último parâmetro) pelas funções abaixo. Sem `teams`, a saída fica idêntica byte a byte, então os testes atuais continuam válidos.
  - `lib/view/odds.ts`: `toNwayOddsView(snapshot, marketKey, now, teams?)` e `toMatchRowResultOdds(snapshot, marketKey, teams?)`.
  - `lib/view/match-model.ts`: `toMatchModelLineView(snapshot, teams?)` e `toMatchModelReadingView(snapshot, now, teams?)`, através de `lib/model-base/reading.ts` (`loadMatchModelReading({…, teams})`).
  - `lib/view/match.ts` `toMatchRowView`: passar `{home: home.short, away: away.short}` (sigla de 3 letras de `teamToTeam`) para o chip de odds (linha 95) e a linha do modelo (linha 115), porque a coluna é estreita. Resultado: "PAL 2,67 · Empate 2,87 · FLA 3,06" e "Modelo · PAL 42%".
  - `lib/view/analysis.ts`: `toAnalysisView`, `toAnalysisViewFromPrediction`, `toMarketAnalysisSections` e `toPreviousAnalysisItems` recebem `teams?`, aplicado onde a presentation é resolvida (linha 306). Os rótulos dinâmicos de jogador continuam com prioridade.
  - `lib/view/best-bet.ts` `toBestBetView(…, teams?)`, repassado ao `toAnalysisView` da linha 119.
  - `lib/view/recommendation.ts` `recommendationLabel(rec, marketKey, selectionLabel, teams?)`. Tabela do dashboard (`lib/view/dashboard.ts:192`) e feed de recentes (`lib/view/recent-prediction.ts:62`, que já usa `.short`) passam a sigla. O detalhe do dashboard (`dashboard.ts:335`) não é lista apertada e passa o nome de exibição (`teamToTeam(...).name`).
- Chamadas que **faltavam** no rascunho e devolvem a análise recém-feita ao cliente (sem elas o resultado aparece com "Casa" até recarregar a página):
  - `app/actions/predictions.ts:320` (`analyzeMatch`, `toAnalysisView`).
  - `app/actions/predictions.ts:784` (`analyzeBestBet`, `toBestBetView`).
  - Nas duas, `match` já está carregado (linhas 247 e 582). Usar o nome de exibição: `teamToTeam(match.homeTeam, leagueToKey(match.league)).name`.
- Na página do jogo (`app/(app)/match/[id]/page.tsx`) usar o nome de exibição. `oddsP` é criado na linha 140 e `heroView` só na 215, então **não** dá para ler de `heroView`. No topo, logo depois de `now`, montar `const leagueKey = leagueToKey(match.league)` (subir a linha 260) e `const displayTeams = { home: teamToTeam(match.homeTeam, leagueKey).name, away: teamToTeam(match.awayTeam, leagueKey).name }`. Passar em `toNwayOddsView(matchResultSnapshot, "match_result", undefined, displayTeams)` (linha 160), `toMarketAnalysisSections` e `toPreviousAnalysisItems` (237-246) e `loadMatchModelReading` (287). Não confundir com `teams` (linha 295, nomes canônicos usados pela grade de apostas, pelo "Seu palpite" e pelo contexto extra). Na Copa a grade continua com o nome canônico em inglês; fica para a linha 13.
- Nos cards de 3 colunas (`components/odds-card.tsx`), o rótulo da seleção ganha `truncate` e `title` (nomes oficiais longos; o nome curto é a linha 13).

**Testes.**
- `lib/view/markets/__tests__/with-team-labels.test.ts`: 1X2, dupla chance, over/under e btts sem mudança, fallback de key desconhecida, e a presentation original intacta depois da chamada.
- `lib/view/__tests__/odds.test.ts`, `match-model.test.ts` e `match.test.tsx`: casos com `teams` ("PAL"/"FLA"), mais um caso sem `teams` igual ao de antes.
- `lib/view/analysis.test.ts`: um caso 1X2 com `teams` (`selectionLabel` "Palmeiras").
- `lib/view/__tests__/recommendation.test.ts`: `recommendationLabel` com `teams`, inclusive quando o `selectionLabel` do banco é "Casa".
- Teste de `toBestBetView` com `teams` (onde já houver teste dele).
- Ajustar os testes de texto: `components/__tests__/match-model-reading.test.tsx:52`, `components/__tests__/como-funciona-page.test.tsx:59` ("mandante 2.10 / empate 3.40 / visitante 3.60"; os números continuam com ponto, ver linha 15) e `components/tour/__tests__` se fixarem o texto dos passos.
- Novo teste de guarda `components/__tests__/no-bookmaker-copy.test.ts`: lê `.tsx/.ts` de `app/`, `components/`, `lib/tour` e `lib/view`, ignorando `__tests__`, `*.test.*`, `lib/ai`, `app/termos` e `app/privacidade` (texto legal), e ignorando linhas de comentário (as que, depois do `trim`, começam com `//`, `/*` ou `*`). Isso é necessário porque hoje há comentários que casariam: `components/match-model-reading.tsx:9`, `components/bet-slip.tsx:41`, `lib/view/types.ts:87`, `lib/view/match-model.ts:11` e `lib/view/share/source-hardening.ts:18` ("Bet365"). Falha com `/\b(betano|bet365|pinnacle|betfair|sportingbet|superbet|novibet|kto)\b/i` e com `/(odds?|margem) da (sua )?casa|na casa\b|das casas/i`. Testado à mão com `grep`: depois das trocas de 4a, só sobram comentários.

**Riscos.**
- Passar `teams` por várias funções aumenta assinaturas; manter o parâmetro opcional e no fim.
- O formato do `MatchRowView` muda; golden pode precisar de update se o teste passar `matchResultOdds`.
- `public-category.ts` mantém "casa"; é parsing da saída do modelo, então tudo bem.
- O racional escrito pelo modelo pode dizer "casa" ou "mandante" por conta própria; isso é texto do prompt e fica fora.

---

## Linha 5: abas de status do Desempenho estouram a largura no celular

**Arquivo.** `components/dashboard/dashboard-filters.tsx` (`PillGroup`, linhas 70-97).

**Mudança.**
- Wrapper do grupo: `flex min-w-0 max-w-full items-center gap-2`.
- `<nav>`: `inline-flex h-8 max-w-full items-center overflow-x-auto rounded-md … [scrollbar-width:none]`. Rolagem dentro do próprio contêiner.
- Cada `Link`: `shrink-0 whitespace-nowrap`.
- Wrapper da barra (linha 141, `flex flex-wrap items-center gap-x-5 gap-y-3`): acrescentar `min-w-0 w-full`.
- Vale para os três grupos (status, liga, mercado), porque liga pode estourar do mesmo jeito.

**Testes.** `components/__tests__/dashboard-filters-bar.test.tsx`: afirmar que o `nav` tem `overflow-x-auto` e que o link tem `shrink-0`. Rótulos sem mudança (Green/Red continuam; o glossário é da linha 16).

**Riscos.** Em telas largas nada muda. Conferir à mão em 390px que `document.documentElement.scrollWidth` é igual a 390.

---

## Linha 6: placar ao vivo e um selo só

**Dados reais.** `upsertMatchesFromProvider` (`lib/db/queries/matches.ts:190-226`) grava `homeScore`, `awayScore` e `status` de cada fixture, incluindo `live` com o placar parcial do fornecedor. Mas o cron `sync-fixtures` roda **de 6 em 6 horas** (`vercel.json`), e o gatilho preguiçoso de `load-range-matches` fica travado pelo lock de 7h. Na prática:
- a) a maioria dos jogos em andamento está `scheduled`, com placar null (só aparece `isInProgress`);
- b) quando está `live`, o placar é de quando a sincronização rodou, e pode ter até cerca de 2h.

**Decisão do dono.** Mostrar o placar parcial sempre que houver, com a legenda "parcial · atualizado há X". Sem corte por idade. Placar ao vivo de verdade fica para o #580.

**Mudança.**
- `lib/view/types.ts` `MatchRowView`: novo campo opcional `liveScore?: { home: number; away: number; caption: string }`. Não reaproveitar `homeScore`/`awayScore`, que continuam só para `finished`. `app/(app)/match/[id]/page.tsx:352` monta `finalScore` a partir deles e alimenta o recibo de resultado (`score={finalScore}` no `MatchHero`, linhas 532 e 664), o `FinishedNotice` e o `NotAnalyzableNotice` (561, 715). Usar o placar ao vivo ali **liquidaria um placar parcial como final**.
- `lib/view/match.ts` `MatchInput`: novo campo `updatedAt?: Date` (`matches.updatedAt` existe e é regravado a cada sync em `upsertMatchesFromProvider`, `lib/db/queries/matches.ts:211,225`; nenhum outro código faz `update(matches)`). Em `toMatchRowView`, quando `status === "live" && homeScore !== null && awayScore !== null`, espalhar `{ liveScore: { home, away, caption } }` no objeto, como já é feito com `model` (linhas 111-116), para não quebrar os goldens. `caption` = `` `parcial · atualizado ${formatRelativeAgoLabel(updatedAt, now)}` `` ("parcial · atualizado há 2h"). Usar `formatRelativeAgoLabel`, não `formatRelativeAgo`: este devolve "agora" abaixo de 1 minuto, o que daria "atualizado há agora". Sem `updatedAt`, `caption` = "parcial".
- Quem chama passa `updatedAt: m.updatedAt`: `app/(app)/jogos/page.tsx:177-186`, `app/(app)/time/[team]/page.tsx:59-68` e `app/(app)/match/[id]/page.tsx:215-224` (`match.updatedAt`). Todas leem a linha inteira de `matches` (`DbMatch`), então o campo já vem.
- `components/match-row.tsx` (celular):
  - Mantém o `LiveBadge` no topo (linhas 70-80).
  - Na coluna da direita (linhas 101-108), troca o "ao vivo" duplicado pelo placar parcial `H–A` com a `caption` embaixo (mesmo estilo da legenda "encerrado") quando houver `liveScore`. Sem `liveScore`, mostra "—" (`text-muted-fg-2`), sem segundo selo.
- `components/upcoming-matches-desktop.tsx:84-91` (desktop): mesma troca. A célula de odds mostra o placar parcial com a `caption` ou "—", e o `LiveBadge` fica só no `DesktopStatusCell`.
- `components/match-hero.tsx`: **sem prop nova.** `MatchHeroView` é `Omit<MatchRowView, "model">` (`lib/view/types.ts:77`), então `view.liveScore` já chega pelo `heroView`, e a página não muda. Quando não há `score` (final) e há `view.liveScore`, mostrar o placar parcial no lugar de "vs" com a `caption` no lugar de "encerrado". A legenda "encerrado" (linhas 107-111) continua presa ao `score` final.
- `/como-usar:156-157` ("<Ui>AO VIVO</Ui> nos que estão rolando e o placar nos encerrados") vira "… <Ui>AO VIVO</Ui> e o placar parcial (quando já temos) nos que estão rolando…".

**Testes.**
- `lib/view/__tests__/match.test.tsx`: `live` com placar vira `liveScore` e `homeScore` continua null. `caption` com `updatedAt` 2h antes ("parcial · atualizado há 2h"), com 30s ("parcial · atualizado há menos de 1min") e sem `updatedAt` ("parcial"). `scheduled` com `isInProgress` não tem `liveScore`. `postponed` e `cancelled` com placar não têm `liveScore`. `finished` não muda.
- `components/__tests__/desktop-live.test.tsx`: "AO VIVO" aparece **uma vez por linha**. Atualizar o comentário da linha 73 ("célula de odds + célula de status"). Placar parcial e "parcial" aparecem. Trocar as asserções `not.toContain("1.85")`/`("1.95")` para vírgula (ver linha 15).
- Teste equivalente para `MatchRow` (celular).
- `components/__tests__/match-hero-live.test.tsx`: placar parcial e "parcial", sem "encerrado".

**Riscos.** O placar parcial pode ter horas (o cron `sync-fixtures` roda de 6 em 6 horas); a legenda deixa isso explícito, por decisão do dono. O placar ao vivo de verdade é o #580.

---

## Linha 7: "Odds atuais" em jogo ao vivo ou encerrado

**Arquivos.**
- `components/odds-card.tsx:57`: o título vira `unavailable ? "Odds antes do jogo" : "Odds atuais"`. `unavailable` não nulo quer dizer started, live, finished, postponed ou cancelled. "atualizado há X" continua.
- `components/match-odds-cards.tsx:27`: o card 1X2 hoje **não recebe** `unavailable`. Passar `unavailable={unavailable}`.
- `components/help/glossary.ts:223`: "card de odds atuais" vira "card de odds".
- `app/(app)/como-usar/como-usar-content.tsx:234`: "as odds atuais" vira "as odds (antes do jogo, quando ele já começou)". Não está na lista de rótulos do teste.

**Testes.** `components/__tests__/odds-card-nway.test.tsx` e `match-odds-cards.test.tsx`: com `unavailable="live"`/`"finished"` aparece "Odds antes do jogo"; com null, "Odds atuais"; o card 1X2 também recebe.

**Riscos.** Nenhum relevante. O alvo do tour `odds` é o wrapper da página e não muda.

---

## Linha 8: nome do jogo por cima do selo da liga

**Arquivo.** `components/dashboard/predictions-table.tsx:92-100`. `TableCell` tem `whitespace-nowrap` (`components/ui/table.tsx:84`), então o `max-w-[220px]` do `<td>` não corta.

**Mudança.** No `Link`, `className="block max-w-[220px] truncate …"` e `title={`${r.home} × ${r.away}`}`. Tirar `max-w-[220px]` do `TableCell` ou manter os dois. Opcional: pôr a liga em `shrink-0`.

**Testes.** O teste do componente (se existir) afirma `truncate` e `title`. Sem golden afetado.

**Riscos.** `text-[…]` arbitrário não entra; `max-w-[220px]` já existia.

---

## Linha 9: placar do bolão quebra no celular

**Arquivo.** `components/friend-pool-forms.tsx`: `AddEntryForm` (linhas 231-252) e `ManualScoreForm` (linhas 298-319). Os dois usam `flex flex-wrap`.

**Mudança.**
- Extrair no mesmo arquivo `ScoreInputsRow({homeTeam, awayTeam, defaults?, required?})` com `grid grid-cols-[minmax(0,1fr)_3.5rem_auto_3.5rem_minmax(0,1fr)] items-center gap-2`.
- Time da casa: `truncate text-right text-body-sm` com `title`. Campo `w-14`. "×". Campo. Time de fora: `truncate text-body-sm` com `title`.
- Manter `name`, `aria-label`, `pattern` e `maxLength` iguais.

**Testes.** `components/__tests__/friend-pool-forms.test.tsx`: as buscas por `name`/`aria-label` continuam passando. Acrescentar: os dois campos e os dois nomes ficam dentro do mesmo contêiner `grid`.

**Riscos.** Nome muito longo fica truncado. Aceitável, porque o `title` mostra o nome inteiro e a linha 13 traz o nome curto.

---

## Linha 10: página do time mostra "sem odd"

**Arquivo.** `app/(app)/time/[team]/page.tsx:57-74` passa `odds: null`.

**Mudança.**
- Depois de `getMatchesByTeam`, com `ids = future.map(m => m.id)` (os passados estão encerrados e não mostram odd), fazer `Promise.all` de `getLatestOverUnderSnapshotsForMatches(ids)` e `getLatestSelectionOddsSnapshotsForMatches(ids, "match_result")` (`@/lib/db/queries/odds-snapshots`), igual a `app/(app)/jogos/page.tsx:144-146,187-198`.
- Em `toRow`, passar `odds` e `matchResultOdds` como em jogos.
- Não criar helper novo: as duas queries já moram em `lib/db/queries/odds-snapshots.ts`; a página só as combina, como `/jogos`.
- Passar também `updatedAt` (linha 6).
- Erro de leitura das odds deve degradar para mapas vazios (`.catch`), sem derrubar a página.

**Testes.** Se existir teste da página do time, cobrir que a linha recebe odds. Se não, um teste do helper com mocks no padrão de `lib/db/queries/__tests__`.

**Riscos.** Mais duas queries em lote (sem N+1, sem chamada externa). Sem alvo de tour.

---

## Linha 11: id de depuração "match · xxxx" no celular

**Arquivo.** `app/(app)/match/[id]/page.tsx:517-522`. Remover o `<span>` "match · {matchId.slice(0, 8)}" e o `<div className="flex items-center gap-3">` que só existia para agrupar os dois; fica `{unavailableReason === null && <PoolLink matchId={matchId} />}`, igual ao desktop (linha 653). `grep -rn "match · " app components` só acha essa linha.

**Testes.** Se algum teste procurar "match ·", trocar por `not.toContain`.

**Riscos.** Nenhum.

---

## Linha 12: 404 próprio em português e CSP

**Diagnóstico.**
- O middleware (`middleware.ts` e `lib/security/gated-response.ts`) manda CSP com `nonce` e `'strict-dynamic'` em toda rota protegida, inclusive URLs que não existem.
- O `/_not-found` padrão do Next sai **estático no build** (sem nonce no HTML). Com `'strict-dynamic'`, o browser bloqueia todos os scripts: não hidrata, o menu da conta não aparece e o tema não se aplica (o print `notfound-md.png` saiu claro e sem cabeçalho).
- Isso foi aceito de propósito em `lib/security/gated-routes.ts:18-27` (`STATIC_GATED_ALLOWLIST = ["/_not-found"]`), com o argumento de que o 404 "continua legível sem JS". O print mostra que o custo é maior: cabeçalho de deslogado e tema errado.
- A root layout (`app/layout.tsx`) não lê `headers()`/`cookies()` (de propósito, para `/` e as páginas legais continuarem estáticas; ver o comentário de `THEME_SCRIPT_HASH` em `lib/security/csp.ts:46-55`). Por isso o `/_not-found` sai estático hoje.
- Hoje existem `not-found.tsx` só em `app/(app)/match/[id]`, `app/(app)/bolao/[id]` e `app/p/[id]`.
- `notFound()` chamado em `/time/[team]`, admin de usuário e de predição sobe até a raiz, onde não há `not-found.tsx`.

**Mudança.**
1. Novo `app/not-found.tsx`, componente de servidor:
   - `<AppShell>` (lê a sessão, então mostra o cabeçalho certo, logado ou "entrar", e torna a rota dinâmica).
   - Por dentro, o mesmo cartão de `app/(app)/match/[id]/not-found.tsx`: eyebrow "404", título "Página não encontrada", texto "O endereço pode estar errado ou a página saiu do ar.", botão "Ir para os jogos" (`/jogos`).
   - `metadata = { title: "Página não encontrada" }`. O root `not-found` aceita `metadata` e o Next já injeta `noindex` em resposta 404, então `robots` é desnecessário.
   - Para garantir render dinâmico mesmo que o `AppShell` mude: `await connection()` (`next/server`, disponível no Next 15.5.18 instalado) no topo, com a função `async`. Hoje o `AppShell` já tornaria a rota dinâmica: `readViewer` chama `unstable_rethrow` (`components/app-shell.tsx:52`), que deixa o erro de uso dinâmico subir no build. O `connection()` só torna isso explícito.
   - Viabilidade: a doc do Next 15 mostra o root `not-found` como componente `async` lendo `headers()`, ou seja, renderizado por requisição. Continua obrigatório confirmar no `pnpm build` (passo 4).
2. `lib/security/gated-routes.ts`: **remover** `/_not-found` de `STATIC_GATED_ALLOWLIST` (o array fica vazio; manter o export) e atualizar o comentário. Assim `scripts/check-csp-prerender.ts` derruba o build se o 404 voltar a ser estático.
3. `lib/security/gated-routes.test.ts:46-50` ("o 404 default fica liberado de propósito"): inverter o caso. A allowlist fica `[]` e `findStaticGatedRoutes(["/_not-found"], isGated)` passa a devolver `["/_not-found"]`.
4. **Verificação obrigatória:**
   - `pnpm build`: a tabela de rotas mostra `ƒ /_not-found` e `check-csp-prerender` passa.
   - `pnpm start`, entrar logado e abrir `/nao-existe`: sem erro de CSP no console, cabeçalho com avatar, tema aplicado, status 404.
   - Testar também `/time/xyz` (o `notFound()` dentro de rota dinâmica cai no mesmo componente, sem cabeçalho duplicado: o boundary da raiz substitui o layout de `(app)`).
   - Se o Next 15 recusar render dinâmico no `/_not-found`, alternativa: deixar a página estática, sem JS e sem `AppShell` (cabeçalho só com `Wordmark` e um link "Ir para os jogos"), manter a allowlist e documentar. Funciona sem script. Nesse caso o tema continuaria no padrão; anotar.

**Testes.**
- `app/__tests__/not-found.test.tsx`: renderiza o conteúdo (extrair `NotFoundContent` síncrono, como `ComoFuncionaContent`) e confere "Página não encontrada" e `href="/jogos"`.
- `__tests__/app-shell-coverage.test.ts` só olha `page.tsx`, então não muda.
- Ajustar `gated-routes.test.ts`.

**Riscos.** Todo 404 passa a custar um render no servidor; o dono aceitou. Bots que varrem URLs só chegam aqui com sessão, porque sem sessão o middleware redireciona para `/signin`, então o impacto é baixo. Depende do comportamento do Next 15; confirmar no build.

---

## Linha 28: avatar, tema do sistema, cores do gráfico e datas repetidas

### 28a. Avatar "FE"
`components/nav/account-menu.tsx:25-28` `initialsFrom("Fernando Lisboa")` remove tudo que não é `[a-zA-Z]`, junta as palavras e devolve "FE". Também apaga acentos ("Érica" vira "RI").

**Mudança.**
- Mover para `lib/view/initials.ts`, puro: `userInitials(label)`.
- Se for e-mail, usar a parte antes do `@` e quebrar em `[._-]+`. Se não, quebrar em espaços.
- Ficar com tokens que têm `\p{L}` (flag `u`).
- Com 2 ou mais tokens, inicial do primeiro e do último ("Fernando Lisboa" → "FL"). Com 1 token, as duas primeiras letras ("fernando" → "FE"). Sem token, "??".
- `toLocaleUpperCase("pt-BR")`.
- `account-menu` importa de lá e `initialsFrom` some (o único uso é `account-menu.tsx:38`; nenhum teste o importa).

**Testes.** `lib/view/__tests__/initials.test.ts` com nome composto, e-mail `fernando.lisboa@…`, nome acentuado, vazio.

**Nota.** Se a conta tem `name = null`, o rótulo é o e-mail (`components/app-shell.tsx:46`), e "fernandoigorlisboa@…" continua virando "FE". Isso é esperado.

### 28b. Tema ignora o sistema
`lib/theme.ts`: `defaultTheme: "dark"` vira `"system"`. `THEME_SCRIPT` passa a usar `localStorage.getItem("theme")||"system"`; o ramo `system` já existe.

**Obrigatório:** recalcular `THEME_SCRIPT_HASH` em `lib/security/csp.ts:56-57`. É o único lugar com o hash (`grep` confirmou). `lib/security/csp.test.tsx:43-52` recalcula e mostra o valor certo quando falha. `lib/theme.test.ts` compara com o script original do next-themes usando as props: o caso da linha 31 ("nada salvo → default dark", com sistema claro) passa a esperar `light` e muda de nome; acrescentar "nada salvo e sistema escuro" → `dark`.

`components/theme-toggle.tsx` pode ficar como está (só alterna claro e escuro). Efeito colateral aceito: depois do primeiro clique, o tema fica fixo e não volta a seguir o sistema.

**Risco.** Se o hash não for atualizado, a CSP bloqueia o script anti-flash nas rotas protegidas e a tela pisca. O teste pega. Quem usa o sistema em claro passa a ver o tema claro, cujo contraste está ok (a linha 2 trata do escuro).

### 28c. Cores do gráfico mudam entre temas
`app/globals.css:193-197`: `.dark --chart-1..5` são os valores padrão do shadcn (azul 264, verde 162…). O `:root` usa a rampa laranja → âmbar → azul-petróleo do DESIGN.md.

**Mudança (valores aprovados pelo dono).** Em `.dark`, usar os mesmos matizes do `:root` (`app/globals.css:116-120`) com luminosidade ajustada para fundo escuro:
- `--chart-1: oklch(0.70 0.19 41.116)`
- `--chart-2: oklch(0.70 0.118 184.704)`
- `--chart-3: oklch(0.62 0.08 227.392)`
- `--chart-4: oklch(0.83 0.17 84.429)`
- `--chart-5: oklch(0.77 0.17 70.08)`

Hoje o único consumidor é `bankroll-line-chart.tsx:103,106` (`--chart-1`). Conferir à mão contraste de 3:1 ou mais do traço sobre `--card` escuro (`oklch(0.195 0 0)`). Sem teste novo.

### 28d. Datas repetidas no eixo X
`computeBankrollSeries` (`lib/dashboard/kpis.ts:408`) gera um ponto por liquidação, e `formatTick` repete o dia.

**Mudança.**
- Novo `lib/view/chart-ticks.ts`, puro: `dayTicks(points: {t: string}[], timeZone?: string): string[]`. Devolve o `t` do primeiro ponto de cada dia civil no fuso.
- Mover `formatTick` (`bankroll-line-chart.tsx:25-38`) para lá, exportado, com o `MONTH_ABBR_PT` local. Não importar `lib/format`: o gráfico é `"use client"` e `lib/format` puxa `lib/ai/engine/analysis-engine`.
- `bankroll-line-chart.tsx`: `<XAxis ticks={dayTicks(data, timeZone)} …>`. Manter `minTickGap`. Série e tooltip não mudam.

**Testes.** `lib/view/__tests__/chart-ticks.test.ts`: três pontos em 03/10 e dois em 04/10 (fuso São Paulo) dão dois ticks; virada de dia por UTC versus fuso local.

**Risco.** Com muitos dias, o `minTickGap` do recharts ainda filtra. Nenhum dado muda.

---

## Checklist de `/como-usar` e do tour
- `como-usar-content.tsx:155` (linha 4), `:156-157` (linha 6) e `:234` (linha 7). Nenhum dos rótulos da lista do teste muda: "Registrar apostas", "Suas apostas" e "Resultado" continuam existindo na tela.
- `lib/tour/steps.ts`: só muda texto (passos `bet-slip` e `odds`). Nenhum `target` muda.
- Alvos `data-tour` que ficam: `match-row` (`match-row.tsx:49`, `upcoming-matches-desktop.tsx:54`), `odds` (`page.tsx:566,689`), `bet-slip`, `palpite`, `seu-palpite`, `match-stats`.

## Critério de saída
`pnpm test`, `pnpm lint` e `pnpm typecheck` verdes. `pnpm build` verde, com `ƒ /_not-found` e o check de CSP passando. Conferência manual em 390px e 1440px, claro e escuro:
- sem rolagem horizontal em `/dashboard`;
- tabela do dashboard sem texto sobreposto;
- placar do bolão numa linha só;
- `/time/<x>` com odds;
- jogo ao vivo com um selo só e, quando houver placar, "parcial · atualizado há X";
- análise recém-feita (sem recarregar) já com o nome do time no 1X2;
- "Odds antes do jogo" em jogo ao vivo e encerrado;
- `/nao-existe` com JS funcionando;
- avatar "FL";
- tema seguindo o sistema;
- eixo do gráfico sem data repetida;
- `grep -rni "casa" app components lib/tour lib/view` sem nada na tela além dos avisos "Não é casa de apostas", do texto legal de termos/privacidade e do `public-category` interno;
- aviso "a odd registrada estava abaixo da mínima" ainda aparece quando deve (regressão silenciosa possível da linha 15).

### Arquivos críticos para a implementação
- lib/format.ts (mais o novo lib/format-number.ts) e lib/view/analysis.ts:385,394
- lib/view/match.ts (mais lib/view/types.ts, components/match-row.tsx, components/upcoming-matches-desktop.tsx, components/match-hero.tsx)
- lib/view/markets/presentation.ts (só leitura; o novo lib/view/markets/with-team-labels.ts envolve ela) e lib/view/odds.ts, lib/view/match-model.ts, lib/view/analysis.ts, lib/view/best-bet.ts, lib/view/recommendation.ts
- app/(app)/match/[id]/page.tsx e app/actions/predictions.ts (`analyzeMatch`, `analyzeBestBet`)
- lib/security/gated-routes.ts (mais o novo app/not-found.tsx, lib/theme.ts, lib/security/csp.ts)
- components/help/glossary.ts

## Revisão do plano

Revisão adversarial contra o código em `46c389d`. O que mudou e por quê:

1. **Linha 15, dois bugs novos que o rascunho não via.** `lib/view/analysis.ts:385` faz `Number(formatOdd(…))` e `:394` compara com `"0.0%"`. Com a vírgula, o aviso de odd abaixo da mínima sumiria e o EV zero ganharia tom positivo, sem nenhum teste quebrar. Entraram como correções obrigatórias, com teste.
2. **Linha 15, `ptPct` fora.** `lib/user-palpite/reading.ts` alimenta `lib/ai/user-palpite/{fallback,narrate-cartridge}.ts` (texto do modelo) e já sai com vírgula. Trocar por `formatPct` ligaria o formatador de tela ao prompt. A frase "nada em `lib/ai` importa" foi corrigida: `lib/ai` importa `lib/format` (só liga) e `lib/view/markets/presentation`.
3. **Linha 15, unidades compactas.** `lib/view/bet-slip.ts:233,288` e `apostas/page.tsx:163` usam "0.5u" sem zeros; `formatUnits` mudaria o visual para "0,50 u". Entrou `formatUnitsCompact`. Também entrou `marketContextLabel` ("Over/Under gols 3.5"), que faltava. Componentes de cliente importam de `format-number`.
4. **Testes, asserções negativas vazias.** `not.toContain("1.85")` passa sozinho depois da troca. Entrou o grep para convertê-las.
5. **Linha 4b, chamadas que faltavam.** `analyzeMatch` (`app/actions/predictions.ts:320`) e `analyzeBestBet` (`:784`, via `toBestBetView`) devolvem a análise nova ao cliente; sem `teams`, o resultado aparece com "Casa" até recarregar.
6. **Linha 4b, ordem na página.** `oddsP` (linha 140) nasce antes de `heroView` (215); o rascunho supunha o contrário. `displayTeams` agora sai de `teamToTeam` no topo.
7. **Linha 4b, nome do arquivo.** `lib/view/team-labels.ts` já existe; o novo vira `lib/view/markets/with-team-labels.ts`, sem mutar o registry e com as frases da grade (`bet-slip.ts:52-58`). Conferido que a presentation chega ao modelo (`synthesis-input.ts:123`, `predict.ts:54`), por isso ela não muda.
8. **Teste de guarda.** Os regex casam com comentários reais (cinco arquivos listados); o teste ignora linhas de comentário e o texto legal de termos/privacidade.
9. **Linha 6, decisões aplicadas.** Placar parcial sempre, legenda "parcial · atualizado há X", sem corte por idade, #580 citado. Legenda via `formatRelativeAgoLabel` (o `formatRelativeAgo` daria "há agora"). `MatchHero` lê `view.liveScore` (`MatchHeroView` = `Omit<MatchRowView, "model">`), sem prop nova e sem mexer nas duas árvores da página. O risco do `finalScore` foi confirmado e detalhado.
10. **Linha 12.** Confirmado: Next 15.5.18, root layout sem API dinâmica (por isso o 404 é estático), `AppShell` com `unstable_rethrow` (já forçaria render dinâmico), doc do Next com root `not-found` `async` lendo `headers()`. `robots` saiu (o Next já põe `noindex` no 404). O teste do `gated-routes` (46-50) é invertido.
11. **Linha 28.** Hash em `csp.ts:56-57` (não 45-46); o caso "nada salvo → default dark" do `theme.test.ts:31` muda de expectativa. `chart-ticks` não importa `lib/format`. Saíram o alias `initialsFrom` e o teste opcional de cores.
12. **Cortes de escopo.** Helper de odds da página do time (as duas queries já estão em `lib/db/queries`), `scrollIntoView` e o teste opcional de cores.
13. **Referências corrigidas.** Wrapper do filtro na linha 141 (não 151), teste em `components/__tests__/dashboard-filters-bar.test.tsx`, coluna direita do `match-row` em 101-108, `/como-usar` 156-157, `gated-routes.ts` 18-27, `friend-pool.ts` 18-20.

**Risco que continua.** (a) Render dinâmico do `/_not-found` só se prova no `pnpm build`; o plano B continua descrito. (b) Na página do jogo da Copa, a grade de apostas segue com o nome canônico em inglês enquanto os cards usam o nome em português (linha 13). (c) Rótulos "Over 2.5" da presentation continuam com ponto até o PR 2. (d) O churn de testes da linha 15 é grande; fazer em commit separado e revisar o diff dos goldens.
