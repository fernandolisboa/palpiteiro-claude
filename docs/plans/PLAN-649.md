# PLAN-649 — Confiança do palpite calculada pelo motor

Issue: #649. Decisão do Fernando (thread "Confiança do palpite", 2026-10-23): a confiança
do palpite-manchete deixa de ser escolhida pelo LLM e passa a vir da probabilidade do
motor, com faixas fixas e acerto medido em `/admin/motor/calibracao`.

## Estado atual (aterrado no código)

- `lib/ai/palpites/cartridges/cartridge.ts`: `PalpitesOutputSchema.confidence`
  (`z.enum(["baixa","media","alta"])`), espelhado no tool `submit_palpite` (`required`) e
  no item 5 do `SYSTEM_PROMPT` + na user message (linha "confiança qualitativa").
  `PALPITES_VERSION = "palpites_v11"`.
- `lib/ai/palpites/cartridges/live.ts`: idem (`PALPITES_LIVE_VERSION`), item 3 do prompt.
- `lib/ai/palpites/index.ts` `runSynthesis`: persiste `headline.confidence =
  output.confidence`; `synthesisDetail(output)` (lib/ai/progress/details.ts) escreve
  "Confiança do palpite: …" no "Ver raciocínio".
- `db/schema.ts` `PalpiteHeadline.confidence` (jsonb, sem DDL).
- View: `lib/view/palpites-headline.ts` → `PalpiteHeadlineView.confidence` → chips em
  `palpite-hero.tsx`, `public-palpite.tsx`, `og-palpite-image.tsx` (palavra, sem número —
  firewall ADR 0030).
- Probabilidades disponíveis na síntese:
  - pré-jogo: `analyses: MarketAnalysisSummary[]`; a de `marketKey === "match_result"` tem
    `selections` `home/draw/away` com `modelProbPct` (code_jev: DC+JEV; LLM: o número do
    cartucho, Σ pode ≠ 100).
  - fallback pré-jogo: `getLatestMatchModelSnapshot(matchId)` (ADR 0052),
    `probabilities.match_result {home, draw, away}` validado por Zod em
    `lib/model-base/types.ts`.
  - ao vivo: `live.scoreline.matrix` (matriz do placar FINAL do modelo em jogo) + a
    análise ao vivo de 1X2 se houver.

## Mudança

1. **`lib/ai/palpites/confidence.ts`** (puro, testado):
   - `scoreOutcome({home, away}) → "home" | "draw" | "away"`.
   - `PALPITE_CONFIDENCE_BANDS = { media: 40, alta: 55 }` (pp, P do resultado).
   - `confidenceLevel(probPct) → "baixa" | "media" | "alta"`.
   - `matchResultProbsFromAnalyses(analyses)` → `{home, draw, away}` normalizado a Σ=100
     ou null (sem análise de 1X2, seleção faltando, Σ ≤ 0 ou não finito).
   - `matchResultProbsFromMatrix(matrix)` (ao vivo) → idem.
   - `palpiteConfidence(probableScore, probs | null) → { level, probPct } | null`.
2. **Cartuchos**: tira `confidence` do Zod, do tool e dos prompts (pré-jogo e ao vivo).
   Bump `palpites_v12` / próximo do live. Commit `prompt:`.
3. **`runSynthesis`**: recebe `confidenceProbs` (já resolvido pelo caller); calcula
   `palpiteConfidence(output.probableScore, probs)` depois do loop e grava em `headline`:
   `confidence` (nível ou `null`), `confidenceProbPct` (número ou `null`),
   `confidenceSource: "engine"`. `synthesisDetail` lê esse resultado ("Confiança do
   palpite: baixa (pelo motor)" / "sem confiança: faltou a probabilidade do motor").
   - Pré-jogo: análises → snapshot (só quando não há 1X2 nas análises; leitura nunca
     derruba a síntese: erro → null).
   - Ao vivo: análises → matriz ao vivo.
4. **Tipo/view**: `PalpiteHeadline.confidence: "baixa"|"media"|"alta"|null` +
   `confidenceProbPct?: number|null` + `confidenceSource?: "engine"` (ausente = LLM,
   sets antigos). `PalpiteHeadlineView.confidence` vira nullable (sem número na view —
   `confidenceProbPct` NÃO cruza, firewall). Chips somem com `null`. Chip ganha
   `title` explicando que vem da chance que o motor dá ao resultado do placar provável.
5. **Calibração**: `getPalpiteConfidenceRows()` em `lib/db/queries/palpite-confidence.ts`:
   sets pré-jogo (`is_live = false`), headline não nula, um por (match, user) — o mais
   recente (`DISTINCT ON`), com a linha `exact_score` liquidada (`palpite_outcomes`
   com `resultData.homeScore/awayScore` não nulos). Derivação pura em
   `lib/calibration/palpite-confidence.ts`: por fonte (motor / LLM antigo) × nível → n,
   P média (só motor), acerto observado do resultado (1X2 do placar provável vs placar de
   90 min). Seção nova na página de calibração, com estado vazio.
6. **Copy**: `/como-usar` (linha 240) explica que a confiança vem da chance que o motor
   dá ao resultado. Landing preview segue com "média" (estático).
7. **ADR 0069** curto: decisão, faixas, fontes, fallback, o que não muda.

## Testes

- Unit de `confidence.ts` (faixas nas bordas 40/55, normalização, nulls, matriz).
- `generate-palpites` (pglite/unit existentes): fixture sem `confidence` no output; set
  persiste `confidence` do motor; sem 1X2 + snapshot → usa snapshot; sem nada → null.
- Cartridge test: schema rejeita `confidence` (strict) e o tool não o lista.
- View: `confidence: null` → sem chip (hero, public, OG).
- Derivação de calibração (pura) + query pglite.

## Landmines

- `.strict()` no output: um LLM que ainda mande `confidence` vira `invalid_output`. O tool
  com `additionalProperties:false` e sem o campo deve bastar; aceitar e descartar seria
  furar o firewall estrutural.
- Σ das probs do LLM engine ≠ 100 → normalizar.
- Não fazer leitura de DB extra no caminho ao vivo.
- Fixtures de teste que montam headline à mão precisam do novo tipo.

## Ajustes após a revisão do plano

- **Fonte pré-jogo invertida:** a base do modelo (`match_model_snapshots`) vem primeiro,
  porque o motor padrão do código é `llm` e o 1X2 do motor LLM seria o LLM escolhendo a
  confiança de novo, e porque o 1X2 do code_jev pode carregar o contexto extra do usuário
  (que vai pro `/p`). Fallback: só a análise de 1X2 com `engine === "code_jev"`
  (`MarketAnalysisSummary.engine`, do carimbo dos julgamentos ou do `modelVersion`).
- **Ao vivo:** só a matriz (`p1X2`, em 0..1 → pp). A leitura de 1X2 ao vivo sai da mesma
  matriz.
- **`confidenceSource`** informativo: `snapshot | analysis | live_matrix | none`.
- **Chip:** sem `title` (seria falso nos sets antigos do LLM).
- **Calibração:** `notExists` de um set de pré-jogo mais novo (o mesmo critério da
  liquidação), não `DISTINCT ON` depois do join; jsonb validado por Zod; coluna de jogos
  distintos.
- Copy também em `components/help/glossary.ts` e `app/como-funciona`.
