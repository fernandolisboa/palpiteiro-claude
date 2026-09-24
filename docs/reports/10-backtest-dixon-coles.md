# Backtest: Dixon-Coles MLE vs λ heurístico (ADR 0039, #502)

Snapshot: `data/backtest/BRA-2026-09-24.csv` · temporadas avaliadas: 2023, 2024, 2025 · aquecimento: os dois times com ≥ 5 jogos na temporada · 987 jogos avaliados · 10.6s.

Walk-forward: cada jogo só vê jogos de dias anteriores. DC refitado a cada dia de jogo (ξ = 0.0019/dia, janela 3 anos, prior de 2 gols). Heurístico = `computeMatchLambdas` de produção sobre a tabela reconstruída da temporada. Mercado = fechamento 1X2 de-vigado (Pinnacle, senão média).

## Critério de GO (over 2.5)

| diferença (a − b) | mercado | n | média | IC 90% |
| --- | --- | --- | --- | --- |
| Dixon-Coles MLE − heurístico (Maher + shrinkage) | over 2.5 | 987 | -0.0112 | [-0.0218, -0.0001] |
| Dixon-Coles MLE − heurístico (Maher + shrinkage) | 1X2 | 987 | -0.0422 | [-0.0578, -0.0276] |
| Dixon-Coles MLE − mercado (fechamento) | 1X2 | 987 | 0.0215 | [0.0106, 0.0315] |
| heurístico (Maher + shrinkage) − mercado (fechamento) | 1X2 | 987 | 0.0638 | [0.0482, 0.0795] |
| Dixon-Coles MLE − taxa-base (últimos 12 meses) | over 2.5 | 987 | 0.0017 | [-0.0080, 0.0114] |
| heurístico (Maher + shrinkage) − taxa-base (últimos 12 meses) | over 2.5 | 987 | 0.0129 | [0.0009, 0.0250] |

**Veredito:** GO — o DC bate o heurístico em over 2.5 com o IC inteiro abaixo de 0.

## Todas as temporadas

### Over 2.5

| estratégia | n | log-loss | Brier |
| --- | --- | --- | --- |
| taxa-base (últimos 12 meses) | 987 | 0.6901 | 0.2485 |
| heurístico (Maher + shrinkage) | 987 | 0.7030 | 0.2540 |
| Dixon-Coles MLE | 987 | 0.6917 | 0.2492 |

### 1X2

| estratégia | n | log-loss | Brier |
| --- | --- | --- | --- |
| taxa-base (últimos 12 meses) | 987 | 1.0559 | 0.6363 |
| heurístico (Maher + shrinkage) | 987 | 1.0611 | 0.6376 |
| Dixon-Coles MLE | 987 | 1.0189 | 0.6103 |
| mercado (fechamento) | 987 | 0.9974 | 0.5956 |

## 2023

### Over 2.5

| estratégia | n | log-loss | Brier |
| --- | --- | --- | --- |
| taxa-base (últimos 12 meses) | 330 | 0.6853 | 0.2461 |
| heurístico (Maher + shrinkage) | 330 | 0.6953 | 0.2499 |
| Dixon-Coles MLE | 330 | 0.6777 | 0.2423 |

### 1X2

| estratégia | n | log-loss | Brier |
| --- | --- | --- | --- |
| taxa-base (últimos 12 meses) | 330 | 1.0672 | 0.6446 |
| heurístico (Maher + shrinkage) | 330 | 1.0827 | 0.6511 |
| Dixon-Coles MLE | 330 | 1.0407 | 0.6241 |
| mercado (fechamento) | 330 | 1.0228 | 0.6123 |

## 2024

### Over 2.5

| estratégia | n | log-loss | Brier |
| --- | --- | --- | --- |
| taxa-base (últimos 12 meses) | 327 | 0.6938 | 0.2503 |
| heurístico (Maher + shrinkage) | 327 | 0.7102 | 0.2577 |
| Dixon-Coles MLE | 327 | 0.6965 | 0.2515 |

### 1X2

| estratégia | n | log-loss | Brier |
| --- | --- | --- | --- |
| taxa-base (últimos 12 meses) | 327 | 1.0560 | 0.6362 |
| heurístico (Maher + shrinkage) | 327 | 1.0672 | 0.6414 |
| Dixon-Coles MLE | 327 | 1.0279 | 0.6163 |
| mercado (fechamento) | 327 | 0.9834 | 0.5856 |

## 2025

### Over 2.5

| estratégia | n | log-loss | Brier |
| --- | --- | --- | --- |
| taxa-base (últimos 12 meses) | 330 | 0.6911 | 0.2490 |
| heurístico (Maher + shrinkage) | 330 | 0.7035 | 0.2543 |
| Dixon-Coles MLE | 330 | 0.7011 | 0.2537 |

### 1X2

| estratégia | n | log-loss | Brier |
| --- | --- | --- | --- |
| taxa-base (últimos 12 meses) | 330 | 1.0445 | 0.6281 |
| heurístico (Maher + shrinkage) | 330 | 1.0336 | 0.6204 |
| Dixon-Coles MLE | 330 | 0.9883 | 0.5907 |
| mercado (fechamento) | 330 | 0.9858 | 0.5888 |


## Leitura (2026-09-24)

- **Gate do ADR 0039 D2: GO, por pouco.** DC − heurístico em over 2.5 = −0.0112 com IC 90% [−0.0218, −0.0001]. O sinal é o mesmo no período fora da amostra principal (2021–2022, rodando `--seasons 2021,2022`: −0.0128, IC [−0.0255, +0.0007]). No 1X2 a vantagem do DC é clara nos dois períodos (−0.042 e −0.017, IC inteiro abaixo de 0).
- **O achado que importa: no over 2.5, nenhum modelo de força de time bate a taxa-base.** O heurístico de produção é *pior* que prever a fração de overs dos últimos 12 meses (+0.0129, IC [+0.0009, +0.0250]). O DC empata com ela (+0.0017, IC [−0.0080, +0.0114]; em 2021–2022, −0.0054, IC [−0.0179, +0.0071]). Ou seja, o baseline Poisson que hoje ancora o LLM no over/under (ADR 0037) adiciona ruído, e trocar pelo DC remove esse dano, mas não traz informação nova sobre o total de gols.
- **No 1X2 o mercado de fechamento ainda ganha do DC** (+0.0215, IC [+0.0106, +0.0315]). É o esperado: o fechamento incorpora escalação, desfalques e dinheiro informado.
- **Hiperparâmetros fixados a priori** (ξ = 0.0019/dia de Dixon-Coles 1997, prior de 2 gols), sem ajuste no conjunto de teste. Uma grade em 2021–2022 (ξ ∈ {0.001, 0.0019, 0.004} × prior ∈ {2, 6, 15}) mudou o log-loss de over 2.5 em no máximo 0.004 — o resultado não depende de escolha fina.
- **Sem odds de over/under no snapshot**, não há benchmark de mercado para o over 2.5. O CLV ao vivo (gate do Kelly, ADR 0039 D3) é o que mede isso.
