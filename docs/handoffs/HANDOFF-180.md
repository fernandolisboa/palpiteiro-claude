# HANDOFF — #180 CLV (closing line value), última da cauda do pivot

> Doc de continuidade entre sessões. Auto-suficiente, aterrado no código real.
> **Untracked — NUNCA commitar** (como os outros HANDOFF-*.md).

## Onde estamos (2026-06-15)

Pivot multi-mercado (épico **#183**): **NÚCLEO COMPLETO + LIVE**. A cauda fechou
quase toda:

- **#182** (/como-funciona multi-mercado) — MERGED (PR #286).
- **#181** (D10 api-football como provider de odds) — **FECHADO**: ADR **0025**
  (PR #287, recomendação **duplo-provider**; amend PR #291 desescopou
  backtest/teste-gate). Derivou **3 issues AFK** `pos-pivot`, prontas no board:
  - **#288** — seam `OddsProvider` + DTO `NormalizedOdds` + generalizar
    `MarketDescriptor` + doc-fixes. **Ungated, grabbable JÁ.**
  - **#289** — adapter de odds api-football (correct score + artilheiro), G3
    inline. Dep #288.
  - **#290** — ligar os 2 mercados (migration + cartuchos + settlement + flag).
    Dep #289.

**Resta SÓ #180 (CLV).** Quando #180 fechar, **fechar o épico #183** (diretriz do
dono: o épico fecha só quando a cauda inteira fechar — não antes).

## O que é #180 (D8, cravada 2026-06-12)

CLV = odd na recomendação **vs** odd de fechamento (closing line). Métrica
**companheira do Yield** na régua D9 — sinal mais honesto com amostra pequena
(bater o fechamento consistentemente é evidência de edge antes do Yield
convergir). Labels: `feature, pivot, pivot-fase-5` (considerar trocar pra
`pos-pivot` — é backlog deferido, e `pivot-fase-*` são gatilhos de execução; ver
[[pos-pivot-label-only]]).

### Escopo (do corpo do #180)
- Capturar odd de fechamento por mercado/seleção: **snapshot pré-kickoff**.
- CLV por predição (`odd_at_recommendation` vs closing) + agregado **por mercado**.
- Exibição no dashboard segmentado (#171, **já feito**) + detail da predição.

### AC
- [ ] CLV por predição e agregado por mercado no dashboard.
- [ ] Custo de quota medido e documentado (req/mês adicionais).
- [ ] **Sem captura pra predições `pass`** (economia de quota).

## Aterramento no código (ler primeiro)
- `odd_at_recommendation` + `selection_odds_snapshots` **já existem** (é o "quase
  de graça" do schema). `lib/odds/fetch-and-snapshot.ts` é o caminho de snapshot.
- **Quota** é o gargalo: pressiona os **500 créditos/mês da The Odds API** (a
  fonte canônica de edge, ADR 0025 — CLV de Tier 1/2 sai dela). Desenhar com
  **batch por evento, só pra jogos com predição não-pass, perto do kickoff**.
  Featured = batch da liga; additional = 1 crédito/evento (`descriptor.oddsSource`).
- **Forward-capture obrigatório:** nenhum provider dá odds históricas de
  fechamento grátis (achado do ADR 0025 — api-football: retenção 7 dias +
  `coverage.odds` só 2026; The Odds API: arquivo é pago). A closing line tem que
  ser **capturada ao vivo** (poll perto do KO e persistir). NÃO dá pra "buscar" o
  fechamento depois.
- Dependência #171 (dashboard segmentado) **satisfeita**.

## Invioláveis / diretrizes do dono que carregam
- **Sem backtest. Board enxuto. Tudo AFK.** Graduação só por **D9 viva**. Sem
  teste-gate de "quando a competição voltar" — bug se surfaçar ([[no-backtests-lean-board]]).
- Fronteira `lib/providers/` (nunca `fetch` direto); `lib/ai/predict.ts` é a
  única porta pro LLM; output sempre validado por Zod.
- Decisão de produto (rollout, quota, threshold de CLV) → **PERGUNTAR**.

## Landmines de ambiente
- The Odds API `commenceTime` em **segundo-precisão** (sem `.000Z`) — 422 senão
  ([[odds-api-commence-time-no-millis]]); 4xx são grátis na quota.
- Colunas `numeric` do Drizzle voltam **string** — `Number()` na fronteira de view
  antes de qualquer math ([[drizzle-numeric-returns-string]]).
- `pnpm-workspace.yaml` untracked — NUNCA commitar. HANDOFF-*.md/PLAN-*.md fora do commit.
- CI = GH Actions (typecheck+lint+test) em PRs; merge→deploy de prod é o gate de
  migration ([[pr-verification-no-test-ci]]).

## Critério de saída de #180
CLV por predição + agregado por mercado no dashboard + detail; custo de quota
medido/documentado; zero captura pra `pass`. **Depois: fechar o épico #183.**
