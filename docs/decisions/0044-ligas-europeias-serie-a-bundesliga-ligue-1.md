# ADR 0044 — Serie A, Bundesliga e Ligue 1: suporte registrado, ativação gated no orçamento da Odds API

## Status

Accepted (2026-09-24). Parte do pedido do dono de adicionar as competições propostas (opção B: top-5 europeias). Premier League e La Liga entram por PR/ADR próprios; este ADR cobre as outras três.

## Contexto

O CLAUDE.md exige ADR pra liga nova. As três ligas são cobertas pelos dois providers de dados já integrados — API-Football (IDs 135 / 78 / 61) e football-data.org **free tier** (códigos SA / BL1 / FL1) — e pela The Odds API (`soccer_italy_serie_a`, `soccer_germany_bundesliga`, `soccer_france_ligue_one`). Calendário cross-year (ago–mai), igual à Champions. Nenhum provider novo, nenhum mercado novo.

O gargalo é a quota da The Odds API (free: 500 créditos/mês). O `prewarm-odds` roda 4×/dia e gasta 2 créditos (h2h + totals, 1 região) por liga ativa com jogo na janela. Uma liga de fim de semana custa ~120–160 créditos/mês; o Brasileirão (rodadas no meio da semana) ~200–240. Com Brasileirão + Champions + Premier League + La Liga + Libertadores + Sul-Americana o free tier já fica no limite ou acima dele; somar mais três ligas de fim de semana (+~400/mês) só cabe no plano pago (20K créditos, ~US$30/mês). Em 2026-09-24 o dono disse que não vai fazer o upgrade agora.

## Decisão

1. **Registrar as três ligas por inteiro** (enum `league` no DB, `SUPPORTED_LEAGUES`, IDs/códigos dos providers, sport keys da Odds API, keys de UI `sa`/`bl`/`l1`, rótulos, região "Europa" no seletor), mas **fora de `ACTIVE_LEAGUES`**. Sem entrar em `ACTIVE_LEAGUES`, nem o sync de fixtures nem o prewarm de odds tocam nelas: custo zero de quota.
2. **Seletor esconde as três enquanto inativas** (`HIDE_WHEN_INACTIVE`), em vez de mostrá-las desabilitadas como "fora de temporada" — a temporada está rolando, o motivo é orçamento.
3. **Times em bootstrap vazio.** `CANONICAL_TEAMS` e os mapas `team-ids.ts` entram vazios pras três ligas; `scripts/generate-team-ids.ts` semeia a partir do provider primário (API-Football, ADR 0005) e depois do fallback. O ambiente de nuvem não tem keys de provider, então isso roda antes da ativação.
4. **Mercados nos defaults** (1X2 + over/under 2.5). A cobertura de mercados extra por liga (`coveredLeagues` em `lib/odds/market-descriptor.ts`) é decidida em outra frente.

## Checklist de ativação (por liga)

1. Plano pago da The Odds API ativo (ou orçamento que comporte a liga — conferir `quotaMonthlyUsed` nos logs do prewarm).
2. `pnpm tsx scripts/generate-team-ids.ts --provider=api-football` e depois `--provider=football-data-org`; resolver os avisos de nome em `TEAM_NAME_ALIASES`.
3. Conferir que a sport key aparece ativa em `GET /v4/sports` (as keys vieram do catálogo público, não de uma chamada ao vivo).
4. Adicionar a liga em `ACTIVE_LEAGUES` (uma linha) e remover a key de `HIDE_WHEN_INACTIVE`.

## Consequências

- **(+)** Ativar vira mudança de uma linha + seed de times, sem migration nem ADR novo.
- **(+)** Zero custo de quota enquanto desligadas.
- **(−)** O enum do DB ganha três valores sem dados até a ativação (inofensivo; `ADD VALUE` é aditivo).
- **(−)** Sport keys e IDs não foram validados ao vivo daqui (rede do ambiente bloqueia os providers) — coberto pelo passo 3 do checklist.
