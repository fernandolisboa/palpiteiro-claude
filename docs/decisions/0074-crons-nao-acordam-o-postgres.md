# ADR 0074 — Crons frequentes não acordam o Postgres à toa

## Status

Accepted (2026-11-25). Pedido do Fernando depois do e-mail do Neon dizendo que o palpiteiro atingiu o limite de uso. Issue #680.

## Contexto

O Neon do palpiteiro (projeto `billowing-bonus-76073873`, criado pelo Vercel Marketplace) está no plano Free: **100 CU-h por projeto por mês**, compute mínimo de 0,25 CU e scale-to-zero fixo em **5 min** sem query. Estourando a cota, o Free suspende o compute até o próximo ciclo (ou upgrade) e o app fica sem banco.

O app quase não tem uso. Quem consumia eram dois crons que tocavam o Postgres em todo run, mesmo sem nada a fazer:

- `recheck-lineups` (#624), a cada 10 min (minutos 5, 15, …, 55): lia `ai_config.enable_lineup_recheck` e rodava a query de candidatos.
- `capture-closing-odds` (#180), a cada 30 min (0 e 30): lia `ai_config.enable_clv_capture`.

Cada run segura o compute acordado por ≥ 5 min. Os horários se encadeiam (:55 → :00 → :05 → :10, :25 → :30 → :35 → :40), então o banco ficava acordado ~40 min por hora:

40/60 × 24 h × 0,25 CU ≈ **4 CU-h/dia**, ou seja, 100 CU-h no dia 25. Novembro de 2026 foi o primeiro mês inteiro com o cron de 10 min (entrou em 2026-10-23), e o e-mail chegou no dia 25. Ligar a Champions e a Sul-Americana não mudou a conta: o custo vem da cadência fixa dos runs vazios, não do número de jogos.

Os dois crons só têm trabalho perto do apito de um jogo que alguém analisou: a reconferência olha predições de pré-jogo com KO em (agora + 5 min, agora + 75 min], a closing line olha predições com KO em até 90 min.

## Decisão

1. **Índice no KV** (`lib/sync/analyzed-kickoffs.ts`): sorted set `analyzed-kickoffs:v1` com `matchId → kickoff (epoch ms)` dos jogos com predição de pré-jogo. O Upstash já está no projeto (locks, rate limit) e não tem scale-to-zero nem cobrança por tempo acordado.
   - `persistPrediction` grava o jogo depois dos inserts da predição e do PSO (best-effort, nunca lança; predição ao vivo não entra). Se o ZADD falhar, apaga o carimbo: o portão abre até o próximo rebuild em vez de deixar o jogo de fora.
   - Todo sync de fixtures (`syncFixturesForLeagues`: cron de 6 h, toggle do /admin/leagues, after() da lista) apaga o carimbo **antes** de gravar qualquer kickoff e reconstrói o índice no fim com `getUpcomingAnalyzedKickoffs`. Sync que lança ou morre no meio (maxDuration) deixa o portão em `null`, nunca respondendo com kickoff velho. O rebuild só faz upsert + corte do passado (> 6 h), nunca `DEL` do set, então um ZADD concorrente do insert não se perde.
   - O carimbo `analyzed-kickoffs:v1:built-at` (TTL 13 h, dois ciclos do sync + folga) e um membro sentinela `__built__` (score `Number.MAX_SAFE_INTEGER`, fora de qualquer janela) marcam o índice como completo. Faltando qualquer um dos dois (nunca construído, sync em andamento, KV despejou o set ou o carimbo), o portão responde `null`.
2. **Portão antes da primeira query.** `runLineupRechecks` e `captureClosingLines` chamam `hasAnalyzedKickoffBetween(janela)` antes até da flag. `false` → saem sem tocar no Postgres (`skipped: "no_analyzed_kickoff"`, sem log). `null` (sem KV, índice sem carimbo, erro no KV) → caminho antigo, direto no banco. Fail-open: na dúvida o comportamento é o de antes, nunca uma reconferência ou closing line perdida por causa do portão.
3. **Orçamento como teste.** `__tests__/cron-db-wake-budget.test.ts` lê o `vercel.json`: cron com mais de 24 runs/dia só passa se estiver na lista dos que têm portão (e o arquivo dele chamar o portão); os crons sem portão somam no máximo 24 runs/dia (hoje 16).

## Consequências

- Dia sem jogo analisado: zero queries dos dois crons. Com jogo analisado, o portão abre ~75–90 min antes do KO e os crons rodam como antes.
- Estimativa depois da mudança: ~16 acordadas/dia dos crons sem portão (sync, prewarm, base do modelo, refit, settlement, alerta de gasto, versões de modelo), a maioria de 5–6 min a 0,25 CU, mais o uso real e os minutos de jogo analisado. Algo entre 15 e 25 CU-h/mês, contra ~120 antes.
- Kickoff mudado pelo sync é corrigido no mesmo sync (carimbo derrubado antes, rebuild no fim). Membro velho que sobra (jogo adiado) só custa um run que desce ao banco à toa.
- Corrida aceita: uma análise que leu o kickoff antes de um sync remarcar o jogo e grava depois do rebuild deixa o kickoff velho no índice até o próximo sync. Pode perder a reconferência/closing line daquele jogo; exige remarcação durante os segundos de uma análise.
- O portão depende do KV: com o Upstash fora, todo cron cai no caminho antigo (mais compute, nunca trabalho perdido).
- Primeiro deploy: até o primeiro sync o índice não tem carimbo e os crons seguem o caminho antigo.
- Cron novo de alta frequência precisa de portão próprio (ou entrar no orçamento). O teste aponta pra este ADR.

## Alternativas descartadas

- **Espaçar os crons** (ex.: reconferência a cada 15–20 min): ainda acordaria o banco o dia inteiro e perderia escalações que saem perto do KO.
- **Cache das flags no KV**: os crons ainda precisariam da query de candidatos a cada run.
- **Upgrade pro plano Launch** ($0,106/CU-h): resolve a suspensão, mas pagaria ~$12/mês por runs vazios. Continua disponível como decisão do Fernando, independente desta mudança.
