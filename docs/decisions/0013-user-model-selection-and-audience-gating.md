# ADR 0013 — Seleção de modelo pelo usuário comum + gating por audiência

## Status

Accepted (2026-06-11) — **emenda o ADR 0008** (modelo de análise configurável).

## Contexto

O ADR 0008 deixou a seleção de modelo restrita a admin: default global em
`ai_config` + override por análise visível só a admin; usuário comum sempre cai
no default global, sem seletor. Queremos abrir uma parte dessa escolha ao usuário
comum (override por análise na Issue #101 e preferência persistida em `/perfil` na
Issue #102), mas SEM expor todo o registry — alguns modelos são caros/
experimentais demais pra rodar sem supervisão (Fable 5) ou são legado mantido só
pra admin (Sonnet 4.5).

Esta issue (#100) é a **fundação**: registry + gating por audiência, sem tocar DB
nem UI do usuário comum. As Issues #101 e #102 implementam o lado do usuário comum
em cima desta base.

Também adicionamos dois modelos novos ao registry — **Fable 5** ($10/$50 por 1M,
adaptive thinking, admin-only) e **Haiku 4.5** ($1/$5 por 1M, temperature 0.3,
visível ao usuário comum como opção econômica). Continuam sendo o mesmo provider
(Anthropic), então não exigem ADR de provider novo (CLAUDE.md).

## Decisão

1. **Flag `userSelectable: boolean` no registry** (`lib/ai/models.ts`,
   `AIModel`). É a única fonte da audiência de cada modelo. Lista visível ao
   usuário comum (`userSelectable: true`): **Opus 4.8**, **Sonnet 4.6** e
   **Haiku 4.5**. Admin-only (`userSelectable: false`): **Fable 5** e
   **Sonnet 4.5** (`claude-sonnet-4-5-20250929`).

2. **Helpers de audiência** no registry:
   - `modelsForAudience(isAdmin)`: admin → todos (`SELECTABLE_MODELS`); usuário
     comum → só os `userSelectable`. Fonte das listas da UI.
   - `isModelAllowedForAudience(id, isAdmin)`: type guard que valida o id contra o
     registry E aplica o gate de audiência. Ponto único de revalidação no
     servidor.

3. **Invariante forte: um modelo admin-only NUNCA roda pra usuário comum.**
   Garantida em duas frentes que cercam toda origem de modelo do usuário comum:
   - **Default global restrito a `userSelectable`** — vale pra TODOS, então só
     pode ser um modelo que o usuário comum poderia escolher. `updateDefaultModel`
     revalida com `isModelAllowedForAudience(modelId, false)`.
   - **Preferência do usuário comum filtrada por audiência na resolução** — a
     preferência persistida (#102) é validada por audiência antes de virar o
     modelo efetivo; um id admin-only herdado (ex.: o usuário virou comum, ou o
     registry mudou) é ignorado e cai no próximo nível da cascata.

4. **Cascata de resolução do modelo efetivo** (precedência, do mais específico ao
   mais geral):

   ```
   override por análise  >  preferência do usuário  >  default global  >  DEFAULT_MODEL_ID
   ```

   Cada nível que vem de fonte não-confiável (FormData, coluna do DB) passa pelo
   gate de audiência apropriado antes de ser aceito; ao falhar, desce pro próximo
   nível (nunca um id inválido/admin-only escapando pro Anthropic).

5. **Pontos de validação (defense-in-depth — UI esconde, servidor é a verdade):**
   - **UI esconde**: dropdowns do usuário comum usam `modelsForAudience(false)`;
     o dropdown do default global (admin) também, por ser global. A lista de
     *pricing* em `/admin/settings` segue mostrando TODOS (`SELECTABLE_MODELS`).
   - **Server revalida**: `updateDefaultModel` (#100), `analyzeMatch` (override por
     análise, #101) e `updatePreferredModel` (preferência, #102) revalidam por
     audiência na action — server actions são POST chamáveis fora do layout.
   - **Resolução final em `predict`**: única porta da LLM (CLAUDE.md), resolve a
     cascata, aplica o gate por nível e grava o modelo REAL usado.

## Razão

- **Flag no registry** mantém a audiência como dado tipado junto do pricing/
  thinkingMode — sem listas paralelas espalhadas pelo código.
- **Helpers únicos** garantem que UI e servidor concordam sobre quem vê o quê, e
  que a revalidação no servidor é uma linha em cada action.
- **Invariante nos dois pontos de origem** (default global + preferência) fecha
  todos os caminhos pelos quais um modelo admin-only chegaria a um usuário comum,
  mesmo via POST direto na action ou id stale no DB.
- **Haiku 4.5** dá ao usuário comum uma opção barata; **Fable 5** fica admin-only
  por custo/comportamento até haver confiança pra liberar.

## Alternativas consideradas

- **Coluna/enum de audiência no DB**: overkill; a audiência é estática por modelo,
  então mora no registry tipado como o resto do metadado de modelo.
- **Sem gate no default global, só esconder na UI**: rejeitado — o default vale
  pra todos e a action é chamável fora do layout; o gate tem que ser no servidor.
- **Liberar Fable 5 ao usuário comum**: rejeitado por ora — caro ($10/$50) e
  experimental; pode ser revisto bumpando a flag, sem migration.

## Consequências

- (+) Base pronta pro usuário comum escolher modelo (#101/#102) com gating
  garantido no servidor.
- (+) Adicionar/mover modelo de audiência = editar o registry (`userSelectable`)
  — sem migration.
- (+) Custo correto pros modelos novos (Fable 5, Haiku 4.5) já no registry.
- (−) `role` no JWT só atualiza no re-login (ADR 0007): a audiência efetiva de um
  usuário recém-promovido/rebaixado só muda ao relogar. Pré-existente.
- (−) Mais modelos no registry = dropdown de pricing (admin) maior; aceito.

## Referências

- Emenda o ADR 0008 (modelo de análise configurável); reusa o admin do ADR 0007.
- Implementa a fundação da Issue #100; Issues #101 (override por análise do
  usuário) e #102 (preferência em `/perfil` + cascata) constroem o lado do
  usuário comum em cima desta base.
