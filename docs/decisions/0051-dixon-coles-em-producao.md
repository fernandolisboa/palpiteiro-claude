# ADR 0051 — Dixon-Coles em produção: ratings diários por liga

## Status

Accepted (2026-09-26). Cumpre o "se passar" do ADR 0039 D2 (o backtest do #502 passou: over 2.5 −0.0112 de log-loss, IC [−0.0218, −0.0001]; 1X2 −0.042). Emenda o ADR 0039 em dois pontos: refit **diário** (não semanal) e ajuste pelo ponto fixo de Maher + ρ por seção áurea, que é o que `lib/quant/dixon-coles.ts` já faz (não Newton/gradiente). Consome a interface combinada com o ADR 0041 (§1).

## Contexto

O λ do modelo de placar em produção vinha do heurístico da tabela (`computeMatchLambdas`, ADR 0036/0037): splits casa/fora da temporada com shrinkage. O backtest (`docs/reports/10-backtest-dixon-coles.md`) mostrou que no over 2.5 esse heurístico perde até pra taxa-base de 12 meses, e que o Dixon-Coles com 3 anos de histórico ganha dele nos dois mercados. Dois consumidores usam esse λ: a âncora estatística do cartucho over/under no motor `llm` (bloco `scoreline_model`) e o motor `code_jev`, que decide a aposta a partir do λ (ADR 0041).

## Decisão

1. **Dados** (migration 0050): `team_rating_fits` (uma row por liga: γ, ρ, jogos usados, temporadas lidas, `fitted_at`), `team_ratings` (liga, time, α, β, jogos do time na janela) e `team_rating_season_results` (resultados de temporadas encerradas, por liga e temporada). Flag `ai_config.enable_dixon_coles` (default ON). Tudo com `IF NOT EXISTS` (preview DB compartilhado).
2. **Refit diário** (`/api/cron/refit-team-ratings`, 07:00 UTC, `CRON_SECRET`, `maxDuration` 300s; e o botão "Reajustar agora" no `/admin/settings`). Pra cada liga ativa, menos a Copa do Mundo: temporada atual + 3 anteriores (cobrem a janela de 3 anos inteira, como no backtest), só jogos finalizados, `fitDixonColes` com os hiperparâmetros do backtest (`DC_DEFAULTS`: ξ = 0.0019/dia, prior de 2 gols). Temporada encerrada não muda: é buscada via `getFixturesBySeason` uma vez e guardada; no dia a dia só a temporada atual vai ao provider (1 chamada de API-Football por liga, em geral já no cache de 1h do sync de fixtures; zero crédito da The Odds API). A 1ª rodada de uma liga faz 4 chamadas, enfileiradas pelo throttle de 8/min; o que for guardado sobrevive a um timeout. Troca atômica (`db.batch`) dos ratings da liga.
   - Liga que falha inteira, que tem menos de 100 jogos ou cujo ajuste sai com parâmetro não finito mantém o fit anterior.
   - Temporada que falha é pulada e registrada. Se o fit atual ainda vale e tinha essa temporada, ele é mantido (não troca 3 anos por um ajuste mais magro); temporada que nunca respondeu não trava o refit.
   - Falha (não "poucos jogos") responde 500 no cron, pro monitor do Sentry acusar antes de o fit envelhecer.
3. **Escolha do λ** (`lib/quant/match-model.ts`, puro; `lib/ratings/model-scoreline.ts` lê flag e ratings): Dixon-Coles quando o flag está ligado, o fit tem até 72h e os dois times têm pelo menos 10 jogos na janela. λ_casa = γ·α_casa·β_fora, λ_fora = α_fora·β_casa (mando neutro: √γ nos dois lados, porque o visitante é a base da parametrização), clampados aos limites do modelo de placar, matriz com o ρ ajustado. Rating corrompido (não finito ou ≤ 0) conta como erro. Senão, o heurístico da tabela, com o motivo (`flag_off`, `no_fit`, `stale_fit`, `team_missing`, `few_matches`, `error`) gravado em `predictions.judgments.lambda.fallbackReason` no `code_jev`. Nunca lança.
4. **Consumidores**: o motor `code_jev` (o adapter `lib/ai/engine/model-scoreline.ts` sai; `modelVersion` já carrega `lambda=dixon_coles|heuristic`) e a âncora do over/under no motor `llm`. `degraded` continua significando "dados limitados do heurístico" — o fallback pro heurístico não liga o rótulo "dados limitados" no prompt.
5. **Versão do cartucho**: `over_under_v2.2 → v2.3` e `over_under_v3.2 → v3.3`, como o ADR 0039 pedia. Prompt e mensagem byte-idênticos (o rótulo "Poisson" vale pros dois: o DC também é double-Poisson); muda o número da âncora e o `scoreline_model.source` no `input_payload` (`poisson` | `dixon_coles`). O bump separa as linhas de antes e depois do DC no `/admin/calibration`. Dentro de v2.3/v3.3 ainda há âncoras do heurístico (fallback); separar DC de heurístico ali pede segmentar por `input_payload.scoreline_model.source`.

## Consequências

- **(+)** O λ dos dois motores passa a vir do modelo que ganhou o backtest, sem custo de LLM nem de odds. O DC também funciona sem tabela: o `code_jev` precifica jogos em que o standings não veio.
- **(+)** Kill-switch no admin; falha de leitura, cron parado ou liga nova caem no heurístico sozinhos.
- **(−)** O backtest cobriu só o Brasileirão. Premier League, La Liga e Champions entram pelo mesmo resultado; a Champions tem poucos jogos por time e cai mais no heurístico (`few_matches`) até juntar histórico.
- **(−)** Champions ajusta só com jogos da própria Champions: força entre ligas não entra. Mata-mata usa o placar com prorrogação (`goals` do provider), um punhado de jogos por temporada.
- **(−)** Depois do deploy, até o primeiro refit (cron ou botão) tudo segue no heurístico (`no_fit`).
- **(−)** Mais uma chamada diária de API-Football por liga ativa, na mesma cota do sync de fixtures e das análises.
- O modelo de placar da "análise minha aposta" (`lib/bets/grade-scoreline.ts`, ADR 0036) segue no heurístico; migrar é trocar a chamada por `getModelScoreline`.

## Referências

ADRs 0036 (modelo de placar, escada de degradação), 0037 (bloco `scorelineModel`), 0039 (gate do DC), 0041 (motor `code_jev`, interface `getModelScoreline`), 0050 (ligas ativas no banco). Código: `lib/quant/dixon-coles.ts`, `lib/quant/match-model.ts`, `lib/ratings/`, `lib/db/queries/team-ratings.ts`, `app/api/cron/refit-team-ratings/route.ts`.
