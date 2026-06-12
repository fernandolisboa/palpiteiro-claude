# ADR 0018 — Edge/EV/cenários multi-mercado de N vias (emenda ao ADR 0012-cenários)

## Status

Accepted (2026-06-12) — detalha o **ADR 0015** (pivot multi-mercado) e **emenda o ADR
0012-cenários** (premissa binária → N vias)

## Contexto

A matemática de cenários assume **2 seleções** como invariante de código:

- `lib/odds/scenario.ts:120` deriva o lado oposto por `underModelProb = 100 − overModelProb`; a
  implícita/edge do oposto idem (`:137-144`, `underImplied = 100 − impliedProbPct`,
  `underEdge = −edgePct`). O próprio arquivo avisa (`:88-90`): "Premissa binária: P(lado oposto) =
  100 − P(lado) vale porque a linha 2.5 nunca dá push (gols são inteiros — ADR 0003). Quebraria com
  linhas inteiras futuras (push devolve o stake); revisar se outro mercado entrar."
- `computeImpliedProbabilities(overOdd, underOdd)` é **2-arg** (`lib/odds/implied-probability.ts:22`),
  retorna **frações** `[0,1]` normalizadas (`overProb = (1/over) / ((1/over)+(1/under))`) e o
  `overround = Σ(1/odd) − 1`; o call site (`scenario.ts:149-150`) multiplica por 100.
- O ADR 0012-cenários (decisões 1, 6, 7) e suas Referências assumem os dois lados over/under.

Com o pivot (ADR 0015), entram mercados de **3 vias** (1X2, Dupla chance) e, no futuro, de N vias.
A premissa binária precisa cair **sem** quebrar o que já está certo: o **EV/break-even pago na odd
crua** (ADR 0012-cenários, decisão 6) **sobrevive**. Este ADR generaliza implícita/edge/EV/cenários
pra N seleções e **emenda o ADR 0012-cenários**.

## Decisão

1. **Implícita normalizada pelo overround do mercado COMPLETO (N seleções).** Pra uma seleção `i`
   com odd `o_i` num mercado de seleções `{1..N}`:

   ```
   raw_i      = 1 / o_i
   overround  = (Σ_j raw_j) − 1                 // soma sobre TODAS as N seleções
   implied_i  = raw_i / (Σ_j raw_j)             // normalizada; Σ_i implied_i = 1 (100%)
   ```

   **Nunca** `1 / o_i` cru como probabilidade (gotcha do CLAUDE.md — a casa embute a margem). Pra
   N=2 isso é **exatamente** o `computeImpliedProbabilities` de hoje; a generalização é
   `computeImpliedProbabilities(odds: number[])` (Fase 2, #163), com paridade de arredondamento.

2. **Edge por seleção.** `edge_i = modelProb_i − implied_i` (em pontos percentuais). A recomendação
   sai quando **alguma** seleção tem `edge_i ≥ MIN_EDGE_PP` (5pp). **Cai** a derivação
   `edge_oposto = −edge` (só vale pra N=2): com N>2, cada seleção tem seu próprio edge, e os
   `modelProb_i` somam ~100% **por estimativa do modelo**, não por complemento `100 − x`.

3. **EV / retorno esperado continua pago na odd CRUA (ADR 0012-cenários, decisão 6 — sobrevive).**
   Por seleção:

   ```
   EV_por_unidade_i = (modelProb_i/100) · o_i − 1
   breakEvenProb_i  = 100 / o_i           // prob. real mínima pra EV ≥ 0 NA odd dada (%)
   ```

   É o `computeEvPerUnit`/`computeBreakEvenProbPct`/`computeModelBreakEvenOdd` de hoje
   (`scenario.ts:21/32/41`), **por seleção**. A distinção dos dois conceitos de probabilidade é
   **preservada e load-bearing**: a **normalizada** (overround) rege o **edge**; a **crua**
   (`1/odd`) rege **break-even/EV** (o payout bruto é o que paga o apostador). Não unificar.

4. **Cenários multi-outcome (data-driven, N vias).** O "lado alternativo informativo" do ADR
   0012-cenários é **redefinido**: deixa de ser "o lado oposto (`100 − x`)" e vira **a lista das
   outras seleções do mercado**, cada uma com seu `modelProb_i`, `implied_i`, `edge_i`, `o_i` e
   `EV_i`, com a **recomendada destacada**. Apresentação por N:
   - **N=2** (over/under): lado a lado, **idêntico** ao de hoje (a recomendada + a alternativa
     informativa) — paridade visual com o pré-pivot.
   - **N=3** (1X2, Dupla chance): as 3 seleções em lista/linha, recomendada destacada; as outras
     duas informativas (sem peso de recomendação, como manda a decisão 1 do ADR 0012-cenários).
   - **N>3** (futuro, ex. correct score): **top-K** por relevância (a recomendada + as `K−1` de
     maior `modelProb` ou maior `edge`), nunca renderizar todas. O K e o critério ficam pra issue
     de UI (#170); o contrato matemático aqui é por seleção.

5. **Invariantes que CAEM** (registrados também na emenda ao ADR 0012-cenários):
   - `P(oposto) = 100 − P(lado)` e `implied_oposto = 100 − implied`, `edge_oposto = −edge` — só
     valem pra N=2.
   - "a linha 2.5 nunca dá push" — falso pra linhas inteiras/handicap (ADR 0016 introduz `push`).
   - O comentário de premissa binária em `scenario.ts:88-90` (citando o ADR 0003) é substituído pela
     forma N-vias.

6. **`MIN_EDGE_PP` permanece exportado de `lib/odds/scenario.ts`** (não de `lib/ai/prompts/`): é
   importado por client component (glossário/cenários) **sem** vazar o `SYSTEM_PROMPT` no bundle, e
   é **pinado por teste de sincronia** ao prompt (`lib/ai/__tests__/request-builder.test.ts`,
   `expect(SYSTEM_PROMPT).toContain(\`${MIN_EDGE_PP} pontos percentuais\`)`). A regra de 5pp passa a ser sobre
   a implícita **normalizada de N vias** — o valor (5) e o pino não mudam.

## Exemplos numéricos

**N=2 — over/under (paridade com hoje).** Odds `over 1.92 / under 1.92` (a confiança de 55% abaixo é
ilustrativa — escolhida pra cair numa recomendação; compare com o exemplo de `pass` na decisão 7 do
ADR 0012-cenários, mesmas odds, confiança 53%):

```
raw = 1/1.92 = 0.52083 (cada)         Σraw = 1.04167   overround = 4.17%
implied_over = implied_under = 0.52083 / 1.04167 = 50.00%
modelProb_over = 55%  →  edge_over = 55 − 50 = +5.00pp (recomenda over)
                          edge_under = 45 − 50 = −5.00pp (informativo)
EV_over (odd crua) = 0.55 · 1.92 − 1 = +5.6% por unidade   breakEven_over = 100/1.92 = 52.08%
```

**N=3 — 1X2.** Odds `casa 2.10 / empate 3.40 / fora 3.60`:

```
raw:  casa 1/2.10 = 0.47619   empate 1/3.40 = 0.29412   fora 1/3.60 = 0.27778
Σraw = 1.04809   overround = 4.81%
implied: casa 0.47619/1.04809 = 45.43%   empate 28.06%   fora 26.50%   (Σ ≈ 100%, arredondamento)
modelProb: casa 52%  empate 27%  fora 21%   (estimados pelo modelo, somam 100%)
edge:    casa 52 − 45.43 = +6.57pp (recomenda casa)   empate 27 − 28.06 = −1.06pp   fora 21 − 26.50 = −5.50pp
EV casa (odd crua) = 0.52 · 2.10 − 1 = +9.2% por unidade   breakEven_casa = 100/2.10 = 47.62%
```

Note que, com N=3, **nenhum** edge é o negativo do outro: cada seleção tem implícita e edge
próprios, e `100 − implied_casa` (54.57%) **não** é a implícita de nenhuma seleção isolada.

## Razão

- **Normalizar pelo mercado completo** é a única forma correta de tirar a margem da casa com N>2
  (gotcha do overround do CLAUDE.md) — `1/odd` cru superestima cada probabilidade.
- **Manter EV/break-even na odd crua** preserva a decisão 6 do ADR 0012-cenários (o apostador é pago
  no payout bruto) e os dois conceitos de probabilidade que o código já separa de propósito.
- **Cenários como lista de seleções** degradam **exatamente** pro layout binário atual em N=2, então
  o over/under não regride visualmente, e generalizam pra 3/N sem caso especial.

## Alternativas consideradas

- **Manter `100 − x` e tratar 1X2 como dois sub-mercados binários:** rejeitado — distorce a
  normalização (o empate some) e mente sobre o overround real de 3 vias.
- **Usar `1/odd` cru como probabilidade (sem normalizar):** rejeitado — é exatamente o erro que o
  CLAUDE.md proíbe; superestima e infla edge.
- **Unificar break-even/EV na implícita normalizada:** rejeitado — o break-even é contra o **payout
  bruto** (decisão 6 do ADR 0012-cenários); normalizar ali estaria errado.
- **Renderizar todas as N seleções sempre:** rejeitado pra N>3 — polui a UI; top-K por relevância.

## Referências

- Issue **#155**; detalha o **ADR 0015** no eixo de odds-math/cenários. Implementação: Fase 2
  (#163 odds-math N seleções, #164 seletor/snapshot genéricos) e Fase 3 (#170 cenários data-driven).
- **Emenda o ADR 0012-cenários** (premissa binária `100 − x` / "2.5 nunca dá push") — ver o bloco
  `## Emenda` adicionado lá. **Preserva** a decisão 6 (EV/break-even na odd crua) e generaliza a
  decisão 7 (edge vs retorno divergem) por seleção.
- **Supersede** (junto com o ADR 0015) a premissa binária derivada do **ADR 0003**.
- Código: `lib/odds/scenario.ts` (`100 − x` `:120/137-144`, comentário binário `:88-90`,
  `MIN_EDGE_PP:9`, break-even/EV `:21/32/41`), `lib/odds/implied-probability.ts`
  (`computeImpliedProbabilities` 2-arg), `lib/ai/__tests__/request-builder.test.ts` (pino de
  `MIN_EDGE_PP`).
