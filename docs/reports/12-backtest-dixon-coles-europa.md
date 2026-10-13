# Backtest Dixon-Coles fora do Brasileirão: Premier League e La Liga

Snapshot de 2026-10-13. Mesma metodologia do [report 10](./10-backtest-dixon-coles.md) (Brasileirão), pra os números serem comparáveis: walk-forward em que cada jogo só vê jogos de dias anteriores, DC refitado a cada dia de jogo com os parâmetros de produção (`DC_DEFAULTS`: ξ = 0.0019/dia, janela de 3 anos, prior de 2 gols), heurístico = `computeMatchLambdas` de produção sobre a tabela reconstruída da temporada, aquecimento de 5 jogos de cada time na temporada, IC 90% bootstrap das diferenças pareadas de log-loss. Nenhum hiperparâmetro foi ajustado nestes dados.

O que muda em relação ao report 10:

- **Benchmark de mercado também no over 2.5.** Os CSVs europeus do football-data.co.uk trazem odds de fechamento de over/under 2.5 (Pinnacle e média), que o arquivo do Brasileirão não tem. O fechamento de-vigado (proporcional, mercado completo) entra como quarta estratégia nos dois mercados.
- **Temporada = ano de início** (2023 = 2023/24). Período principal: 2023/24, 2024/25 e 2025/26. Período de controle: 2021/22 e 2022/23 (o mesmo papel do `--seasons 2021,2022` no report 10). O histórico começa em 2018/19, então todo jogo avaliado tem a janela de 3 anos cheia.
- Dados: `data/backtest/E0-2026-10-13.csv` (Premier League) e `data/backtest/SP1-2026-10-13.csv` (La Liga), 3040 jogos cada, montados por `scripts/backtest/build-football-data-snapshot.ts` a partir dos CSVs por temporada. Zero chamada à The Odds API, zero LLM.

Champions e Libertadores ficaram de fora: o football-data.co.uk não tem CSV delas.

## Resposta curta

**O achado do Brasileirão se mantém nas duas ligas.** O Dixon-Coles bate o heurístico no 1X2 com folga: ≈ −0.04 de log-loss nas três ligas no período principal (−0.017 a −0.041 no controle), com IC inteiro abaixo de 0 nos dois períodos. No over 2.5 o DC também é melhor nos quatro recortes, mas a vantagem é pequena (−0.006 a −0.017) e só é significativa em dois deles, exatamente o "GO por pouco" do Brasileirão. O mercado de fechamento continua à frente do DC nos dois mercados; a única exceção é o over 2.5 da Premier League no controle, onde os dois empatam.

## Diferenças pareadas, período principal (2023/24 a 2025/26)

Log-loss de a − b por jogo; negativo = a é melhor. Brasileirão (2023 a 2025) repetido do report 10 pra comparação.

| diferença (a − b) | mercado | Premier League (n = 989) | La Liga (n = 988) | Brasileirão (n = 987) |
| --- | --- | --- | --- | --- |
| DC − heurístico | 1X2 | **−0.0429** [−0.0585, −0.0279] | **−0.0411** [−0.0544, −0.0282] | **−0.0422** [−0.0578, −0.0276] |
| DC − heurístico | over 2.5 | −0.0106 [−0.0216, +0.0005] | **−0.0170** [−0.0292, −0.0039] | **−0.0112** [−0.0218, −0.0001] |
| DC − taxa-base 12 meses | over 2.5 | +0.0049 [−0.0061, +0.0152] | **−0.0192** [−0.0318, −0.0061] | +0.0017 [−0.0080, +0.0114] |
| heurístico − taxa-base 12 meses | over 2.5 | +0.0155 [+0.0031, +0.0276] | −0.0022 [−0.0167, +0.0111] | +0.0129 [+0.0009, +0.0250] |
| DC − mercado | 1X2 | +0.0202 [+0.0114, +0.0293] | +0.0206 [+0.0116, +0.0290] | +0.0215 [+0.0106, +0.0315] |
| heurístico − mercado | 1X2 | +0.0632 [+0.0466, +0.0800] | +0.0617 [+0.0466, +0.0758] | +0.0638 [+0.0482, +0.0795] |
| DC − mercado | over 2.5 | +0.0135 [+0.0058, +0.0213] | +0.0118 [+0.0033, +0.0208] | — (sem odds) |
| heurístico − mercado | over 2.5 | +0.0241 [+0.0129, +0.0352] | +0.0289 [+0.0160, +0.0415] | — (sem odds) |

Em negrito: o modelo da esquerda é melhor com o IC 90% inteiro abaixo de 0.

### Log-loss absoluto (período principal)

| estratégia | PL 1X2 | PL over 2.5 | La Liga 1X2 | La Liga over 2.5 |
| --- | --- | --- | --- | --- |
| taxa-base (últimos 12 meses) | 1.0734 | 0.6769 | 1.0691 | 0.6940 |
| heurístico (Maher + shrinkage) | 1.0307 | 0.6924 | 1.0169 | 0.6918 |
| Dixon-Coles MLE | 0.9878 | 0.6818 | 0.9758 | 0.6747 |
| mercado (fechamento) | 0.9676 | 0.6683 | 0.9552 | 0.6629 |

## Período de controle (2021/22 e 2022/23)

| diferença (a − b) | mercado | Premier League (n = 660) | La Liga (n = 658) |
| --- | --- | --- | --- |
| DC − heurístico | 1X2 | **−0.0252** [−0.0460, −0.0045] | **−0.0410** [−0.0599, −0.0215] |
| DC − heurístico | over 2.5 | **−0.0133** [−0.0261, −0.0005] | −0.0057 [−0.0200, +0.0085] |
| DC − taxa-base 12 meses | over 2.5 | −0.0070 [−0.0201, +0.0059] | −0.0059 [−0.0183, +0.0070] |
| DC − mercado | 1X2 | +0.0230 [+0.0112, +0.0351] | +0.0200 [+0.0093, +0.0310] |
| DC − mercado | over 2.5 | +0.0044 [−0.0051, +0.0137] | +0.0115 [+0.0020, +0.0212] |

## Leitura (2026-10-13)

- **1X2: o resultado mais robusto do backtest.** DC − heurístico ≈ −0.04 nas três ligas no período principal (no controle, −0.025 na Premier League, −0.041 em La Liga e −0.017 no Brasileirão), com IC inteiro abaixo de 0 nos seis recortes (três ligas × dois períodos), e o DC tem log-loss menor que o heurístico em cada temporada do período principal das duas ligas novas (tabelas no apêndice). É uma diferença grande pra log-loss: nas ligas europeias o heurístico fica a meio caminho entre a taxa-base e o DC (no Brasileirão ele empatava com a taxa-base).
- **Over 2.5: mesmo sinal em todo lugar, magnitude pequena.** O DC ganha do heurístico nos quatro recortes europeus, mas o IC só fica inteiro abaixo de 0 em dois (La Liga principal e Premier League controle). Na Premier League principal o limite superior é +0.0005, o mesmo "por pouco" do Brasileirão. Por temporada o resultado oscila: na Premier League 2023/24 (64.7% de overs, ano atípico) o DC perde do heurístico e da taxa-base, porque a janela de 3 anos demora a acompanhar um salto no nível de gols.
- **Taxa-base no over 2.5: a Premier League repete o Brasileirão, La Liga não.** Na Premier League o heurístico é pior que a taxa-base (+0.0155, IC acima de 0) e o DC empata com ela, igual ao Brasileirão. Em La Liga o DC bate a taxa-base com folga no período principal (−0.0192, IC inteiro abaixo de 0), mas não no controle (−0.0059, IC [−0.0183, +0.0070], parecido com a Premier League). Uma leitura possível (não testada aqui) é que em La Liga a diferença de estilo entre times carrega informação sobre o total de gols; com um só período significativo, isso é um indício, não um achado. O achado do report 10 de que "nenhum modelo de força de time bate a taxa-base no over 2.5" continua valendo como regra, com La Liga 2023/24–2025/26 como a exceção a acompanhar.
- **O mercado de fechamento ganha do DC nos dois mercados.** No 1X2 a distância é a mesma das três ligas (+0.020 a +0.022). No over 2.5, medido pela primeira vez, é +0.012 a +0.014 no período principal; no controle é +0.0115 em La Liga e empate na Premier League (+0.0044, IC [−0.0051, +0.0137]). O DC sozinho não tem edge contra o fechamento: qualquer valor real depende do que entra por cima dele (JEV, notícias, desfalques) e de apostar antes de a linha fechar. É o que o gate de CLV do Kelly (ADR 0039 D3) mede ao vivo.
- **Pra produção: nada muda.** O DC já é o motor de probabilidade do `code_jev` (ADR 0051) e este backtest confirma a escolha fora do Brasileirão. O que custa caro é cair no fallback heurístico (≈ +0.04 de log-loss no 1X2): vale manter o refit diário saudável nas ligas europeias.

### Ressalvas

- **Pinnacle parou de aparecer no meio de 2025/26** (210 de 380 jogos na Premier League, 188 em La Liga). No resto o benchmark usa a média do mercado de-vigada, que tem margem maior; o mercado de 2025/26 é um benchmark um pouco mais fraco.
- **Pandemia no histórico.** 2019/20 (final) e 2020/21 tiveram estádios vazios e vantagem de mando perto de zero; esses jogos estão na janela de 3 anos de todo o período de controle e, com peso já baixo (≈ 0.15), do começo de 2023/24. É o mesmo que um ajuste real teria visto na época.
- **Promovidos.** O snapshot só tem a primeira divisão, como o ajuste de produção (API-Football por liga): um promovido começa no prior (α = β = 1). O backtest deixa o DC opinar a partir do 6º jogo; produção cai no heurístico até o time ter 10 jogos na janela (`DC_MIN_TEAM_MATCHES`). Os primeiros jogos de promovidos em produção são, portanto, o caso do fallback, não o do DC medido aqui.
- **Só 1X2 e over 2.5.** Os CSVs não têm BTTS nem dupla chance; a dupla chance sai da mesma matriz do 1X2.

## Como reproduzir

```bash
# 1. Baixar os CSVs por temporada (fora do repo)
mkdir -p /tmp/fd && for d in E0 SP1; do for s in 1819 1920 2021 2122 2223 2324 2425 2526; do
  curl -sSL -o /tmp/fd/${d}_$s.csv https://football-data.co.uk/mmz4281/$s/$d.csv
done; done

# 2. Montar os snapshots no schema do Brasileirão
for d in E0 SP1; do
  npx tsx scripts/backtest/build-football-data-snapshot.ts --div $d --dir /tmp/fd \
    --seasons 1819,1920,2021,2122,2223,2324,2425,2526 --out data/backtest/$d-2026-10-13.csv
done

# 3. Rodar (≈ 13 s por liga)
npx tsx scripts/backtest/run.ts --csv data/backtest/E0-2026-10-13.csv --seasons 2023,2024,2025 --league "Premier League"
npx tsx scripts/backtest/run.ts --csv data/backtest/SP1-2026-10-13.csv --seasons 2023,2024,2025 --league "La Liga"
# controle: --seasons 2021,2022
```

Os snapshots estão versionados, então o passo 3 sozinho reproduz este report. O `run.ts` sem argumentos continua gerando a parte do report 10 que sai do script idêntica (a Leitura é escrita à mão).

## Apêndice: saída do script por liga (período principal)

<details>
<summary>Premier League</summary>

Snapshot: `data/backtest/E0-2026-10-13.csv` · temporadas avaliadas: 2023, 2024, 2025 · aquecimento: os dois times com ≥ 5 jogos na temporada · 989 jogos avaliados.

Walk-forward: cada jogo só vê jogos de dias anteriores. DC refitado a cada dia de jogo (ξ = 0.0019/dia, janela 3 anos, prior de 2 gols). Heurístico = `computeMatchLambdas` de produção sobre a tabela reconstruída da temporada. Mercado = fechamento 1X2 e over/under 2.5 de-vigado (Pinnacle, senão média).

### Diferenças pareadas (log-loss)

| diferença (a − b) | mercado | n | média | IC 90% |
| --- | --- | --- | --- | --- |
| Dixon-Coles MLE − heurístico (Maher + shrinkage) | over 2.5 | 989 | -0.0106 | [-0.0216, 0.0005] |
| Dixon-Coles MLE − heurístico (Maher + shrinkage) | 1X2 | 989 | -0.0429 | [-0.0585, -0.0279] |
| Dixon-Coles MLE − mercado (fechamento) | 1X2 | 989 | 0.0202 | [0.0114, 0.0293] |
| heurístico (Maher + shrinkage) − mercado (fechamento) | 1X2 | 989 | 0.0632 | [0.0466, 0.0800] |
| Dixon-Coles MLE − taxa-base (últimos 12 meses) | over 2.5 | 989 | 0.0049 | [-0.0061, 0.0152] |
| heurístico (Maher + shrinkage) − taxa-base (últimos 12 meses) | over 2.5 | 989 | 0.0155 | [0.0031, 0.0276] |
| Dixon-Coles MLE − mercado (fechamento) | over 2.5 | 989 | 0.0135 | [0.0058, 0.0213] |
| heurístico (Maher + shrinkage) − mercado (fechamento) | over 2.5 | 989 | 0.0241 | [0.0129, 0.0352] |

**DC vs heurístico em over 2.5:** o IC 90% inclui 0 — sem diferença significativa.

### Todas as temporadas

#### Over 2.5

| estratégia | n | log-loss | Brier |
| --- | --- | --- | --- |
| taxa-base (últimos 12 meses) | 989 | 0.6769 | 0.2419 |
| heurístico (Maher + shrinkage) | 989 | 0.6924 | 0.2492 |
| Dixon-Coles MLE | 989 | 0.6818 | 0.2442 |
| mercado (fechamento) | 989 | 0.6683 | 0.2378 |

#### 1X2

| estratégia | n | log-loss | Brier |
| --- | --- | --- | --- |
| taxa-base (últimos 12 meses) | 989 | 1.0734 | 0.6496 |
| heurístico (Maher + shrinkage) | 989 | 1.0307 | 0.6189 |
| Dixon-Coles MLE | 989 | 0.9878 | 0.5899 |
| mercado (fechamento) | 989 | 0.9676 | 0.5757 |

### 2023

#### Over 2.5

| estratégia | n | log-loss | Brier |
| --- | --- | --- | --- |
| taxa-base (últimos 12 meses) | 329 | 0.6585 | 0.2328 |
| heurístico (Maher + shrinkage) | 329 | 0.6709 | 0.2388 |
| Dixon-Coles MLE | 329 | 0.6723 | 0.2397 |
| mercado (fechamento) | 329 | 0.6500 | 0.2289 |

#### 1X2

| estratégia | n | log-loss | Brier |
| --- | --- | --- | --- |
| taxa-base (últimos 12 meses) | 329 | 1.0562 | 0.6378 |
| heurístico (Maher + shrinkage) | 329 | 0.9985 | 0.5948 |
| Dixon-Coles MLE | 329 | 0.9452 | 0.5586 |
| mercado (fechamento) | 329 | 0.9089 | 0.5326 |

### 2024

#### Over 2.5

| estratégia | n | log-loss | Brier |
| --- | --- | --- | --- |
| taxa-base (últimos 12 meses) | 330 | 0.6840 | 0.2454 |
| heurístico (Maher + shrinkage) | 330 | 0.6831 | 0.2447 |
| Dixon-Coles MLE | 330 | 0.6747 | 0.2408 |
| mercado (fechamento) | 330 | 0.6704 | 0.2389 |

#### 1X2

| estratégia | n | log-loss | Brier |
| --- | --- | --- | --- |
| taxa-base (últimos 12 meses) | 330 | 1.0759 | 0.6519 |
| heurístico (Maher + shrinkage) | 330 | 1.0258 | 0.6165 |
| Dixon-Coles MLE | 330 | 0.9929 | 0.5950 |
| mercado (fechamento) | 330 | 0.9738 | 0.5804 |

### 2025

#### Over 2.5

| estratégia | n | log-loss | Brier |
| --- | --- | --- | --- |
| taxa-base (últimos 12 meses) | 330 | 0.6882 | 0.2475 |
| heurístico (Maher + shrinkage) | 330 | 0.7231 | 0.2640 |
| Dixon-Coles MLE | 330 | 0.6984 | 0.2522 |
| mercado (fechamento) | 330 | 0.6843 | 0.2455 |

#### 1X2

| estratégia | n | log-loss | Brier |
| --- | --- | --- | --- |
| taxa-base (últimos 12 meses) | 330 | 1.0882 | 0.6590 |
| heurístico (Maher + shrinkage) | 330 | 1.0678 | 0.6453 |
| Dixon-Coles MLE | 330 | 1.0252 | 0.6158 |
| mercado (fechamento) | 330 | 1.0199 | 0.6139 |

</details>

<details>
<summary>La Liga</summary>

Snapshot: `data/backtest/SP1-2026-10-13.csv` · temporadas avaliadas: 2023, 2024, 2025 · aquecimento: os dois times com ≥ 5 jogos na temporada · 988 jogos avaliados.

Walk-forward: cada jogo só vê jogos de dias anteriores. DC refitado a cada dia de jogo (ξ = 0.0019/dia, janela 3 anos, prior de 2 gols). Heurístico = `computeMatchLambdas` de produção sobre a tabela reconstruída da temporada. Mercado = fechamento 1X2 e over/under 2.5 de-vigado (Pinnacle, senão média).

### Diferenças pareadas (log-loss)

| diferença (a − b) | mercado | n | média | IC 90% |
| --- | --- | --- | --- | --- |
| Dixon-Coles MLE − heurístico (Maher + shrinkage) | over 2.5 | 988 | -0.0170 | [-0.0292, -0.0039] |
| Dixon-Coles MLE − heurístico (Maher + shrinkage) | 1X2 | 988 | -0.0411 | [-0.0544, -0.0282] |
| Dixon-Coles MLE − mercado (fechamento) | 1X2 | 988 | 0.0206 | [0.0116, 0.0290] |
| heurístico (Maher + shrinkage) − mercado (fechamento) | 1X2 | 988 | 0.0617 | [0.0466, 0.0758] |
| Dixon-Coles MLE − taxa-base (últimos 12 meses) | over 2.5 | 988 | -0.0192 | [-0.0318, -0.0061] |
| heurístico (Maher + shrinkage) − taxa-base (últimos 12 meses) | over 2.5 | 988 | -0.0022 | [-0.0167, 0.0111] |
| Dixon-Coles MLE − mercado (fechamento) | over 2.5 | 988 | 0.0118 | [0.0033, 0.0208] |
| heurístico (Maher + shrinkage) − mercado (fechamento) | over 2.5 | 988 | 0.0289 | [0.0160, 0.0415] |

**DC vs heurístico em over 2.5:** IC 90% inteiro abaixo de 0 — o DC é melhor.

### Todas as temporadas

#### Over 2.5

| estratégia | n | log-loss | Brier |
| --- | --- | --- | --- |
| taxa-base (últimos 12 meses) | 988 | 0.6940 | 0.2504 |
| heurístico (Maher + shrinkage) | 988 | 0.6918 | 0.2483 |
| Dixon-Coles MLE | 988 | 0.6747 | 0.2408 |
| mercado (fechamento) | 988 | 0.6629 | 0.2352 |

#### 1X2

| estratégia | n | log-loss | Brier |
| --- | --- | --- | --- |
| taxa-base (últimos 12 meses) | 988 | 1.0691 | 0.6459 |
| heurístico (Maher + shrinkage) | 988 | 1.0169 | 0.6096 |
| Dixon-Coles MLE | 988 | 0.9758 | 0.5802 |
| mercado (fechamento) | 988 | 0.9552 | 0.5661 |

### 2023

#### Over 2.5

| estratégia | n | log-loss | Brier |
| --- | --- | --- | --- |
| taxa-base (últimos 12 meses) | 329 | 0.6918 | 0.2493 |
| heurístico (Maher + shrinkage) | 329 | 0.7021 | 0.2530 |
| Dixon-Coles MLE | 329 | 0.6619 | 0.2344 |
| mercado (fechamento) | 329 | 0.6572 | 0.2323 |

#### 1X2

| estratégia | n | log-loss | Brier |
| --- | --- | --- | --- |
| taxa-base (últimos 12 meses) | 329 | 1.0839 | 0.6561 |
| heurístico (Maher + shrinkage) | 329 | 1.0178 | 0.6102 |
| Dixon-Coles MLE | 329 | 0.9695 | 0.5784 |
| mercado (fechamento) | 329 | 0.9522 | 0.5672 |

### 2024

#### Over 2.5

| estratégia | n | log-loss | Brier |
| --- | --- | --- | --- |
| taxa-base (últimos 12 meses) | 330 | 0.6949 | 0.2509 |
| heurístico (Maher + shrinkage) | 330 | 0.6890 | 0.2467 |
| Dixon-Coles MLE | 330 | 0.6760 | 0.2414 |
| mercado (fechamento) | 330 | 0.6598 | 0.2337 |

#### 1X2

| estratégia | n | log-loss | Brier |
| --- | --- | --- | --- |
| taxa-base (últimos 12 meses) | 330 | 1.0736 | 0.6494 |
| heurístico (Maher + shrinkage) | 330 | 1.0237 | 0.6141 |
| Dixon-Coles MLE | 330 | 0.9773 | 0.5801 |
| mercado (fechamento) | 330 | 0.9489 | 0.5602 |

### 2025

#### Over 2.5

| estratégia | n | log-loss | Brier |
| --- | --- | --- | --- |
| taxa-base (últimos 12 meses) | 329 | 0.6952 | 0.2510 |
| heurístico (Maher + shrinkage) | 329 | 0.6842 | 0.2451 |
| Dixon-Coles MLE | 329 | 0.6862 | 0.2465 |
| mercado (fechamento) | 329 | 0.6717 | 0.2396 |

#### 1X2

| estratégia | n | log-loss | Brier |
| --- | --- | --- | --- |
| taxa-base (últimos 12 meses) | 329 | 1.0498 | 0.6322 |
| heurístico (Maher + shrinkage) | 329 | 1.0091 | 0.6046 |
| Dixon-Coles MLE | 329 | 0.9805 | 0.5822 |
| mercado (fechamento) | 329 | 0.9646 | 0.5710 |

</details>
