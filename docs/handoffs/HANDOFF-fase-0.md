# HANDOFF — Pivot multi-mercado · FASE 0 (ADRs + docs + validação)

> **Status:** issues criadas (#152–#158); nenhuma linha de feature. Esta fase **não escreve código de feature** — só ADRs, docs e a validação de odds.
> **Pré-requisito:** o lote pré-pivot (`HANDOFF-pre-pivot.md`) deve estar fechado antes (em especial ADR 0020/#115, fix de dashboard #116 e a decisão de modelo #123).
> **Mapa do pivot inteiro:** consolidado na seção **"Mapa do pivot inteiro"** no fim deste doc (mapa de acoplamento por área + restrições + riscos, vindo do antigo `HANDOFF.md`) + épico **#183** (sequência das 6 fases). Os handoffs das Fases 1–5 são escritos just-in-time.
> **Como usar:** auto-suficiente. Sessão de contexto limpo executa cada issue lendo este doc + o corpo no GitHub. Os handoffs das Fases 1–5 serão escritos **just-in-time**, ao fechar a fase anterior (decisão do dono: handoff de fase distante envelhece).

---

## A nova visão (decidida)

Palpiteiro deixa de ser tipster de over/under 2.5 e vira um **motor de seleção de edge multi-mercado**: dada uma partida e um mercado candidato, o LLM emite **UMA recomendação por análise** (mercado + seleção + linha + stake) ou `pass`, com racional auditável e Yield **segmentado por mercado**. Over/under 2.5 vira **o primeiro mercado**, não some, e o tracking de Yield histórico é preservado.

**Princípio transversal (repetir em cada ADR):** o pivot **não é aditivo** — nada de `if (market === X)`. É **expand-migrate-contract** com registries de adaptação por mercado (cartucho de prompt, regra de settlement, seleções). A ajuda `/como-funciona` é **reaproveitada** como a ajuda do mercado over/under, não descartada.

---

## Decisões do dono já cravadas (2026-06-12) — os ADRs devem refletir

| # | Decisão |
|---|---------|
| D1 | **1 recomendação por análise**; "melhor aposta do jogo" depois via fan-out em código (#178) |
| D2 | MVP: **1X2 + over/under multi-linha** (tier-1); **BTTS + Dupla chance** na sequência — cobertura de odds `eu` **validada** (ver #158) |
| D3 | `markets`/`market_selections` como **tabelas de referência + FK** (não enums) |
| D4 | **Híbrido:** colunas tipadas pro agregável; JSONB só pra `market_params` e `result_data`. Nunca profit/result/edge em JSONB |
| D5 | `push` no enum `outcome_result`; half-win/half-loss via `profit_units` fracionário; handicap asiático fracionado **fora** do MVP |
| D6 | **Expand-migrate-contract** com backfill determinístico (sem LLM); Yield histórico preservado |
| D7 | **Staking 1–3u por confiança** — DIVERGE do handoff original (flat 1u); virou ADR 0019 (#156) |
| D8 | CLV: **backlog** (#180) |
| D9 | Go/no-go **por mercado**: ≥30 apostas resolvidas + Yield positivo gradua do feature-flag |
| D10 | Provider de odds api-football: **backlog/ADR** (#181) |

---

## As issues da Fase 0

### ADRs (numerar **0015–0019**; bloco do pivot)

**#152 — ADR 0015: modelo de domínio multi-mercado (supersede ADR 0003)** · `M`
- `markets` (key, label, `settlement_rule_key`, flag de ativação/graduação) + `market_selections` (market FK, key, label, sort_order). `predictions` referencia `market_id` + `selection_id` + `market_params` jsonb.
- Registrar tiers de viabilidade: Tier 1 = 1X2/totals; Tier 2 = BTTS/Dupla chance (odd "additional", validada); Tier 3 = provider novo (corners/cards/correct score/handicap fracionado) — cada um ADR próprio.
- Marcar **ADR 0003 como Superseded** apontando pro 0015. Registrar D1/D2/D3/D4/D6/D9 com razões e alternativas.

**#153 — ADR 0016: settlement por mercado (push/result_data)** · `M` · dep: 0015
- Registry de regras por `market.settlement_rule_key`: funções puras `(selection, market_params, result_data) → { result, profit_units }`. `result_data` jsonb coletado 1x por jogo (MVP: placar 90'). `push` no enum; half via `profit_units` fracionário. Semântica de push no Yield/winRate.

**#154 — ADR 0017: cartuchos de prompt por mercado** · `P` · dep: 0015
- Registry `lib/ai/markets/<key>/`: `{ version, systemPrompt, tool, outputSchema, buildUserMessage, selections }`. SYSTEM_PROMPT-base compartilhado + camada por mercado. Versionamento semver por cartucho. **Passa por `buildAnthropicRequest`** (já market-agnostic) preservando cascata de modelo (ADR 0013), generation-params (ADR 0008) e o tratamento de `tool_missing` no caminho adaptive.

**#155 — ADR 0018: edge/EV/cenários N-vias (emenda ao ADR 0012-cenários)** · `P` · dep: 0015
- Implied sempre normalizada pelo overround do **mercado completo** (Σ `1/odd` sobre TODAS as seleções; nunca `1/odd` cru). Cenários pra N=2/3/N. EV na odd crua (sobrevive). Caem: invariante "100−x pro lado oposto" e "linha 2.5 nunca dá push". **Emendar o ADR 0012-cenários** (bloco "Atualização"). `MIN_EDGE_PP` continua exportado de `lib/odds/scenario.ts`.

**#156 — ADR 0019: staking 1–3u por confiança** · `P` · dep: 0015
- Mapeamento determinístico **em código** (não pelo LLM): bandas de edge/confiança → 1/2/3 unidades. Onde aplica (em `predict()`, congelado). Tradeoff de ruído com amostra pequena. Histórico permanece 1u.

### Docs + validação

**#157 — Reescrever PRD/ARCHITECTURE/CLAUDE.md/README/docs/ops/ER** · `M` · dep: ADRs aceitos
- CLAUDE.md L7 (visão), L65 (versionamento de prompt — exemplo `over_under_v1.2` stale, real é v1.3), L79 (gotcha de edge → generalizar), L87 (regra-portão "mercado novo sem ADR" → vira fluxo suportado pelos ADRs 0015–0019; só Tier 3/provider novo exige ADR adicional).
- PRD L38/L49; ARCHITECTURE L25/L62/L72-73/L83-87; ROADMAP (sem menção literal mas falta a fase do pivot). **Extras achados na verificação:** README L3, `docs/ops/05-legal-compliance.md`, `docs/ops/07-checklist-go-live.md`, `docs/ops/README.md`, `docs/diagrams/er.md`.

**#158 — Validação de cobertura de odds (região `eu`)** · `P` · **PARCIALMENTE FEITA**
- ✅ Em 2026-06-12, com `regions=eu`, `btts` e `double_chance` retornaram odds de Pinnacle/William Hill/1xBet/Matchbook/Codere em 2 jogos da Copa 2026 (custo 4 créditos; restavam 460/500). O medo "additional = só casas US" foi **refutado**.
- ⚠️ **Pendência:** o Brasileirão estava com 0 eventos na API (pausa pela Copa). **Re-rodar os mesmos 2 requests quando o campeonato voltar** e registrar. Se negativo, restringir BTTS/Dupla chance às ligas com cobertura (anotar no ADR 0015). Casas BR-facing (Betano/bet365) não vieram nos additional — só Pinnacle/WH/etc.; aceito.

---

## Landmine de numeração de ADR ⚠️ (ler antes de criar qualquer ADR)

- O bloco do pivot é **0015–0019** (#152–#156). **Não** é "próximo número livre".
- Os ADRs do lote pré-pivot são **0020** (#115) e **0021** (#123) — podem já existir quando a Fase 0 rodar.
- **Colisão histórica dupla:** existem dois arquivos `0012` (`0012-cenarios-informativos` e `0012-competition-wide-fixture-sync`). **NÃO renumerar** — a spec do prompt (`docs/specs/over-under-prompt-design.md`) referencia "ADR 0012, decisão 8". Sempre citar ADR 0012 pelo nome completo.

---

## Ground truth verificado (os ADRs devem bater com o código real, não com o handoff)

- **Migrations:** head atual = `0008_add_generation_params.sql` → migrations do pivot começam em **0009** (não 0008 como o handoff sugeria).
- **Enums (`db/schema.ts`):** `market = [over_under_2_5]`; `recommendation = [over, under, pass]`; `outcome_result = [won, lost, void]` (**sem push**). `predictions` tem `over_odd_at_prediction`/`under_odd_at_prediction` (nullable, ADR 0012) e `stake_units` numeric default "1". `prediction_outcomes` só guarda `total_goals`.
- **Odds math:** `computeImpliedProbabilities(overOdd, underOdd)` é 2-arg; `lib/odds/scenario.ts` tem a invariante binária `100−x` com comentário citando ADR 0003; `MIN_EDGE_PP` é pinado por teste ao SYSTEM_PROMPT (`lib/ai/__tests__/request-builder.test.ts`).
- **Settlement:** `compute.ts` tem `OVER_UNDER_LINE = 2.5`, `SettlementInput` só com `totalGoals`, comentário "the 2.5 line never pushes". `getPendingSettlementPredictions` **não seleciona a coluna market** (assume mercado único); `SETTLEMENT_MIN_ELAPSED_MS = 150min`.
- **Dashboard:** o filtro de mercado **já existe** (`dashboard-filters.tsx`, `MARKET_OPTIONS` hardcoded com opção única); `getUserDashboardRows` já seleciona `market`; **não há** segmentação de KPI por mercado. → #171 popula isso, não cria do zero.
- **IA:** `predict.ts` hardcoda over/under em **5 pontos** (import do prompt, `markets:['totals']`+`pickBestTotalsBookmaker`, `OverUnderOutputSchema`, edge binário, `market:'over_under_2_5'` no insert). `request-builder.ts` **já é market-agnostic** (recebe system/tools/toolName). Camada recente a respeitar: `models.ts` (cascata + gating ADR 0013), `generation-params.ts` + `ai-config.ts` (ADR 0008/#147). `PROMPT_VERSION = over_under_v1.3`.
- **Ajuda:** `components/help/glossary.ts` = fonte única, 22 termos `{term, anchor, meaning, group}`; só ~5 são O/U-específicos. Inconsistência a corrigir: `odd-minima` hardcoda "5pp" enquanto `edge` interpola `MIN_EDGE_PP`.

---

## Critério de saída da Fase 0

- [ ] ADRs 0015–0019 escritos e **aceitos**; ADR 0003 marcado Superseded; ADR 0012-cenários emendado
- [ ] Nenhum doc descreve o produto como mercado-único (grep "over/under 2.5" nos docs só retorna contexto histórico/ADRs e a ajuda do mercado)
- [ ] Validação de odds resolvida pra Copa (✅) **e** re-checagem do Brasileirão registrada (ou agendada com bloqueio explícito)
- [ ] Nenhuma migration / código de feature nesta fase

Com isso, escrever o `HANDOFF-fase-1.md` (fundação de dados: expand + backfill, #159–#162) e começar.

---

## Mapa do pivot inteiro (referência consolidada — vindo do antigo HANDOFF.md)

> Destilação do levantamento de exploração (workflow `map-pivot-to-general-tipster`). O plano de 28 issues / 6 fases virou as issues #152–#182 + épico **#183**; esta seção guarda o **mapa de acoplamento, as restrições duras e os riscos** que sobrevivem a todas as fases.

### Superfície de mudança — 6 áreas (risco ALTO em todas)

| Área | Arquivos-chave | Mudança |
|---|---|---|
| **Schema / dados** (centro de tudo) | `db/schema.ts`, migrations | `markets` + `market_selections` como tabelas de referência (não enums); odds por seleção (`selection_odds_snapshots`); `predictions` → `market_id` + `selection_id` + `marketParams` jsonb; `resultData` jsonb no lugar de `total_goals`; `push` no `outcome_result`. **Expand-migrate-contract**, nunca `db push`. |
| **Providers / odds math** | `lib/providers/odds-api*.ts`, `lib/odds/*` | Transporte e Zod **já genéricos**. Trocar: `DEFAULT_MARKETS=['totals']`, `pickBestTotalsBookmaker` (2 seleções), `computeImpliedProbabilities(over,under)` 2-arg → seletor por `marketKey` retornando N seleções; overround somando `1/odd` sobre **todas** as seleções; `computeImpliedProbabilities(odds[])`. `matches.ts` e `sports-data/*` NÃO mudam. |
| **IA / predict** (porta única) | `lib/ai/predict.ts`, `prompts/over_under_v1.ts`, `schemas/*` | Registry de **cartuchos de mercado** (`lib/ai/markets/<key>/`): SYSTEM_PROMPT-base + `{version, systemPrompt, tool, outputSchema, buildUserMessage, selections}`. `predict()` recebe `marketKey` e resolve por lookup, preservando a fronteira (logging em `ai_calls`). `request-builder.ts` **já é market-agnostic**. |
| **Settlement + yield** (risco silencioso) | `lib/settlement/*`, `lib/dashboard/kpis.ts`, `lib/db/queries/{predictions,dashboard,prediction-outcomes}.ts` | Registry de regras por `settlement_rule_key` (funções puras `(selection, params, resultData) → {result, profitUnits}`); `resultData` coletado 1x/jogo; `push` + half via `profitUnits` fracionário; **yield segmentado por mercado**. Agregação já é quase agnóstica (soma `profitUnits`). |
| **UI / apresentação** (redesign real) | `lib/view/types.ts` (**ponto de alavanca**), `lib/view/*`, componentes de cenários/odds/dashboard, `app/page.tsx`, `app/match/[id]/page.tsx` | View expõe `outcomes` como **array** (`{id,label,modelProb,marketProb,odd,edge,...,isRecommended}`); cenários **data-driven** (2/3/N vias); tirar "2.5"/setas/prefixos O-U; labels vêm do registry; dashboard ganha segmentação por mercado. |
| **Docs / ADRs / ajuda** | `CLAUDE.md`, `docs/PRD\|ARCHITECTURE\|ROADMAP`, ADRs, `app/como-funciona/`, `components/help/glossary.ts` | Reescrever docs (escopo multi-mercado); **ADR 0003 → Superseded**; **ADR 0012-cenários emendado**; spec vira template de família. `/como-funciona` + glossário (22 termos, fonte única) **reaproveitados** como a ajuda do over/under (não descartados), virando market-aware. |

### Restrições duras (gargalos reais)

- **⛔ Disponibilidade de ODDS é o gargalo #1** (não a de resultado). The Odds API (região `eu`) entrega via `/odds` só **`h2h`, `totals`, `spreads`**; o resto (`btts`, `double_chance`, …) é "additional" (`/events/{id}/odds`). Correct score não existe. **Sem odd não há edge.** Validar cobertura antes de prometer mercado (ver #158).
- **O app só guarda placar (90')** (`home_score`/`away_score`, `total_goals`). Mercado que dependa de corners/cards/eventos exige novo provider + nova coluna de resultado.
- **Tiers de viabilidade:** Tier 1 (MVP) = **1X2 + over/under multi-linha** (settla com placar, odd EU); Tier 2 = **BTTS + Dupla chance** (settla com placar, odd "additional" — validada em 2026-06-12, ver #158); Tier 3 (cada um = 1 ADR) = correct score / corners / cards / player props / handicap asiático fracionado.
- **Custo/quota:** avaliar N mercados/jogo multiplica chamadas de LLM e pressiona a quota de 500 req/mês da The Odds API → lazy por mercado + limite de mercados-candidatos por jogo.

### Riscos a não esquecer

1. Refactor **não-aditivo e em cascata** (schema/settlement/odds/prompt/UI juntos) — camada de adaptação por mercado **antes** de qualquer mercado novo; expand-migrate-contract ou vira big-bang.
2. Disponibilidade de odds (acima) — validar antes de prometer.
3. Settlement frágil — push/void/half são caminhos de bug novos num módulo que hoje assume "2.5 nunca dá push". Teste por cenário + override desde o dia 1.
4. Poluição do tracking — misturar mercado imaturo com over/under maduro num Yield agregado corrompe o go/no-go. **Segmentar e graduar por mercado.**
5. Variância em odds altas — flat staking + reportar nº de apostas (idealmente CLV).
6. Dispersão de foco (solo) — feature-flag + backtest obrigatório por mercado.
7. Modelo cai onde o edge teórico é maior (prompt rico p/ gols e 1X2, pobre p/ corners/cards) — expandir por **disponibilidade de dados**, não por edge teórico.

---

## Gotchas de ambiente

- **ripgrep dá timeout no UNC do WSL** — `Read` + PowerShell `Get-ChildItem`.
- Toolchain via WSL nvm; git/gh de PowerShell ou Bash tool.
- Nunca `db push` em prod (irrelevante nesta fase — sem migration).
- Cuidado com quota da The Odds API (500/mês) ao re-checar #158: cada evento additional = 1 request.
