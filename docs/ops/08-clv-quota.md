# CLV — captura da closing line e custo de quota

Operacional. O **CLV (closing line value)** — companheiro do Yield (#180) — compara
a odd na recomendação com a odd de **fechamento** (closing line). Não há odds
históricas de fechamento em provider nenhum (ADR 0025: api-football retém 7 dias /
`coverage.odds` só 2026; o arquivo da The Odds API é pago), então a closing line é
**capturada ao vivo perto do kickoff** (forward-capture). Isso **pressiona a quota**
de 500 créditos/mês da The Odds API — este doc é o modelo de custo + como medir.

## Como funciona

- Cron `*/30 * * * *` → `GET /api/cron/capture-closing-odds` (Bearer `CRON_SECRET`).
- Pega os jogos com **KO nos próximos 90min** (`CLV_CAPTURE_LOOKAHEAD_MS`) que têm
  **predição non-pass** (`getNonPassPredictionsNearKickoff`) e chama o
  `ensureOddsSnapshotsFresh` **de cada um** — o mesmo caminho de snapshot da análise.
- O gate de frescor de 30min faz o último fetch pré-KO cair em ~[KO−30min, KO].
- **Leitura:** a closing line de uma predição é o último snapshot em **[KO−40min, KO]**
  (`CLV_CLOSING_WINDOW_MS`); fora disso → CLV `null` (honesto — sem captura genuína
  perto do KO, não inventa um CLV≈0 comparando com a odd da análise).
- **Pass nunca dispara captura** (filtro na query) — economia de quota (AC).

## Modelo de custo (créditos/mês)

The Odds API cobra por mercado×região por chamada. O dispatch é por `oddsSource`:

| Mercado | `oddsSource` | Custo da captura |
|---|---|---|
| over/under 2.5, 1X2 | `featured` | **1 crédito por (liga × mercado) por run** — `ensureOddsSnapshotsFresh` busca a liga INTEIRA e grava pra todos os jogos da janela; o 1º jogo stale da liga gasta o crédito, os demais acham fresco e pulam |
| btts, dupla chance | `additional` | **1 crédito por evento** (por jogo, por run) |

Como o cron roda sequencialmente e o gate de frescor de 30min deduplica, o pior caso
por run é ≈ `Σ_liga (mercados featured com jogo near-KO) + Σ (eventos near-KO com mercado additional)`.

**Estimativa de uso pessoal:** poucas predições/semana → dezenas de créditos/mês.
Ex.: 1 jogo/dia com predição over/under → ~1 crédito/dia × 30 ≈ **30 créditos/mês**
(featured, amortizado por liga). Com a flag **OFF (default) o custo é ZERO**.

> Linhas extras de over/under (1.5/3.5, `OVER_UNDER_ALT`/`alternate_totals`, world_cup,
> flag `enableOverUnderExtraLines`) NÃO são capturadas pela closing-line v1 (o
> `getDescriptor('over_under')` resolve só o featured 2.5) → CLV de predições em linha
> ≠ 2.5 fica `null`. Aceitável: extra-lines é off por default.

## Como a quota é medida

- **Por chamada:** todo fetch real da The Odds API loga `quota_monthly_remaining` /
  `quota_monthly_used` (`lib/providers/http/quota-logger.ts` → `logCall`), com WARN
  <20% e ERROR <5% do limite mensal.
- **Por run do cron:** o log `{"scope":"capture_closing_odds","event":"run_complete",…}`
  traz `consideredMatches`, `capturedMatches`, `errors` e
  `quotaMonthlyRemaining`/`quotaMonthlyUsed` (do último fetch, via
  `getLastOddsApiQuota`). É a linha pra acompanhar o consumo do CLV sem somar os
  logs por-call.

## Rollout (flag)

`ai_config.enableClvCapture` (boolean, **default false**, migration 0029). Espelha
`enableBestBetFanOut`/`enableOverUnderExtraLines` — **DB-flip, sem deploy, sem UI**:

```sql
UPDATE ai_config SET enable_clv_capture = true WHERE id = 1;   -- liga (passa a gastar quota)
UPDATE ai_config SET enable_clv_capture = false WHERE id = 1;  -- desliga (volta a zero)
```

A **exibição** do CLV (dashboard segmentado + detail da predição) é independente da
flag: sempre on, mostra `null`/"—" até haver closing line capturada. Ligue a captura
quando a quota comportar; acompanhe o `run_complete` por alguns dias antes de confiar.
