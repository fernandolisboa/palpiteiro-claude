# ADR 0019 — Staking 1–3 unidades por confiança

## Status

Accepted (2026-06-12) — detalha o **ADR 0015** (pivot multi-mercado) no eixo de staking; decisão de
produto **D7** do dono

## Contexto

Decisão de produto **D7, cravada pelo dono em 2026-06-12**: o staking deixa de ser flat 1 unidade e
passa a **1–3 unidades conforme a confiança/edge** da recomendação. Isso **diverge** da recomendação
original do plano (flat 1u no MVP) e por isso ganha ADR próprio antes da implementação.

O schema já comporta: `predictions.stake_units` é `numeric(6,2)` `notNull` com default `"1"`
(`db/schema.ts:229`); o Yield já é **stake-aware** — `yield = Σ profit_units / Σ stake_units`
(`lib/dashboard/kpis.ts:148,152,166-167`), e o profit escala linear com o stake
(`won → round2(stake·(odd−1))`, `lost → round2(−stake)`, `lib/settlement/compute.ts:56-58`). O
`edge_pct` já é computado em código no momento da recomendação (`edge = confidence_pct − impliedPct`,
`predict.ts:569-572`) e congelado na row.

## Decisão

1. **Mapeamento determinístico EM CÓDIGO (não pelo LLM).** O LLM emite `recommendation`,
   `confidence_pct` e (via odds) o `edge_pct`; o **stake é derivado em código** desses números — o
   modelo nunca escolhe o tamanho da aposta. Fonte: **edge** (sinal de mispricing, já gated ≥ 5pp) como
   eixo primário, com **piso de confiança** pra autorizar subir (evita escalar aposta em pick de
   alta variância/longshot, onde um edge alto vem de prob baixa × odd alta).

2. **Bandas (v1 — globais pra todos os mercados; revisitar com dados):**

   | Stake | Condição |
   | --- | --- |
   | **1u** | toda recomendação qualifica no piso (edge ≥ 5pp); banda default |
   | **2u** | `edge_pct ≥ 8` **e** `confidence_pct ≥ 50` |
   | **3u** | `edge_pct ≥ 12` **e** `confidence_pct ≥ 55` |

   **Guarda de confiança (seleção por piso):** o stake é a **banda mais alta cujos pisos de edge E de
   confiança ambos qualificam** (nunca sobe sem o piso de confiança da banda). Edge alto com confiança
   baixa **cascateia** até a primeira banda que passa nos dois pisos — no limite, 1u. Stake
   **máximo = 3u**. `pass` **não tem aposta** — `stake_units` fica no default e é irrelevante
   (excluído do Yield).

3. **Onde aplica: em `predict()`, no momento da recomendação, congelado na row.** O stake é gravado
   em `predictions.stake_units` junto com `edge_pct`/`confidence_pct`/`odd_at_recommendation` e é
   **imutável** como o resto da predição (regra do repo: predições passadas nunca são mutadas).

4. **Mesmas bandas pra todos os mercados (inicial).** Simples e auditável; a confiança em mercados de
   3 vias (1X2) costuma ser < 50% pro favorito num jogo equilibrado, então a guarda **naturalmente**
   mantém a maioria das apostas de 1X2 em 1u até surgir um favorito forte — conservador e seguro. A
   calibração por mercado é revisitada com dados, ancorada no go/no-go por mercado (ADR 0015, D9).

5. **Tradeoff registrado.** Stake variável **amplifica erro de calibração** e torna o Yield mais
   **ruidoso com amostra pequena** (uma sequência ruim de 3u dói mais). Mitigação: o dashboard reporta
   **nº de apostas** e o Yield **também por banda de stake** (além de por mercado — D9); o teto de 3u
   limita a exposição por aposta.

6. **Histórico permanece 1u — sem backfill.** Imutabilidade de predições: as predições antigas
   ficam com `stake_units = 1`. Consequência aceita: o Yield agregado mistura histórico flat (1u) com
   novas predições de stake variável — a quebra por banda de stake + por mercado (e o caráter
   forward-looking do go/no-go) tornam isso legível em vez de enganoso.

## Exemplos numéricos

```
edge +5.5pp, conf 53%            → 1u   (edge < 8 → banda default)
edge +9.0pp, conf 58%            → 2u   (edge ≥ 8 e conf ≥ 50)
edge +9.0pp, conf 44%            → 1u   (edge ≥ 8 mas conf < 50 → guarda derruba pra 1u)
edge +14pp,  conf 62%            → 3u   (edge ≥ 12 e conf ≥ 55)
edge +14pp,  conf 52%            → 2u   (edge ≥ 12 mas conf < 55 → cai pra 2u; conf ≥ 50 → fica em 2u)
edge +14pp,  conf 44%            → 1u   (edge ≥ 12 mas conf < 50 e < 55 → cascateia: reprova 3u e 2u → 1u)
recommendation = pass            → 0u   (sem aposta; stake_units irrelevante, excluído do Yield)
```

## Semântica no Yield / bankroll (incl. interação com ADR 0016)

- O **Yield já é stake-aware**: uma vitória de 3u contribui `3·(odd−1)` no numerador e `3` no
  denominador; uma derrota de 3u, `−3` e `3`. O stake pondera o Yield pela convicção — bom se
  calibrado, ruidoso se não (ponto 5).
- **`push` (contrato do ADR 0016, ainda não no enum `outcome_result`):** devolve o stake
  **independente do tamanho** (profit 0) e é **excluído de numerador e denominador** (no-action, como
  o `void`) — o tamanho do stake não afeta o Yield num push.
- **`half_win`/`half_loss` (ADR 0016):** a fração escala com o stake — `half_win` de 3u =
  `0.5·3·(odd−1)`; `half_loss` de 3u = `−0.5·3`. O `result` persistido é won/lost; o stake só
  multiplica.
- **Bankroll:** "unidade" é a unidade de aposta do usuário (o dimensionamento de 1u em dinheiro é do
  apostador e fica fora de escopo); o app **rastreia em unidades**, com exposição máxima de **3u por
  aposta**.

## Razão

- **Determinístico em código** mantém o staking auditável e reprodutível (o LLM não tem incentivo nem
  calibração pra dimensionar dinheiro), alinhado à postura de reprodutibilidade do ADR 0021.
- **Edge como eixo + piso de confiança** captura convicção sem premiar longshots de alta variância
  (edge alto com prob baixa).
- **Bandas globais simples** evitam overfitting precoce; o go/no-go por mercado (D9) é o lugar certo
  pra diferenciar staking por mercado quando houver dados.
- **Histórico em 1u** preserva a imutabilidade e não inventa stakes retroativos.

## Alternativas consideradas

- **Flat 1u (plano original):** rejeitado pelo dono (D7) — não expressa convicção; deixa edge na mesa
  nas apostas mais fortes.
- **LLM escolhe o stake:** rejeitado — não é calibrável/reprodutível e mistura dimensionamento de
  banca com estimativa de probabilidade (fronteiras separadas).
- **Kelly fracionário contínuo (`f = edge/odds`):** rejeitado pro MVP — exige calibração de
  probabilidade boa (que ainda estamos validando) e amplifica erro com amostra pequena; bandas
  discretas 1–3u são mais robustas e legíveis. Revisitar pós-validação.
- **Bandas por mercado desde já:** rejeitado pro v1 — sem dados por mercado; globais + D9 primeiro.
- **Backfill do histórico pra stake variável:** rejeitado — viola a imutabilidade de predições.

## Consequências

- (+) Apostas mais fortes (edge alto + confiança) carregam mais unidades; convicção vira sinal no
  Yield.
- (+) Determinístico, congelado, auditável; teto de 3u limita a ruína.
- (−) Yield mais ruidoso com amostra pequena — mitigado por quebra por banda de stake + nº de apostas
  + segmentação por mercado.
- (−) Yield agregado mistura histórico 1u com novo stake variável — legível via quebras, não
  retrofitado.
- (±) `stake_units` deixa de ser sempre `1`; quem lê a coluna crua (`numeric` → string no Drizzle)
  já precisa de `Number()` no boundary (gotcha existente), agora com valores 1/2/3.

## Referências

- Issue **#156**; decisão de produto **D7**; detalha o **ADR 0015** no eixo de staking.
  Implementação: Fase 2 (#167 staking 1–3u em código).
- **Interage com:** ADR 0016 (push/half no Yield), ADR 0015/D9 (go/no-go e segmentação por mercado),
  ADR 0021 (postura de reprodutibilidade).
- Código: `db/schema.ts:229` (`stake_units numeric default "1"`), `lib/ai/predict.ts:569-572`
  (`edge_pct`/`confidence_pct` congelados), `lib/settlement/compute.ts:56-58` (profit escala com
  stake), `lib/dashboard/kpis.ts:148-167` (Yield stake-aware).
