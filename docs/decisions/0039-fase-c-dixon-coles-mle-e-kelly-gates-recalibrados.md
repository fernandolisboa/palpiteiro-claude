# ADR 0039 — Fase C dividida: Dixon-Coles MLE validado por backtest; Kelly fracionário gated em CLV

## Status

Accepted (2026-09-24; o dono escolheu dividir a Fase C) — Report 03 rec. 6 (Dixon-Coles MLE) + rec. 7 (Kelly fracionário, emenda ao ADR 0019). **Substitui o gate de dados** que o Report 03 e o `HANDOFF-audit-continuation.md` fixaram para a Fase C (≥150 apostas liquidadas + reliability slope ∈ [0.8, 1.2] + Brier ≤ no-vig). Esse gate é **estatisticamente inalcançável** no volume real do app (um usuário) e **reprova um modelo bem calibrado** mesmo em volume alto (Contexto). Este ADR troca o gate por dois critérios, **um por entrega**, cada um medível com o dado que o app consegue ter.

> **Escopo:** IA + quant. Decide **o quê** e **com que evidência** cada metade da Fase C entra. **Não** implementa: o build de cada metade é uma issue downstream (DC primeiro). **Fora de escopo:** blend computado `p = w·P_poisson + (1−w)·P_LLM` (rec. 8), `/fixtures/statistics` (rec. 9), estender o baseline estatístico a BTTS/1X2 no prompt (segue a disciplina do ADR 0037 D5: um mercado por vez, com bump).

## Contexto

**O gate antigo e por que ele falha.** O Report 03 (rec. 7) condicionou a Fase C a: `/admin/calibration` mostrar slope ∈ [0.8, 1.2] e Brier ≤ baseline no-vig sobre ≥150 apostas resolvidas. Três problemas:

1. **O slope não era computado.** Até o PR #496 (issue #495), `lib/calibration/metrics.ts` tinha Brier, log-loss e bins, mas nenhum slope. O gate não podia ser lido.
2. **Volume.** "Apostas" aqui são as análises do app que recomendaram aposta (`recommendation ≠ pass`), não apostas feitas na casa. Com o gate de edge do ADR 0038, a maioria das análises vira `pass`, e o app tem, na prática, um usuário (o dono). 150 recomendações liquidadas de over/under é um horizonte de muitos meses, possivelmente nunca.
3. **O slope é ruído no over/under.** As probabilidades de over/under vivem numa faixa estreita (≈ 0.38–0.68), ou seja, o `logit(p)` tem pouca variância, e a variância do estimador do slope é ∝ 1/(n·Var(logit p)). Simulação (modelo **perfeitamente calibrado**, p ~ U(0.38, 0.68), recalibração logística por MLE, 400 réplicas):

   | n | desvio-padrão do slope | P(slope ∈ [0.8, 1.2]) |
   | --- | --- | --- |
   | 50 | 0.91 | 18% |
   | 150 | 0.48 | 32% |
   | 500 | 0.26 | 55% |
   | 1000 | 0.19 | 70% |

   Com 150 amostras, o gate **reprova um modelo perfeito 2 de cada 3 vezes**. Não é um critério de decisão; é uma moeda viciada.

**O que o gate queria proteger.** Duas coisas diferentes, misturadas num critério só:
- **Dixon-Coles MLE (rec. 6)** substitui o λ heurístico (Maher + shrinkage sobre splits de standings, `lib/quant/scoreline-model.ts` `estimateLambdas`, ADR 0036/0037) por ratings ataque/defesa ajustados por máxima verossimilhança com ρ e decaimento temporal. É um **modelo estatístico de resultados**: a pergunta "o DC prevê melhor que o heurístico?" se responde com **resultados históricos**, que existem aos milhares e não dependem de quantos usuários o app tem.
- **Kelly fracionário (rec. 7)** troca as bandas de stake (ADR 0019: 1u/2u/3u por edge + confiança) por `f* = (p·o − 1)/(o − 1)`. O risco do Kelly é o `p` do modelo estar **overconfident**, de modo que o stake cresce exatamente onde o edge é ilusório. A pergunta aqui é "as recomendações têm edge real?", e o sinal de **menor variância** pra isso é o **CLV** (closing line value): a odd recomendada contra a odd de fechamento. A captura de CLV está ligada desde o #487 (`lib/odds/clv.ts`, `lib/db/queries/clv-snapshots.ts`) e o sinal por aposta sai no kickoff, sem esperar o resultado. O CLV converge com dezenas de apostas, não centenas de resultados.

## Decisão

**1. A Fase C se divide em duas entregas independentes, cada uma com seu gate.** O DC não espera o Kelly, e o Kelly não espera o DC.

**2. Dixon-Coles MLE: gate = backtest walk-forward contra o λ heurístico atual.**
- **Dados:** snapshot versionado de `football-data.co.uk/new/BRA.csv` em `data/backtest/` (Série A 2022–2025 completas, 380 jogos cada; 2026 parcial), com resultados e odds de **fechamento 1X2** (Pinnacle, média, máxima, Betfair). É arquivo estático lido no backtest, **não** é provider de runtime: não passa por `lib/providers/`, e o app em produção não o consome. **Zero crédito da Odds API e zero chamada à api-football.** O arquivo não tem odds de over/under, então o critério de P(over 2.5) é modelo contra modelo em resultados, e o 1X2 ganha também o benchmark de mercado (fechamento Pinnacle/média de-vigado).
- **Protocolo:** walk-forward por data. Antes de cada jogo, ajusta o DC só com jogos anteriores a ele (decaimento exponencial ξ, ρ de Dixon-Coles, vantagem de mando). O heurístico usa os standings reconstruídos com os mesmos jogos anteriores, pela escada de degradação do ADR 0036 D3. Ambos preveem P(over 2.5) e P(1X2). Os jogos das 5 primeiras rodadas de cada temporada ficam fora da métrica (aquecimento).
- **Critério de GO:** log-loss médio do DC **menor** que o do heurístico em P(over 2.5), com o **limite superior do IC 90% bootstrap pareado** da diferença (DC − heurístico) **< 0**, nas temporadas 2023–2025 (2022 serve de aquecimento do DC). O 1X2 (DC vs heurístico vs fechamento de-vigado) é reportado junto, como diagnóstico, sem bloquear.
- **Se passar:** o DC substitui o `estimateLambdas` como fonte do bloco `scorelineModel` injetado no over/under (ADR 0037 D1). Isso exige **bump de versão** do cartucho (`over_under_v3.x`), com o mesmo contrato de saída e a mesma escada de degradação (DC sem jogos suficientes da equipe → cai para o heurístico → cai para ausente). Ratings ficam numa tabela `team_ratings` (migration própria no build), com refit semanal via cron. O ajuste é feito em TypeScript, sem Python: cerca de 40 parâmetros por liga, resolvidos por Newton/gradiente.
- **Se não passar:** o DC não entra, e o resultado do backtest fica registrado no build como evidência. O heurístico segue.
- **Loader e runner compartilhados:** `lib/backtest/` (loader puro do snapshot, mapa de nomes de time, features point-in-time calculadas só com jogos anteriores a cada partida) e um runner em `scripts/backtest/` com estratégias plugáveis `(match, features) => probs`. É **um só** e serve também a avaliação do JEV (thread "JEV para gerar apostas"), que compara Sonnet, código+JEV e mercado nas mesmas rodadas. O DC entra como estratégia, e o JEV e o Sonnet entram como outras, com as mesmas métricas (log-loss, Brier e CLV contra o fechamento). Nenhum dos dois cria um segundo loader.
- **Posição de ajustes qualitativos (se o JEV for adotado):** a ordem do pipeline fica probabilidade estatística (DC, ou heurístico como fallback) → ajuste qualitativo limitado (JEV) → edge de-vigado → gate de edge (ADR 0038) → stake. O backtest deste ADR mede só o primeiro elo. O ajuste do JEV é julgado no ADR/avaliação dele.
- **Monitoramento ao vivo (não é gate):** o `/admin/calibration` continua medindo P(over) do modelo contra resultados e contra o mercado no-vig, **incluindo os passes** (PR #496). É diagnóstico contínuo, não critério de entrada.

**3. Kelly fracionário: gate = CLV positivo nas recomendações; o slope vira diagnóstico.**
- **Amostra:** recomendações liquidadas (`recommendation ≠ pass`) de qualquer mercado com closing line capturada.
- **Critério de GO:** **n ≥ 50** e **Δ no-vig médio > 0** com o **limite inferior do IC 90% bootstrap > 0**. O Δ no-vig (`noVigDeltaPp` de `lib/odds/clv.ts`, em pp, positivo = bateu o fechamento) é a métrica escolhida porque já vem sem margem, ao contrário da razão de odds.
- **Critério de guarda (bloqueia):** log-loss skill do modelo vs mercado no-vig **sobre todas as análises de over/under** (apostas + passes) não pode ser significativamente negativo, ou seja, o limite superior do IC 90% não pode ficar abaixo de 0. Isso impede ligar o Kelly num modelo que o mercado bate com folga.
- **Fórmula quando passar:** quarter-Kelly sobre uma banca nominal de 100u, `stake_units = clamp(round_0.5(25 · f*), 0.5, 3)` com `f* = (p·o − 1)/(o − 1)`, onde `p` é a probabilidade do modelo para a seleção e `o` é a odd na recomendação. O teto de 3u do ADR 0019 é mantido. Continua congelado na row, e as predições antigas não são mutadas (ADR 0019 D3/D6).
- **Até o gate passar, as bandas do ADR 0019 ficam.**
- **Ativação automática (#503):** o quarter-Kelly já está no código. O `predict` o usa sozinho quando o gate fica "pronto", sem deploy e sem flag manual (padrão sem-gates do dono). A leitura do gate é compartilhada com o `/admin/calibration` (`lib/calibration/kelly-live.ts`), memoizada por 1h e **fail-closed**: erro de leitura → bandas. O kill-switch `ai_config.enable_kelly_staking` (default ON) desliga o Kelly a qualquer momento (→ bandas sempre).
- **Slope:** continua exibido no `/admin/calibration` (resumo e por versão de prompt), como **diagnóstico**, não gate. Um slope bem abaixo de 1 com n grande é sinal pra investigar overconfidence, mas não decide nada sozinho.

**4. O `/admin/calibration` exibe o gate do Kelly.** A seção "gate do kelly" (`lib/calibration/phase-c-gate.ts`, `evaluateKellyGate`) mostra as três checagens da D3, com IC por bootstrap determinístico (semente fixa, o mesmo dado dá o mesmo IC). O CLV vem das recomendações de **todos** os usuários (é o modelo que está sendo medido), deduplicadas por (jogo, mercado) como no dashboard (ADR 0020). O Dixon-Coles não aparece como checagem ali: o gate dele é o relatório do backtest. O slope fica só no resumo e na tabela por versão.

**5. Avaliação legal (Brasil): permitido, com salvaguardas que já existem.** O dono delegou a revisão legal (2026-09-24). Análise:
- **Lei 14.790/2023** (apostas de quota fixa) regula a **exploração** da modalidade: quem capta apostas precisa de autorização do Ministério da Fazenda (agente operador). O Palpiteiro **não capta aposta, não recebe dinheiro, não intermedeia pagamento e não tem link de afiliado para casa**. É uma ferramenta de análise e, portanto, não é agente operador. Sugerir stake em **unidades** é conteúdo analítico, da mesma natureza das bandas do ADR 0019 que já existem. Kelly muda o cálculo do número, não a natureza da saída.
- **Publicidade e jogo responsável** (regulamentação da SPA/MF sob a Lei 14.790, dirigida a operadores e seus parceiros de divulgação): o app não é operador nem afiliado, mas adotamos as mesmas linhas como boa prática, porque o risco regulatório e de consumidor (CDC, art. 37, publicidade enganosa, se houver monetização) está justamente em **prometer ganho**. Regras: stake **só em unidades**, nunca em R$ nem como "% da sua renda"; **nenhuma copy** de "lucro garantido", "renda extra" ou "aposta certa"; aviso 18+ e de jogo responsável mantidos onde já existem; teto de 3u mantido (Kelly nunca recomenda exposição maior que as bandas de hoje).
- **LGPD:** nada muda. Não há dado pessoal novo; `team_ratings` é dado esportivo público.
- **Conclusão:** aprovado. Nenhuma ação exige o dono. Se um dia houver monetização ou afiliação com casa de apostas, a análise tem de ser refeita (Report 05/07).

## Alternativas consideradas e rejeitadas

1. **Manter o gate original (150 apostas + slope ∈ [0.8, 1.2] + Brier).** Rejeitada: reprova um modelo perfeito ~68% das vezes em n=150 (tabela do Contexto), e n=150 recomendações talvez nunca chegue com um usuário.
2. **Mesmo gate, contando todas as análises (passes incluídos) em vez de só apostas.** Rejeitada como gate: resolve parte do volume, mas não o ruído do slope (70% de acerto só em n=1000). Os passes entram no monitoramento (PR #496).
3. **Trocar o slope por um IC do slope que contenha 1.** Rejeitada: com IC de ±1 em n=150, esse critério aprova qualquer coisa. Seria o erro oposto.
4. **Gerar volume rodando análise LLM em todo jogo por cron.** Rejeitada: custa dinheiro real por chamada (CLAUDE.md, gotcha de custo) e créditos da Odds API (500/mês), para medir justo o que o backtest mede de graça no caso do DC.
5. **Backtest também para o Kelly (odds históricas).** Rejeitada: exige odds históricas da Odds API (plano pago/créditos) e mediria o modelo sem o LLM. O Kelly vai dimensionar o `p` que o LLM emite, e o CLV mede esse `p` ao vivo.
6. **Kelly cheio ou meio-Kelly.** Rejeitada: erro de estimação em `p` faz o Kelly cheio super-apostar (Report 03 rec. 7). Quarter-Kelly com teto 3u é o conservador.

## Consequências

- **(+)** A Fase C deixa de estar travada por um critério que não podia ser cumprido. O DC pode começar já, com evidência histórica.
- **(+)** Cada entrega é julgada pela evidência que responde à pergunta dela: resultados para um modelo de resultados, CLV para o edge das apostas.
- **(+)** Custo zero de API: o backtest lê um CSV versionado, e o CLV ao vivo já é capturado.
- **(−)** O backtest mede o DC contra o heurístico **sem o LLM no meio**. O efeito no `p` final do LLM (que ancora no baseline, ADR 0037 D4) só aparece ao vivo. Mitigação: o bump de versão separa as calibrações no `/admin/calibration` por `promptVersion`.
- **(−)** O CLV depende de a closing line ser capturada (flag `enableClvCapture`). Se a captura falhar ou for desligada, o gate do Kelly não anda. Aceito: sem CLV não há evidência de edge, e as bandas ficam.
- **(−)** Brasileirão 2024/2025 tem distribuição de gols diferente da Champions (a outra liga ativa). O backtest cobre a liga de maior volume; a Champions entra com a escada de degradação (poucos jogos por time → heurístico) até ter histórico próprio.
- **(±)** O slope sai de critério e vira diagnóstico. O PR #496 ajusta a seção do gate de acordo.

## Referências

Report 03 (`docs/reports/03-ia-cientifica.md`, rec. 6/7/8). `docs/handoffs/HANDOFF-audit-continuation.md` (gate antigo). ADRs: **0019** (bandas de stake: ficam até o gate do Kelly), **0036** (`lib/quant/scoreline-model.ts`, escada de degradação D3), **0037** (bloco `scorelineModel` no over/under: o seam que o DC alimenta), **0038** (gate de edge: a razão de a maioria das análises ser `pass`). Issues/PRs: #487 (captura de CLV), #495/#496 (slope, passes no harness, seção do gate), #502 (backtest + DC), #503 (Kelly, bloqueada pelo gate). Código: `lib/calibration/metrics.ts` (`calibrationSlope`), `lib/calibration/phase-c-gate.ts`, `lib/odds/clv.ts` (`noVigDeltaPp`), `lib/quant/scoreline-model.ts` (`estimateLambdas`, `scorelineMatrix` com τ de DC já implementado), `lib/ai/staking.ts` (bandas). Legal: Lei 14.790/2023; regulamentação de publicidade e jogo responsável da SPA/MF; CDC art. 37.
