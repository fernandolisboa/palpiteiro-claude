# Calibração: de-vig de Shin e mistura Dixon-Coles + mercado

Snapshot de 2026-10-13. Trilha de calibração da [proposta de pré-previsão, cupom e palpite](https://claude.ai/code/artifact/edae594f-7007-46de-976d-9322e57b7c5e) (seção "Outros betting systems"). Duas perguntas, nas três ligas que já têm snapshot (Brasileirão, Premier League, La Liga):

1. **De-vig.** Shin ou potência tiram a margem da casa melhor que a divisão proporcional de hoje (`computeMarketImpliedProbabilities`, ADR 0018)?
2. **Mistura.** Uma combinação em escala logit do Dixon-Coles com o mercado de-vigado, com um peso por liga, bate o mercado sozinho e o DC sozinho fora da amostra?

Versão em HTML: https://claude.ai/artifact/XfPUmJoS1VzzVjpjphxPxE. Zero chamada à The Odds API, zero LLM. Tudo sai de `scripts/backtest/calibration.ts` sobre os snapshots versionados em `data/backtest/`.

## Resposta curta

- **De-vig: Shin é um pouco melhor, mas o ganho é desprezível.** No 1X2, Shin − proporcional fica entre −0,0009 e +0,0002 de log-loss (8 de 10 recortes negativos, 3 significativos, todos em La Liga, nenhum significativamente pior). No over 2.5 a diferença é zero. Shin desloca a implícita do favorito em +0,9 a +1,5 pp e a da zebra em −0,4 a −0,9 pp, mas trocar o de-vig na simulação de apostas não melhora o retorno de forma consistente (no 1X2 piora um pouco, no over 2.5 oscila dentro do ruído).
- **Mistura: o peso ótimo do Dixon-Coles é zero no 1X2, em toda liga e fonte de odds, em 2023–2025.** No over 2.5 o peso fica entre 0 e 0,27 e a mistura não bate o mercado fora da amostra (+0,0001 a +0,0018). O DC não carrega informação que o mercado já não tenha. Sem a restrição w ≥ 0, o ótimo no 1X2 fica levemente negativo (w ≈ −0,13 a −0,26, ganho de 0,0003 a 0,0009, ajustado na própria amostra): onde o DC discorda do mercado, o resultado tende a ficar do lado do mercado.
- **Consequência para as apostas:** apostar o edge do DC puro com o gate de produção (≥ 5 pp) perde para a linha de fechamento em todo recorte: CLV de −2,7% a −6,6% com IC inteiro abaixo de zero, ROI de −3% a −26%. Isso vale tanto na Pinnacle (margem ~3%) quanto na média das casas (margem ~5%).
- **Produção: nada muda.** Nenhuma das duas coisas melhora log-loss fora da amostra o bastante para justificar uma chave nova. `devigMarket` (Shin/potência) fica disponível em `lib/odds/implied-probability.ts`, sem uso em produção.

## Método

- **Dados.** Os snapshots dos reports 10 e 12. Os de Premier League e La Liga foram regerados com mais 10 colunas: as odds de **pré-fechamento** 1X2 e over/under 2.5 (Pinnacle e média; `PSH`, `AvgH`, `P>2.5`, `Avg>2.5`…), que o football-data.co.uk coleta dias antes do jogo (sexta para jogos de fim de semana, terça para os de meio de semana). É o análogo do snapshot de odds que a produção usa ao analisar (até 24h antes). As colunas antigas ficaram idênticas, linha a linha, então o report 12 continua reproduzível. O Brasileirão só tem fechamento 1X2.
- **Pinnacle some no meio de 2025/26** (Premier League: 210 de 380 jogos; La Liga: 188). As linhas de Pinnacle têm n menor; as da média das casas cobrem tudo.
- **De-vig** não tem parâmetro ajustado, então avalia todo jogo com odds de todas as temporadas. Shin (1993): resolve z ∈ [0, 1) tal que Σ p_i = 1 em p_i = (√(z² + 4(1−z)π_i²/Π) − z) / (2(1−z)). Potência: p_i = π_i^k com Σ = 1. Sem margem (Π ≤ 1), Shin cai no proporcional.
- **Mistura.** Pool log-linear p_i ∝ DC_i^w · mercado_i^(1−w): no over 2.5 é exatamente logit(p) = w·logit(DC) + (1−w)·logit(mercado), no 1X2 é a generalização multinomial. Um parâmetro, w ∈ [0, 1], por liga e mercado. DC refitado a cada dia de jogo, com os mesmos parâmetros de produção dos reports 10 e 12, nas temporadas 2021 a 2025. **Walk-forward por temporada:** o w de 2023 é ajustado em 2021–2022, o de 2024 em 2021–2023, o de 2025 em 2021–2024, e só depois aplicado. O peso nunca vê a temporada em que é avaliado. Também há um peso global (as três ligas juntas, mesmo walk-forward, com o corte por data do primeiro jogo da temporada avaliada, porque os calendários europeu e brasileiro não coincidem). Período principal 2023–2025, como nos reports anteriores.
- **Apostas de valor.** Por jogo e mercado, a seleção de maior edge (DC − implícita de-vigada da mesma casa) entra se o edge ≥ `MIN_EDGE_PP` (5 pp); 1 unidade na odd dessa casa. CLV = odd × p(fechamento de-vigado) − 1. É o critério do gate de Kelly (ADR 0039 D3) e tem bem menos variância que o ROI.
- IC 90% bootstrap das médias pareadas, como nos reports anteriores.

## 1. De-vig

| odds | mercado | Shin − proporcional (faixa nas ligas) | significativos |
| --- | --- | --- | --- |
| Pinnacle (margem 2,7–3,5%) | 1X2 | −0,0004 a −0,0001 | 1 de 5 (La Liga pré-fechamento) |
| média das casas (margem 4,3–6,3%) | 1X2 | −0,0009 a +0,0002 | 2 de 5 (La Liga) |
| Pinnacle e média | over 2.5 | −0,0001 a 0,0000 | 0 de 8 |

Em La Liga o ganho cresce com a margem, como a teoria prevê (mais margem, mais peso do viés favorito–zebra). Nas outras duas ligas não há padrão: na Premier League a média das casas sai até um pouco pior que a Pinnacle, e no Brasileirão nenhum recorte é significativo. A potência tem o mesmo padrão, um pouco maior e mais ruidosa. No over 2.5 as duas seleções costumam ter odds parecidas, e aí os três métodos coincidem.

Tamanho do deslocamento (Shin − proporcional, fechamento 1X2): favorito com odd < 1,6 sobe +0,9 pp na Pinnacle e +1,2 a +1,5 pp na média; zebra com odd > 5 desce −0,4 a −0,5 pp na Pinnacle e −0,6 a −0,9 pp na média. Máximo de 2,7 pp. Perto do gate de 5 pp isso muda algumas apostas, mas a simulação abaixo mostra que o retorno não melhora: com Shin, o ROI do 1X2 piora de 1 a 6 pontos e o CLV fica igual.

## 2. Mistura Dixon-Coles + mercado

Peso walk-forward do DC (2023, 2024, 2025) e diferença pareada de log-loss no período principal; negativo = a mistura é melhor.

| liga | mercado | odds | w | mistura − mercado | mistura − DC |
| --- | --- | --- | --- | --- | --- |
| Brasileirão | 1X2 | fechamento Pinnacle | 0, 0, 0 | 0,0000 | **−0,0227** |
| Premier League | 1X2 | pré-fechamento Pinnacle | 0, 0, 0 | 0,0000 | **−0,0125** |
| Premier League | over 2.5 | pré-fechamento Pinnacle | 0,09, 0, 0 | **+0,0005** | **−0,0098** |
| La Liga | 1X2 | pré-fechamento Pinnacle | 0, 0, 0 | 0,0000 | **−0,0201** |
| La Liga | over 2.5 | pré-fechamento Pinnacle | 0, 0,115, 0,06 | +0,0002 | **−0,0096** |

Com o mercado de fechamento, ou com a média das casas em vez da Pinnacle, o quadro é o mesmo (apêndice): w = 0 em todo 1X2, e no over 2.5 a mistura empata ou perde para o mercado (+0,0001 a +0,0018). O peso global das três ligas também não ajuda.

A mistura só "ganha" do DC porque ela é, na prática, o mercado. A diferença DC − mercado de pré-fechamento no 1X2 (+0,0125 na Premier League, +0,0201 em La Liga) é menor que contra o fechamento, porque o fechamento incorpora mais informação. Mesmo assim, o DC fica atrás.

## 3. O que isso diz sobre as apostas de valor

Período principal, edge ≥ 5 pp, 1 unidade por aposta. Em negrito: IC 90% inteiro abaixo de zero.

| liga | odds da aposta | mercado | apostas | ROI | CLV |
| --- | --- | --- | --- | --- | --- |
| Premier League | pré-fechamento Pinnacle | 1X2 | 368 | −9,4% | **−4,1%** |
| Premier League | pré-fechamento Pinnacle | over 2.5 | 363 | −5,4% | **−2,7%** |
| Premier League | pré-fechamento média | 1X2 | 423 | **−13,9%** | **−5,3%** |
| La Liga | pré-fechamento Pinnacle | 1X2 | 289 | **−18,7%** | **−4,3%** |
| La Liga | pré-fechamento Pinnacle | over 2.5 | 384 | −7,9% | **−3,7%** |
| La Liga | pré-fechamento média | 1X2 | 353 | **−19,0%** | **−6,3%** |
| Brasileirão | fechamento média | 1X2 | 540 | −9,7% | — |

CLV negativo em todo recorte quer dizer que a linha anda contra a aposta do DC entre a sexta e o apito, com folga. É o mesmo sinal da seção 2: o edge do DC puro contra um mercado líquido é, na média, o mercado sabendo algo que o DC não sabe (desfalques, escalação, motivação), não valor.

**O que isso não mede:** o motor `code_jev` de produção não é o DC puro. O JEV ajusta o λ em até ±15% com desfalques e notícias, e é aí que um edge real pode aparecer. Esse backtest de código + JEV (§7 do ADR 0039) continua por fazer: precisa de desfalques point-in-time que o football-data não tem. O gate de CLV do Kelly mede exatamente isso ao vivo.

## Produção

**Nada muda neste PR.** A regra era levar para produção só o que melhorasse log-loss fora da amostra:

- **Shin:** melhora, mas por menos de 0,001 e só no 1X2, e não melhora a seleção de apostas. Ligar exigiria passar o método por `predict.ts`, `lib/odds/scenario.ts` e `lib/view/odds.ts` ao mesmo tempo (a view recalcula a implícita e precisa bater com a persistida), mais uma chave em `/admin/settings`. O custo não paga o ganho. A função fica pronta em `devigMarket` se um dia a referência passar a ser uma casa de margem alta, onde o ganho é maior.
- **Mistura:** w = 0. Ligar "a mistura" seria trocar a probabilidade do modelo pela do mercado, o que zera todo edge.

**Recomendação para a Fase 1 da proposta** (área da thread de pré-previsão, não implementada aqui): a "leitura do modelo" pode mostrar probabilidade e odd justa do DC normalmente, mas o edge do DC puro contra a odd de referência não deve aparecer como sinal de valor. Ele é negativo em CLV em todo recorte. Edge que conta é o que vem do ajuste JEV/notícias por cima do DC.

## Reproduzir

```bash
npx tsx scripts/backtest/calibration.ts --out /tmp/report-13.md   # ~90 s
```

Os snapshots europeus com as colunas de pré-fechamento saem de `scripts/backtest/build-football-data-snapshot.ts`, com as mesmas instruções de download do report 12.

## Apêndice: saída completa do script

### De-vig: Shin e potência vs proporcional

Todas as temporadas de cada snapshot, todo jogo com odds. Log-loss do proporcional e diferença pareada (método − proporcional) com IC 90%; negativo = o método é melhor. Em negrito: IC inteiro de um lado do 0.

| liga | odds | casa | mercado | n | margem média | log-loss proporcional | Shin − proporcional | potência − proporcional |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Brasileirão | fechamento | Pinnacle | 1X2 | 2236 | 3.5% | 1.0056 | -0.0002 [-0.0006, +0.0003] | -0.0001 [-0.0007, +0.0005] |
| Brasileirão | fechamento | média | 1X2 | 2557 | 6.3% | 1.0062 | -0.0005 [-0.0011, +0.0002] | -0.0005 [-0.0014, +0.0004] |
| Premier League | fechamento | Pinnacle | 1X2 | 2870 | 2.7% | 0.9494 | -0.0001 [-0.0006, +0.0003] | -0.0002 [-0.0008, +0.0004] |
| Premier League | fechamento | Pinnacle | over 2.5 | 2479 | 3.0% | 0.6729 | 0.0000 [-0.0002, +0.0002] | 0.0000 [-0.0004, +0.0004] |
| Premier League | fechamento | média | 1X2 | 2660 | 4.3% | 0.9639 | +0.0001 [-0.0005, +0.0007] | +0.0002 [-0.0007, +0.0010] |
| Premier League | fechamento | média | over 2.5 | 2660 | 4.9% | 0.6734 | 0.0000 [-0.0003, +0.0004] | +0.0001 [-0.0004, +0.0006] |
| Premier League | pré-fechamento | Pinnacle | 1X2 | 2870 | 2.9% | 0.9531 | -0.0001 [-0.0006, +0.0003] | -0.0002 [-0.0009, +0.0004] |
| Premier League | pré-fechamento | Pinnacle | over 2.5 | 2478 | 3.1% | 0.6735 | 0.0000 [-0.0003, +0.0002] | 0.0000 [-0.0004, +0.0004] |
| Premier League | pré-fechamento | média | 1X2 | 2660 | 4.5% | 0.9677 | +0.0002 [-0.0004, +0.0008] | +0.0003 [-0.0006, +0.0012] |
| Premier League | pré-fechamento | média | over 2.5 | 2660 | 5.1% | 0.6742 | 0.0000 [-0.0003, +0.0003] | 0.0000 [-0.0005, +0.0005] |
| La Liga | fechamento | Pinnacle | 1X2 | 2848 | 2.7% | 0.9725 | -0.0002 [-0.0006, +0.0002] | -0.0003 [-0.0008, +0.0003] |
| La Liga | fechamento | Pinnacle | over 2.5 | 2465 | 3.0% | 0.6676 | 0.0000 [-0.0002, +0.0003] | 0.0000 [-0.0003, +0.0004] |
| La Liga | fechamento | média | 1X2 | 2660 | 4.7% | 0.9697 | **-0.0008** [-0.0014, -0.0002] | **-0.0010** [-0.0019, -0.0002] |
| La Liga | fechamento | média | over 2.5 | 2660 | 5.2% | 0.6682 | 0.0000 [-0.0004, +0.0004] | 0.0000 [-0.0006, +0.0006] |
| La Liga | pré-fechamento | Pinnacle | 1X2 | 2846 | 3.0% | 0.9757 | **-0.0004** [-0.0008, -0.0000] | **-0.0006** [-0.0011, -0.0000] |
| La Liga | pré-fechamento | Pinnacle | over 2.5 | 2461 | 3.2% | 0.6699 | -0.0001 [-0.0003, +0.0002] | -0.0001 [-0.0004, +0.0003] |
| La Liga | pré-fechamento | média | 1X2 | 2660 | 4.8% | 0.9717 | **-0.0009** [-0.0015, -0.0003] | **-0.0013** [-0.0021, -0.0004] |
| La Liga | pré-fechamento | média | over 2.5 | 2660 | 5.3% | 0.6709 | -0.0001 [-0.0005, +0.0003] | -0.0001 [-0.0006, +0.0005] |

### Mistura Dixon-Coles + mercado

Pool log-linear p ∝ DC^w · mercado^(1−w) (no over 2.5 é o logit ponderado), mercado de-vigado proporcional. w da temporada s ajustado só em 2021…s−1 da mesma liga (por liga) ou das três ligas juntas (global). Período principal 2023–2025. Diferença pareada de log-loss; negativo = a mistura é melhor. A Pinnacle some do football-data no meio de 2025/26, então as linhas de Pinnacle têm n menor que as da média.

#### fechamento, Pinnacle

| liga | mercado | n | log-loss DC | log-loss mercado | log-loss mistura | mistura − mercado | mistura − DC | global − mercado | w (2023, 2024, 2025) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Brasileirão | 1X2 | 943 | 1.0183 | 0.9955 | 0.9955 | 0.0000 [-0.0000, +0.0000] | **-0.0227** [-0.0332, -0.0119] | 0.0000 [-0.0000, +0.0000] | 0.000, 0.000, 0.000 |
| Premier League | 1X2 | 819 | 0.9708 | 0.9512 | 0.9512 | 0.0000 [-0.0000, +0.0000] | **-0.0196** [-0.0294, -0.0095] | 0.0000 [-0.0000, +0.0000] | 0.000, 0.000, 0.000 |
| Premier League | over 2.5 | 809 | 0.6768 | 0.6658 | 0.6676 | **+0.0018** [+0.0003, +0.0032] | **-0.0092** [-0.0169, -0.0013] | +0.0004 [-0.0003, +0.0012] | 0.270, 0.000, 0.015 |
| La Liga | 1X2 | 796 | 0.9700 | 0.9489 | 0.9489 | 0.0000 [-0.0000, +0.0000] | **-0.0212** [-0.0302, -0.0118] | 0.0000 [-0.0000, +0.0000] | 0.000, 0.000, 0.000 |
| La Liga | over 2.5 | 794 | 0.6708 | 0.6599 | 0.6603 | +0.0005 [-0.0005, +0.0014] | **-0.0105** [-0.0195, -0.0015] | -0.0004 [-0.0013, +0.0005] | 0.000, 0.155, 0.075 |

#### fechamento, média das casas

| liga | mercado | n | log-loss DC | log-loss mercado | log-loss mistura | mistura − mercado | mistura − DC | global − mercado | w (2023, 2024, 2025) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Brasileirão | 1X2 | 987 | 1.0189 | 0.9974 | 0.9974 | 0.0000 [-0.0000, +0.0000] | **-0.0215** [-0.0314, -0.0108] | 0.0000 [-0.0000, +0.0000] | 0.000, 0.000, 0.000 |
| Premier League | 1X2 | 989 | 0.9878 | 0.9677 | 0.9677 | 0.0000 [-0.0000, +0.0000] | **-0.0201** [-0.0289, -0.0113] | 0.0000 [-0.0000, +0.0000] | 0.000, 0.000, 0.000 |
| Premier League | over 2.5 | 989 | 0.6818 | 0.6685 | 0.6697 | **+0.0012** [+0.0001, +0.0023] | **-0.0121** [-0.0190, -0.0051] | +0.0003 [-0.0002, +0.0008] | 0.245, 0.000, 0.035 |
| La Liga | 1X2 | 988 | 0.9758 | 0.9547 | 0.9547 | 0.0000 [-0.0000, +0.0000] | **-0.0211** [-0.0293, -0.0126] | 0.0000 [-0.0000, +0.0000] | 0.000, 0.000, 0.000 |
| La Liga | over 2.5 | 988 | 0.6747 | 0.6636 | 0.6639 | +0.0003 [-0.0004, +0.0010] | **-0.0108** [-0.0192, -0.0028] | -0.0002 [-0.0007, +0.0004] | 0.000, 0.130, 0.070 |

#### pré-fechamento, Pinnacle

| liga | mercado | n | log-loss DC | log-loss mercado | log-loss mistura | mistura − mercado | mistura − DC | global − mercado | w (2023, 2024, 2025) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Premier League | 1X2 | 819 | 0.9708 | 0.9583 | 0.9583 | 0.0000 [-0.0000, +0.0000] | **-0.0125** [-0.0218, -0.0032] | 0.0000 [-0.0000, +0.0000] | 0.000, 0.000, 0.000 |
| Premier League | over 2.5 | 808 | 0.6771 | 0.6667 | 0.6673 | **+0.0005** [+0.0001, +0.0010] | **-0.0098** [-0.0174, -0.0018] | **+0.0002** [+0.0000, +0.0003] | 0.090, 0.000, 0.000 |
| La Liga | 1X2 | 797 | 0.9704 | 0.9503 | 0.9503 | 0.0000 [-0.0000, -0.0000] | **-0.0201** [-0.0287, -0.0116] | 0.0000 [-0.0000, -0.0000] | 0.000, 0.000, 0.000 |
| La Liga | over 2.5 | 793 | 0.6713 | 0.6615 | 0.6617 | +0.0002 [-0.0004, +0.0009] | **-0.0096** [-0.0184, -0.0011] | -0.0001 [-0.0003, +0.0001] | 0.000, 0.115, 0.060 |

#### pré-fechamento, média das casas

| liga | mercado | n | log-loss DC | log-loss mercado | log-loss mistura | mistura − mercado | mistura − DC | global − mercado | w (2023, 2024, 2025) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Premier League | 1X2 | 989 | 0.9878 | 0.9737 | 0.9737 | 0.0000 [-0.0000, +0.0000] | **-0.0141** [-0.0226, -0.0059] | 0.0000 [-0.0000, +0.0000] | 0.000, 0.000, 0.000 |
| Premier League | over 2.5 | 989 | 0.6818 | 0.6698 | 0.6702 | +0.0004 [-0.0000, +0.0008] | **-0.0116** [-0.0192, -0.0044] | +0.0002 [-0.0001, +0.0005] | 0.090, 0.000, 0.000 |
| La Liga | 1X2 | 988 | 0.9758 | 0.9571 | 0.9571 | 0.0000 [-0.0000, -0.0000] | **-0.0186** [-0.0263, -0.0109] | 0.0000 [-0.0000, -0.0000] | 0.000, 0.000, 0.000 |
| La Liga | over 2.5 | 988 | 0.6747 | 0.6650 | 0.6651 | +0.0001 [-0.0007, +0.0009] | **-0.0096** [-0.0170, -0.0022] | -0.0002 [-0.0005, +0.0002] | 0.035, 0.150, 0.095 |

#### Peso ajustado em 2021–2025 inteiro (in-sample, referência)

| liga | mercado | w fechamento Pinnacle | w fechamento média | w pré-fechamento Pinnacle | w pré-fechamento média |
| --- | --- | --- | --- | --- | --- |
| Brasileirão | 1X2 | 0.000 | 0.000 | — | — |
| Premier League | 1X2 | 0.000 | 0.000 | 0.000 | 0.000 |
| Premier League | over 2.5 | 0.110 | 0.015 | 0.025 | 0.000 |
| La Liga | 1X2 | 0.000 | 0.000 | 0.000 | 0.000 |
| La Liga | over 2.5 | 0.065 | 0.030 | 0.060 | 0.075 |

#### Ótimo sem restrição de w (in-sample, 2021–2025, mercado de fechamento da média)

| liga | mercado | w ótimo em [−1, 1] | ganho de log-loss vs w = 0 |
| --- | --- | --- | --- |
| Brasileirão | 1X2 | -0.130 | -0.0003 |
| Premier League | 1X2 | -0.165 | -0.0004 |
| Premier League | over 2.5 | 0.015 | 0.0000 |
| La Liga | 1X2 | -0.260 | -0.0009 |
| La Liga | over 2.5 | 0.030 | 0.0000 |

### Apostas de valor do Dixon-Coles puro

O jeito que a produção decide, sem JEV nem notícias: por jogo e mercado, a seleção de maior edge (DC − implícita de-vigada da mesma casa) entra se o edge ≥ 5 pp; 1 unidade na odd. ROI = lucro médio por unidade apostada; CLV = odd × p(fechamento Pinnacle de-vigado, senão média) − 1. Período principal 2023–2025, IC 90% bootstrap. Apostar no fechamento tem CLV ≈ −margem por definição, então ali só o ROI conta.

| liga | odds da aposta | mercado | de-vig do edge | apostas | ROI | CLV |
| --- | --- | --- | --- | --- | --- | --- |
| Brasileirão | fechamento, média | 1X2 | proporcional | 540 | -9.7% [-20.1%, +1.8%] | — |
| Brasileirão | fechamento, média | 1X2 | Shin | 555 | **-11.9%** [-23.1%, -1.0%] | — |
| Premier League | pré-fechamento, Pinnacle | 1X2 | proporcional | 368 | -9.4% [-21.9%, +3.5%] | **-4.1%** [-4.8%, -3.3%] |
| Premier League | pré-fechamento, Pinnacle | 1X2 | Shin | 373 | -10.8% [-23.5%, +2.1%] | **-4.0%** [-4.8%, -3.2%] |
| Premier League | pré-fechamento, Pinnacle | over 2.5 | proporcional | 363 | -5.4% [-14.5%, +4.0%] | **-2.7%** [-3.2%, -2.1%] |
| Premier League | pré-fechamento, Pinnacle | over 2.5 | Shin | 369 | -4.6% [-14.5%, +4.4%] | **-2.7%** [-3.2%, -2.2%] |
| Premier League | pré-fechamento, média | 1X2 | proporcional | 423 | **-13.9%** [-25.6%, -1.7%] | **-5.3%** [-5.9%, -4.6%] |
| Premier League | pré-fechamento, média | 1X2 | Shin | 428 | **-15.5%** [-27.4%, -3.8%] | **-5.5%** [-6.2%, -4.8%] |
| Premier League | pré-fechamento, média | over 2.5 | proporcional | 444 | **-8.8%** [-17.4%, -0.3%] | **-4.6%** [-5.1%, -4.2%] |
| Premier League | pré-fechamento, média | over 2.5 | Shin | 455 | **-9.0%** [-17.3%, -0.3%] | **-4.7%** [-5.2%, -4.2%] |
| Premier League | fechamento, média | 1X2 | proporcional | 457 | -8.5% [-21.1%, +4.2%] | — |
| Premier League | fechamento, média | 1X2 | Shin | 472 | -10.5% [-23.0%, +2.1%] | — |
| Premier League | fechamento, média | over 2.5 | proporcional | 469 | -8.2% [-16.6%, +0.7%] | — |
| Premier League | fechamento, média | over 2.5 | Shin | 474 | -7.0% [-15.4%, +1.6%] | — |
| La Liga | pré-fechamento, Pinnacle | 1X2 | proporcional | 289 | **-18.7%** [-31.1%, -4.7%] | **-4.3%** [-5.1%, -3.5%] |
| La Liga | pré-fechamento, Pinnacle | 1X2 | Shin | 293 | **-22.8%** [-35.9%, -8.4%] | **-4.4%** [-5.2%, -3.6%] |
| La Liga | pré-fechamento, Pinnacle | over 2.5 | proporcional | 384 | -7.9% [-16.4%, +0.1%] | **-3.7%** [-4.2%, -3.2%] |
| La Liga | pré-fechamento, Pinnacle | over 2.5 | Shin | 379 | -6.9% [-15.2%, +1.2%] | **-3.8%** [-4.3%, -3.3%] |
| La Liga | pré-fechamento, média | 1X2 | proporcional | 353 | **-19.0%** [-29.5%, -8.1%] | **-6.3%** [-7.0%, -5.7%] |
| La Liga | pré-fechamento, média | 1X2 | Shin | 346 | **-25.0%** [-35.6%, -13.4%] | **-6.6%** [-7.3%, -5.9%] |
| La Liga | pré-fechamento, média | over 2.5 | proporcional | 475 | -6.4% [-13.8%, +0.7%] | **-5.3%** [-5.7%, -4.9%] |
| La Liga | pré-fechamento, média | over 2.5 | Shin | 469 | -5.1% [-12.8%, +2.5%] | **-5.3%** [-5.8%, -4.9%] |
| La Liga | fechamento, média | 1X2 | proporcional | 432 | **-21.6%** [-32.2%, -10.5%] | — |
| La Liga | fechamento, média | 1X2 | Shin | 423 | **-25.9%** [-36.2%, -14.9%] | — |
| La Liga | fechamento, média | over 2.5 | proporcional | 522 | -2.6% [-10.0%, +4.6%] | — |
| La Liga | fechamento, média | over 2.5 | Shin | 512 | -3.2% [-10.9%, +4.7%] | — |

