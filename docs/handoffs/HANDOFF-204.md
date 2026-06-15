# HANDOFF — #204 UI colapsável de "análises anteriores" (match page)

> Continuidade entre sessões (vive em `docs/handoffs/`, versionado — ver o README).
> **1ª da fila pós-pivot** (ordem do dono: [[work-order-post-pivot]]). Issue de UI
> auto-contida — handoff curto.

## O que é (2026-06-15)
A camada de dados do #114 já shippou (`getPredictionHistoryForMatch`, PR #199); falta
a **UI colapsável**. Mostrar as análises ANTERIORES de um jogo numa seção `<details>`
depois da análise atual, **market-agnostic** (sobrevive ao multi-mercado).

## ⚠️ Aviso do corpo do #204 está OBSOLETO
O #204 manda "implementar junto/após #170 pra não ser jogado fora pelo pivot". **O
pivot já fechou (#170 e todo o pivot shippou, épico #183).** → Construir AGORA, direto
contra a match page pós-pivot (já mercado-agnóstica). Sem esperar nada.

## Ler primeiro
- `gh issue view 204 -R fernandolisboa/palpiteiro-claude` (escopo + ACs).
- A camada de dados (já existe): `lib/db/queries/predictions.ts:122`
  `getPredictionHistoryForMatch(matchId, userId)` — scoped por userId, newest-first.
- A match page pós-pivot (explorar fresco): `app/match/[id]/page.tsx` +
  `components/analysis-panel.tsx`, `analysis-result.tsx`, `match-sections.tsx`,
  `analysis-scenarios.tsx`, `match-collapsible.tsx` (já existe um colapsável — reusar).

## Escopo (do #114, adaptado pós-pivot)
- Consumir `getPredictionHistoryForMatch` na match page; `latest = history[0]`,
  `previous = history.slice(1)`.
- Seção `<details>` "análises anteriores (N)" **após** a análise atual (mobile + desktop).
- Itens do histórico: `again={false}` (sem botão reanalisar, sem overlay de pending);
  seção **oculta durante `pending`**; após `revalidatePath`, a recém-substituída entra
  no histórico. Key estável por `predictions.id` + rótulo que desambigua reanálises do
  mesmo minuto.
- **Market-agnostic:** labels/ícones do registry de mercado (`getMarketPresentation`),
  NUNCA "2.5"/setas O-U hardcoded (senão #243/#245 quebram).

## Contexto de fila (toca os MESMOS arquivos)
#204 é a 1ª de um cluster de match-page UI: **#204 → #242 → #243 → #244 → #245**
(todos reescrevem/tocam analysis-panel/match-sections/page). Construir modular e
ciente dos próximos (ex.: #243 = "seções colapsáveis POR MERCADO" pode reusar o
colapsável daqui). Depois do cluster a fila volta pro #288 ([[work-order-post-pivot]]).

## Invioláveis / landmines
- **Sem cross-user leak:** a query já é scoped por userId — não afrouxar.
- **Sem migration** (UI pura consumindo query existente) — não rode `db:generate`.
- Lógica de negócio fica em `lib/`, não no componente (CLAUDE.md).
- Label **`ui`**. NUNCA commitar HANDOFF-*/PLAN-*/pnpm-workspace.yaml.
- CI = GH Actions (typecheck+lint+test). `pnpm install --ignore-workspace` se precisar.

## Critério de saída
Os 4 ACs do #204: reanalisar mantém anteriores visíveis em `<details>` (mobile+desktop);
zero leak de outro usuário; itens market-agnostic; triade verde. **Próxima: #242.**
