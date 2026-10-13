# PLAN-556 — Cupom de apostas no estilo das casas

Issue: #556. Fase 2 da proposta "pré-previsão, bet slip e análise do seu palpite"
(Claude Doc da proposta, seção "Fase 2"). Snapshot de 2026-10-13, base `main` 2ffc027.

## Objetivo

Tirar "Minha aposta" da aba de análise e dar à página do jogo uma seção própria
"Registrar apostas": grade de mercados clicáveis + cupom. Ao registrar, a avaliação
sai na hora, em código, do mesmo modelo de placar da análise (Dixon-Coles com o
heurístico como rede), sem LLM, sem limite diário e sem crédito novo da Odds API.

## Princípios inegociáveis

1. **Um modelo, uma porta.** Toda avaliação do cupom pega o `ModelScoreline` por
   UMA função: `resolveSlipModel(match)` em `lib/bets/slip-model.ts`. Hoje ela é o
   `getModelScoreline` com a tabela (código movido de `confirmBet`). A Fase 1 (ADR
   0052) troca o corpo por `getMatchModelScoreline(matchId)` com fallback pro de
   hoje. `gradeScorelineLeg` e `computeSlipJoint` seguem inalterados.
2. **Sem 1/odd cru como implícita** (CLAUDE.md). Edge só existe contra um snapshot
   COMPLETO do mercado daquela seleção (match_result; over_under na linha da perna;
   btts; double_chance), de-vigado por `computeMarketScenarios` com o
   `impliedSumTarget`/`marketKind` do descriptor. Sem snapshot completo: edge "—".
   EV e break-even usam a odd do usuário crua (correto: é o payout).
3. **Zero chamada à Odds API nova.** A grade lê `selection_odds_snapshots` (DB) depois
   do `ensureOddsSnapshotsFresh` que a página já faz. A action de registro só lê DB.
4. **Envelope legal** (ADR 0034 §12, ADR 0048): botão "Registrar apostas", nunca
   "Apostar"; nada de nome de casa como destino/link; disclaimer §3 completo no cupom
   e na avaliação; veredito descritivo (template por sinal de EV).
5. **Slip imutável.** Registrar cria linhas novas; nada é editado depois.

## Arquivos (novos ↔ alterados ↔ removidos)

### Novos
- `lib/bets/slip-model.ts` — `resolveSlipModel(match)` (a costura da Fase 1).
- `lib/bets/slip-markets.ts` — catálogo PURO da grade: grupos (Resultado, Dupla
  chance, Ambas marcam, Total de gols 1.5/2.5/3.5, Placar exato) → seleções com
  `{ id, kind, params, marketKey, selectionKey, line }` e o mapa perna → (marketKey,
  selectionKey, line) pra achar o snapshot de referência.
- `lib/bets/evaluate-slip.ts` — avaliação PURA: recebe pernas validadas, o modelo,
  as referências (por mercado/linha: odds de todas as seleções + bookmaker +
  capturedAt) e a regra de stake (`kellyActive`), devolve por perna: modelProbPct,
  fairOdd, marketImpliedPct/edgePct (ou null), EV/break-even (se odd), stake sugerido
  (bandas `computeStakeUnits(edge, modelProbPct)` ou `computeKellyStakeUnits` quando o
  gate está ativo), source; e, em modo combinada, joint/marginais via
  `computeSlipJoint` + EV na odd combinada.
- `lib/quant/simultaneous-kelly.ts` — Kelly simultâneo sobre a matriz do placar:
  maximiza E[log(1 + Σ fᵢ(oᵢ·1[ganhaᵢ] − 1))] com fᵢ ≥ 0, Σfᵢ ≤ 1, por subida de
  gradiente projetada; devolve fᵢ. Uma perna = Kelly clássico (teste). Aplicado com
  ¼ × 100u, arredondado a 0.5u, teto 3u por perna. Só pernas na matriz, com odd e EV>0.
  Mostrado no cupom em modo Simples com 2+ pernas; rotulado "quarter-Kelly conjunto
  (informativo)" enquanto o gate do Kelly não libera.
- `lib/db/queries/reference-odds.ts` — `getReferenceOddsForMatch(matchId)`: lê a
  última captura completa de match_result, over_under 1.5/2.5/3.5, btts e
  double_chance (best-effort, nunca lança; usa `getLatestSelectionOddsSnapshotsForMatches`).
- `app/actions/bet-slip.ts` — `registerBetSlip(prev, formData)`: Zod fail-closed
  (pernas reusam `ConfirmBetLegSchema` + `stakeUnits` opcional; `mode`
  simples|combinada; `comboUserOdd`/`comboStakeUnits` só em combinada; `rawInput`/
  `parseAiCallId` opcionais), auth/acesso, jogo analisável, limiter `betSlips` uma vez
  por registro, modelo pela costura, referências do DB, `isKellyStakingActive()`,
  avaliação pura, persistência: Simples = 1 slip por perna; Combinada = 1 slip com N
  pernas + joint. Retorna a view da avaliação. `revalidatePath` do jogo e de /apostas.
- `lib/view/bet-slip.ts` — mappers puros: grade (botões com odd de referência ou odd
  justa em cinza) e avaliação (labels, veredito, stake label). Reusa `betLegLabel`,
  textos de valor de `free-bet.ts`.
- `components/bet-slip/BetSlipSection.tsx` (server, async, em `<Suspense>`): espera o
  modelo + odds, monta a view, renderiza o client.
- `components/bet-slip/BetSlip.tsx` ("use client"): grade + cupom. Desktop `lg:grid
  [1fr_320px]` com o cupom `sticky`; celular: barra fixa "Cupom (n)" no rodapé abrindo
  `Sheet` (side bottom). Atalho "digite sua aposta" (usa `parseBet`) que preenche o
  cupom. Clicar numa seleção adiciona; clicar de novo remove; outra seleção do mesmo
  grupo (mercado+linha) substitui. Até 8 pernas em Simples, 4 em Combinada (MAX_LEGS).
- Testes para tudo acima (pure + action com mocks no padrão de
  `app/actions/__tests__`).
- Migration `00NN_bet_slip_cupom.sql` (número gerado por `pnpm db:generate` depois de
  mergear a main), com `IF NOT EXISTS`:
  - `bet_slips.stake_units numeric(5,2)` (stake da combinada) e `bet_slips.mode text`
    ('simples'|'combinada', null em slips antigos).
  - `bet_legs.stake_units numeric(5,2)`, `bet_legs.model_source text`
    ('dixon_coles'|'heuristic'), `bet_legs.reference_odd numeric(6,3)`,
    `bet_legs.market_implied_pct numeric(5,2)`, `bet_legs.suggested_stake_units
    numeric(4,2)`.
- `docs/decisions/00NN-cupom-de-apostas.md` — ADR curto (próximo número livre na
  main; 0052 está reservado pela Fase 1).

### Alterados
- `app/(app)/match/[id]/page.tsx` — remove `MatchAnalysisTabs`/props de grade; a
  análise volta a ser só `NeutralAnalysisDetail`; nova seção `BetSlipSection` (só
  quando analisável) entre a análise e os números do jogo, `data-tour="bet-slip"`.
  Remove a leitura `marketsForAudience` da página (ninguém mais usa).
- `app/actions/bets.ts` — `confirmBet` some (o cupom substitui); `parseBet` fica
  (alimenta o atalho do cupom). O `model` inline vira `resolveSlipModel`.
- `app/(app)/apostas/page.tsx` + `lib/view/` — por perna: chance do modelo, odd,
  retorno esperado, edge (quando gravado), stake, fonte do modelo; stake da combinada.
- `lib/tour/steps.ts` — passo "analysis-tabs" vira "bet-slip" ("Registrar apostas");
  o texto da análise vai pro passo do palpite.
- `app/(app)/como-usar/como-usar-content.tsx` (+ teste) — seção "Registrar e avaliar
  sua aposta" reescrita pro cupom; labels citados batem com a UI.
- `lib/settlement` — nada muda: pernas são as mesmas kinds; status do slip segue
  `deriveSlipStatus` (simples = slip de 1 perna).

### Removidos
- `components/match-analysis-tabs.tsx`, `components/grade-my-bet.tsx`,
  `components/free-bet.tsx` (o render da avaliação migra pro cupom).
- `gradeMyBet` (action) + `lib/view/grade-my-bet.ts` + `GradeMyBetView` e testes,
  se não tiverem outro consumidor (conferir com grep antes).

## Decisões nos pontos em aberto (defaults)

- **Mercados da grade:** todos os de matriz em toda liga (1X2, dupla chance, ambas
  marcam, totais 1.5/2.5/3.5, placar exato). O gate audiência ∩ liga existia porque a
  avaliação chamava o LLM; agora é conta, e o texto livre já aceitava esses mercados
  em qualquer liga pelo modelo. Artilheiro/assistência ficam de fora.
- **Placar exato:** os 6 placares mais prováveis como botões + "outro placar" (dois
  seletores 0–9).
- **Quarter-Kelly:** a decisão do Fernando sobre mostrar sempre segue aberta na
  proposta; no cupom o stake oficial é o da regra do motor (bandas, ou quarter-Kelly
  com o gate pronto), e o quarter-Kelly conjunto aparece como informativo. Reversível.
- **Sem flag de admin:** não há custo novo (LLM/créditos) pra desligar.

## Fora (issues/PRs seguintes)
- Melhor preço entre casas (mexe na captura de snapshots).
- "Explicar com IA" (passa por `lib/ai/predict.ts`, depois da Fase 1).

## Landmines
- `__tests__/app-shell-coverage.test.ts`: nada de página nova fora de `app/(app)/`.
- `lib/tour/__tests__/steps.test.ts`: todo `target` precisa de `data-tour` em `app/`
  ou `components/`.
- `getLatestSelectionOddsSnapshots` LANÇA em captura incompleta; usar o batch
  best-effort.
- Linhas de over/under: o predicado de linha é obrigatório na leitura.
- Dupla chance: `impliedSumTarget = 2` (sem isso o edge sai pela metade); a perna usa
  `home_draw|home_away|draw_away`, o mercado `home_or_draw|home_or_away|away_or_draw`.
- Migrations: preview roda migrate num DB compartilhado — `IF NOT EXISTS`; Fase 1
  também cria migration → regenerar número depois de mergear main.
- Arquivos de outras threads: não tocar `lib/ai/predict.ts`, tabela/cron da base,
  `lib/odds/implied-probability.ts`, `scripts/backtest`.

## Critério de saída
`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` verdes; screenshot local
(Chromium) da grade + cupom no desktop e no celular; CI verde no PR.
