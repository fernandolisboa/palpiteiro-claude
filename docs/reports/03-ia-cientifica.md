# Report 03 — IA baseada em ciência (Poisson, ELO, Kelly, calibração)

> Auditoria da modelagem de IA + design de uma camada científica (2026-07-04). Aterrada em
> `lib/ai/predict.ts`, `lib/ai/staking.ts`, `lib/ai/markets/*`, `lib/odds/*` e ADRs
> 0018/0019/0021. **Nota:** grounded no checkout local; a conclusão central (não existe
> modelo estatístico) continua valendo em `origin/main` — o grade-my-bet v1 (#412) reusa
> distribuições existentes, não introduz Poisson.

## Veredito geral

A **matemática do lado das odds é rigorosa** — probabilidade implícita normalizada pelo
overround do mercado completo (ADR 0018, nunca `1/odd` cru), edge por-seleção, EV/break-even
deliberadamente na odd crua, e CLV com duas métricas. **Mas toda probabilidade de MODELO
vem do LLM** (`confidence_pct`, `prob_home/draw/away`, `cell_probs` de 16 células) — **não
existe nenhum modelo estatístico no código**: zero Poisson, Dixon-Coles, ELO, Kelly,
Brier ou log-loss (busca no repo confirma).

Pior: o LLM **vê as probabilidades implícitas no input** e auto-policia a regra de edge de
5pp dentro do prompt — então o "edge" é a diferença entre um número **não-ancorado e
não-medido** do LLM e o mercado, e a miscalibração é **indetectável hoje** porque não existe
métrica de calibração (embora o dado necessário — `model_prob_pct` por seleção + resultados
liquidados — já esteja persistido).

**O upgrade nº 1:** um modelo de distribuição de placar (Poisson/Dixon-Coles) no código que
**todos os mercados de gol leem**, injetado nos cartuchos como **fatos estruturados** —
exatamente o padrão que o `palpites_v7` já provou — + um **harness de calibração**
(Brier/log-loss/reliability) por mercado e versão de prompt. Kelly fica **deferido
corretamente** (ADR 0019 acertou) até a calibração provar que as probabilidades prestam.

**Sinergia crítica:** esse mesmo modelo de placar é o que o rework da "aposta livre"
(Report 04) precisa pra precificar props (placar exato, margem, clean sheet, gols 1º tempo,
quem marca primeiro). **Construir `lib/quant` uma vez, usar nos dois.**

## Achados

| # | Prioridade | Achado |
|---|---|---|
| 1 | **alta** | Toda prob. de modelo é elicitada do LLM; nenhum modelo estatístico existe |
| 2 | **alta** | Sem coerência cross-mercado: cada mercado vem de uma call de LLM separada, nunca reconciliada (o correct_score de 16 células **implica** P(over), P(BTTS), 1X2, e podem se contradizer) |
| 3 | **alta** | A disciplina de 5pp de edge é enforçada **só no prompt**; o código computa edge mas nunca veta (um edge computado de 3.2pp é persistido e mostrado como aposta) |
| 4 | **alta** | Nenhuma medição de calibração (Brier/log-loss/reliability) existe — embora todo o dado já esteja persistido |
| 5 | média | Infra de CLV está correta e completa mas a captura fica atrás de flag default-OFF (o melhor proxy de edge pode não estar acumulando) |
| 6 | média | Dados de λ já são buscados mas subusados: janelas de 5 jogos viram prosa, nunca taxas; os splits casa/fora do standings (GF/GA em ~15-20 jogos) são a estatística suficiente pra um modelo Maher de ataque/defesa a custo zero |
| 7 | média | Staking é banda determinística 1-3u; Kelly foi deferido **corretamente** (ADR 0019) mas a pré-condição (calibração) nunca foi construída → o deferimento não tem critério de saída |
| 8 | baixa | Sem xG/chutes: providers nunca chamam endpoint de estatística; gols é o único sinal (serviçável, mas converge devagar) |
| — | (positivo) | A fundação do lado das odds é rigorosa e **diretamente reusável** por uma camada estatística |

## Recomendações (fases)

### Fase A — Fundação (alto impacto)
1. **ADR: camada estatística de probabilidade como insumo estruturado do LLM** · S · **ADR**
   Decidir: seam = módulo puro `lib/quant/` (sem LLM/DB no v1), chamado do `predict.ts`
   step 6 → output entra no `buildPredictionInput` como fatos estruturados (padrão
   ADR 0031/`palpites_v7`); política de blend v1 = facts-in-prompt (LLM arbitra baseline
   estatístico vs desfalques/notícia); **regra de exposição** = números Poisson podem aparecer
   na Análise sóbria e viajar como DADO pra síntese, **nunca na manchete** (firewall intacto).
2. **Tracer bullet: engine Poisson de placar alimentando over/under como fatos estruturados** · M · sem ADR
   `lib/quant/poisson.ts` puro e testado: `estimateLambdas(standings, form, league)` com
   ataque/defesa dos splits casa/fora já no input + shrinkage empírico-Bayes; `scorelineMatrix`
   (Poisson independente v1, correção Dixon-Coles τ em (0,0)/(1,0)/(0,1)/(1,1) com ρ≈−0.10
   de literatura); readers `pOverUnder`/`pBtts`/`p1X2`/`cs16`. Ligar **só no over/under
   primeiro**, com bump `over_under_v2.2` instruindo o LLM a tratar como baseline quantitativo.
   **Shippar medindo:** comparar `confidence_pct` emitido vs P(over) Poisson em `ai_calls`
   antes de estender aos outros mercados.
3. **Harness de calibração: Brier, log-loss, reliability** por mercado × versão de prompt · M · sem ADR
   Queries read-time (espelham `kpis.ts`): join `prediction_selection_odds.model_prob_pct`
   com resultados liquidados; computa Brier, log-loss, tabela de reliability de 10 bins, +
   as mesmas métricas pra a implícita no-vig como **benchmark** (skill = bater o log-loss
   do mercado). Sem migration. Substituto vivo e sancionado dos backtests que o dono
   desescopou (consistente com graduação D9).
4. **Confirmar/ligar `enableClvCapture` em prod** · S · sem ADR
   O CLV é o proxy de edge que converge mais rápido; se a flag está OFF em prod, o melhor
   sinal não acumula. Regra do dono: sem flag manual deixada OFF.

### Fase B — Enforcement + rigor (médio impacto)
5. **Gate de edge no código: enforçar `MIN_EDGE_PP` deterministicamente no `predict.ts`** · M · **ADR (curto)**
   Após o Zod parse, se `recomendação ≠ pass` e `edge < MIN_EDGE_PP`, rebaixar pra `pass`
   (mantendo o racional do LLM pra auditoria). Converte a única regra de disciplina do
   produto de prompt-compliance pra invariante de código; protege contra implied-anchoring.

### Fase C — Avançado (gated na calibração)
6. **Dixon-Coles ajustado: ratings de ataque/defesa por liga + ρ + time decay, refit semanal** · L · **ADR**
   Substitui o λ heurístico do tracer por MLE. Tabela `team_ratings`, cron semanal de refit
   (DC é ~40 params por liga, resolve em TS sem Python). ELO considerado só como prior de
   cold-start pra liga nova (hook do checklist de liga). ADR: modelo armazenado + cron + backfill.
7. **Kelly fracionário (¼ Kelly, cap 3u) gated em evidência de calibração** · M · **ADR (amenda 0019)**
   Critério de saída do deferimento do ADR 0019: quando o harness mostrar reliability slope
   ∈ [0.8, 1.2] e Brier ≤ baseline no-vig sobre ≥150 apostas resolvidas, trocar as bandas por
   quarter-Kelly `f* = (p·o − 1)/(o − 1)`, clamp [0.5, 3]. Quarter (não full) porque erro de
   estimativa em `p` faz full-Kelly super-apostar. **Até o gate passar, bandas ficam.**
8. **Checkpoint de blend: medir LLM-ajustado vs Poisson-puro vs baseline de mercado** · M · sem ADR (discovery)
   Depois de ~1-2 meses, comparar os 3 forecasters no harness. Se o LLM bate o Poisson-puro,
   a arbitragem de contexto (desfalques/notícia) paga seu custo → mantém facts-in-prompt.
   Se não, inverte a composição (código computa `p = w·P_poisson + (1−w)·P_LLM`).
9. **Validar `/fixtures/statistics` (chutes/SOT/xG) como redução de variância de λ** · M · sem ADR (discovery)
   Mesmo provider (sem trigger de ADR de provider novo), endpoint novo. Só depois do tracer.
   Caveat da Copa (API-Football tem buracos).

## Como isso combina com o LLM (o desenho)
O modelo estatístico **não substitui** o LLM — ele vira a **base quantitativa** que entra no
prompt como fato estruturado; o LLM continua fazendo contexto/desfalques/notícia/narrativa. O
firewall não é afetado (a matemática do modelo viaja pelo mesmo canal DADO que o edge já usa
pra síntese). É a evolução natural do `palpites_v7` (que já injeta H2H/form pré-contados).

Relacionados: ADR 0018 (edge/EV), 0019 (staking), 0021 (modelo), 0030/0031 (firewall);
`docs/ops/08-clv-quota.md`. **Sinergia forte com o [Report 04](./04-analise-de-aposta-rework.md).**
