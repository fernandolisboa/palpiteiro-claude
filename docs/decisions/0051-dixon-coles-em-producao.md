# ADR 0051 — Dixon-Coles em produção: ratings diários por liga

## Status

Accepted (2026-09-26). Cumpre o "se passar" do ADR 0039 D2 (o backtest do #502 passou: over 2.5 −0.0112 de log-loss, IC [−0.0218, −0.0001]; 1X2 −0.042). Emenda o ADR 0039 em dois pontos: refit **diário** (não semanal) e ajuste pelo ponto fixo de Maher + ρ por seção áurea, que é o que `lib/quant/dixon-coles.ts` já faz (não Newton/gradiente). Consome a interface combinada com o ADR 0041 (§1).

## Contexto

O λ do modelo de placar em produção vinha do heurístico da tabela (`computeMatchLambdas`, ADR 0036/0037): splits casa/fora da temporada com shrinkage. O backtest (`docs/reports/10-backtest-dixon-coles.md`) mostrou que no over 2.5 esse heurístico perde até pra taxa-base de 12 meses, e que o Dixon-Coles com 3 anos de histórico ganha dele nos dois mercados. Dois consumidores usam esse λ: a âncora estatística do cartucho over/under no motor `llm` (bloco `scoreline_model`) e o motor `code_jev`, que decide a aposta a partir do λ (ADR 0041).

## Decisão

1. **Dados** (migration 0050): `team_rating_fits` (uma row por liga: γ, ρ, jogos usados, temporadas lidas, `fitted_at`) e `team_ratings` (liga, time, α, β, jogos do time na janela). Flag `ai_config.enable_dixon_coles` (default ON). Tudo com `IF NOT EXISTS` (preview DB compartilhado).
2. **Refit diário** (`/api/cron/refit-team-ratings`, 07:00 UTC, `CRON_SECRET`; e o botão "Reajustar agora" no `/admin/settings`). Pra cada liga ativa, menos a Copa do Mundo: temporada atual + 2 anteriores via `getFixturesBySeason` (3 chamadas de API-Football por liga, cache de 1h; zero crédito da The Odds API), só jogos finalizados, janela de 3 anos, `fitDixonColes` com os hiperparâmetros do backtest (`DC_DEFAULTS`: ξ = 0.0019/dia, prior de 2 gols). Troca atômica (`db.batch`) dos ratings da liga. Temporada que falha é pulada e registrada; liga que falha inteira, ou que tem menos de 100 jogos, mantém o fit anterior.
3. **Escolha do λ** (`lib/quant/match-model.ts`, puro; `lib/ratings/model-scoreline.ts` lê flag e ratings): Dixon-Coles quando o flag está ligado, o fit tem até 72h e os dois times têm pelo menos 10 jogos na janela. λ_casa = γ·α_casa·β_fora, λ_fora = α_fora·β_casa (sem γ em mando neutro), clampados aos limites do modelo de placar, matriz com o ρ ajustado. Senão, o heurístico da tabela, com o motivo (`flag_off`, `no_fit`, `stale_fit`, `team_missing`, `few_matches`, `error`) gravado em `predictions.judgments.lambda.fallbackReason` no `code_jev`. Nunca lança.
4. **Consumidores**: o motor `code_jev` (o adapter `lib/ai/engine/model-scoreline.ts` sai; `modelVersion` já carrega `lambda=dixon_coles|heuristic`) e a âncora do over/under no motor `llm`. `degraded` continua significando "dados limitados do heurístico" — o fallback pro heurístico não liga o rótulo "dados limitados" no prompt.
5. **Versão do cartucho**: `over_under_v2.2 → v2.3` e `over_under_v3.2 → v3.3`, como o ADR 0039 pedia. Prompt e mensagem byte-idênticos (o rótulo "Poisson" vale pros dois: o DC também é double-Poisson); muda o número da âncora e o `scoreline_model.source` no `input_payload` (`poisson` | `dixon_coles`). O bump separa as âncoras no `/admin/calibration`.

## Consequências

- **(+)** O λ dos dois motores passa a vir do modelo que ganhou o backtest, sem custo de LLM nem de odds. O DC também funciona sem tabela: o `code_jev` precifica jogos em que o standings não veio.
- **(+)** Kill-switch no admin; falha de leitura, cron parado ou liga nova caem no heurístico sozinhos.
- **(−)** O backtest cobriu só o Brasileirão. Premier League, La Liga e Champions entram pelo mesmo resultado; a Champions tem poucos jogos por time e cai mais no heurístico (`few_matches`) até juntar histórico.
- **(−)** Champions ajusta só com jogos da própria Champions: força entre ligas não entra. Mata-mata usa o placar com prorrogação (`goals` do provider), um punhado de jogos por temporada.
- **(−)** Depois do deploy, até o primeiro refit (cron ou botão) tudo segue no heurístico (`no_fit`).
- O modelo de placar da "análise minha aposta" (`lib/bets/grade-scoreline.ts`, ADR 0036) segue no heurístico; migrar é trocar a chamada por `getModelScoreline`.

## Referências

ADRs 0036 (modelo de placar, escada de degradação), 0037 (bloco `scorelineModel`), 0039 (gate do DC), 0041 (motor `code_jev`, interface `getModelScoreline`), 0050 (ligas ativas no banco). Código: `lib/quant/dixon-coles.ts`, `lib/quant/match-model.ts`, `lib/ratings/`, `lib/db/queries/team-ratings.ts`, `app/api/cron/refit-team-ratings/route.ts`.
