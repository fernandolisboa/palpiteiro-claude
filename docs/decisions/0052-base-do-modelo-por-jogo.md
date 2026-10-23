# ADR 0052 — Base do modelo por jogo (pré-previsão sem Claude)

## Status

Accepted (2026-10-13). Fase 1 da proposta "pré-previsão, bet slip e análise do seu palpite" (#555). Consome o λ do ADR 0051 (`getModelScoreline`) e o JEV do ADR 0041 sem mudar nenhum dos dois; nenhum prompt muda. **Decisão 9 emendada pela [ADR 0060](./0060-modo-ao-vivo-estado-do-jogo-modelo-em-jogo-registros-marcados.md)** (2026-10-15): o modelo em jogo lê a base como ela era no apito.

## Contexto

Hoje a probabilidade do modelo só existe depois de "Analisar com IA": por usuário, por mercado, com narração paga. Mas o λ (Dixon-Coles ou heurístico da tabela, ADR 0051) e o ajuste dos julgamentos JEV (ADR 0041) são do **jogo**, não de quem pede: a mesma pergunta é respondida de novo a cada análise, e nada aparece na lista de jogos nem na página do jogo antes de alguém pagar uma análise. As próximas fases (cupom de apostas e análise do palpite do usuário) precisam ler a mesma probabilidade, de uma fonte só.

## Decisão

1. **Base compartilhada por jogo** em `match_model_snapshots` (migration 0055), calculada em código por um cron, **sem Claude e sem The Odds API**. Uma row por resultado distinto; a tabela é append-only no conteúdo.
2. **λ** de `getModelScoreline` (Dixon-Coles com fallback no heurístico da tabela, ADR 0051). A tabela de classificação só é buscada quando o DC não serve (ou quando o jogo vai pro JEV, que usa a tabela no state): com DC fresco o cron não gasta essa chamada.
3. **JEV só a ≤ 48h do jogo**, atrás do flag novo `ai_config.enable_match_model_jev` (default ON, no `/admin/settings`). Mesma porta e mesmo log do predict (`lib/ai/predict.ts`, `ai_calls` com `provider = 'typesafe'`), mesmo state (`FORM_LAST`, degradação de desfalques), fail-open. O reuso por `stateHash` vale nos dois sentidos: o cron reusa respostas de uma predição recente e o "Analisar com IA" reusa as respostas da base (12h sobre `checked_at`; as predições seguem com 6h sobre `created_at`). Sem `TYPESAFE_API_KEY` o cron não busca dados nem tenta o JEV (um `warn` por run).
4. **Probabilidades** de 1X2, dupla chance, BTTS e gols 1.5/2.5/3.5, mais os 5 placares mais prováveis, em pontos percentuais (2 casas), lidas da MESMA matriz que o motor `code_jev` usaria (λ pós-JEV, ρ do fit).
5. **A base não expõe edge.** Nem gravado, nem calculado na leitura: nenhuma superfície da base (linha do `/jogos`, bloco "Leitura do modelo", seam do cupom) mostra edge, EV, stake ou linguagem de valor, e a leitura não lê odds. O backtest de calibração (PR #558, `docs/reports/13-*`) mostrou CLV negativo do edge do Dixon-Coles puro contra as odds de abertura em todos os cortes: sem o ajuste e o gate da análise por usuário, esse edge não é sinal. O edge continua só dentro da análise do usuário ("Analisar com IA"), com o gate de edge (ADR 0038). A base mostra a probabilidade e a odd justa (100/p), pra quem quiser comparar com a odd da própria casa.
6. **Row nova só quando o fingerprint muda** (versão do modelo, λ base e ajustado na 6ª casa, ρ efetivo, mando neutro, status do JEV, `stateHash`, versões de perguntas/pesos e o modelo JEV pinado). Fingerprint igual → só o heartbeat `checked_at = GREATEST(checked_at, now)`, o único UPDATE da tabela (monotônico: um run atrasado nunca recua o relógio). Sem unique em `(match_id, fingerprint)`: A→B→A é legítimo (ex.: flag liga e desliga).
7. **`ai_calls.user_id` nullable só pra chamadas de sistema TypeSafe**: CHECK `user_id IS NOT NULL OR provider = 'typesafe'` no banco. Um insert Claude/narração sem usuário é bug e falha no Postgres. O `/admin/costs` mostra essas chamadas como "sistema".
8. **Rota de cron própria** (`/api/cron/compute-match-models`, `30 1,7,13,19 * * *`) em vez de pendurar no refit ou no sync de fixtures: precisa da agenda dela (07:30 = 30 min depois do refit das 07:00) e do orçamento inteiro de `maxDuration = 300`. O throttle da API-Football (8 req/min) consome ~55 s por jogo com JEV; somado ao refit ou ao sync estouraria o tempo e acoplaria falhas. Lock KV próprio (`SET NX EX 300`) contra runs sobrepostos; o perdedor sai com `skipped: "locked"`. Prazo de 200 s pra começar um jogo da fila JEV; a fila prioriza jogo sem base, base sem JEV ou base velha (> 6h), depois o kickoff mais próximo.
9. **As Fases 2 e 3 leem desta base.** O seam do cupom é `getMatchModelScoreline` (`lib/model-base/model-scoreline.ts`): reconstrói o mesmo `ModelScoreline` de `getModelScoreline` a partir da última row (λ pós-JEV), e devolve null quando não há base, a versão é outra, o `checked_at` tem mais de 24h ou o jogo já começou. Ligar o `confirmBet` (`app/actions/bets.ts`) a ele fica pra fase do cupom: com base fresca, o caminho B do cupom passa a precificar com o λ pós-JEV, o mesmo que a "Leitura do modelo" mostra. *(Emendado pela ADR 0060: depois do apito, o modelo em jogo lê a base "no apito", com `now = kickoff − 1 ms`, então a idade de 24h é medida no apito e o corte "o jogo já começou" não se aplica a essa leitura. As demais leituras seguem devolvendo null.)*

UI: a lista `/jogos` ganha uma linha "Modelo · Casa 52% · Under 2.5 55%" (favorito do 1X2 e o lado mais provável do 2.5, sem odd nem edge), e a página do jogo ganha o bloco "Leitura do modelo" (probabilidades, odd justa, placares, fonte do λ, JEV e idade, sem odds nem edge), fora do `MatchHero`/`PalpiteHero`. O firewall do ADR 0030 vira tipo: `MatchHeroView = Omit<MatchRowView, "model">`.

## Consequências

- **(+)** Uma análise depois da base não paga JEV de novo (reusa as respostas pelo `stateHash`).
- **(+)** A probabilidade do jogo aparece antes de qualquer análise paga, e as fases seguintes têm uma fonte única.
- **(+)** O cupom (Fase 2) não precisa buscar tabela e ratings a cada confirmação quando há base fresca.
- **(−)** Throughput limitado pelo throttle da API-Football: ~4–6 jogos com JEV por run, o resto entra no próximo.
- **(−)** A tabela cresce ~1 row por jogo por dia (o refit diário mexe no λ); sem retenção nesta fase.
- **(−)** Qualquer query futura que fizer `innerJoin(users)` em `ai_calls` perde as rows de sistema. O `getCostByUser` usa `leftJoin`.
- Escalação ou desfalques que mudam entre o cron e a análise mudam o `stateHash`: o predict paga o JEV de novo (custo, não erro).
- Com a escalação publicada (#619, `jev_judgments_v3`), o cron também busca o XI de referência de cada time (até +4 req por jogo, mesmo caminho do predict, sem prazo), então a paridade do `stateHash` vale depois da escalação; `RUN_DEADLINE_MS` cai pra 150 s.
- A Copa do Mundo sai no heurístico (o DC exclui a Copa, ADR 0051).

## Referências

ADRs 0030 (firewall do hero), 0038 (gate de edge), 0041 (motor `code_jev`, JEV), 0051 (Dixon-Coles em produção). Plano: `docs/plans/PLAN-555.md`. Backtest de calibração: PR #558. Código: `lib/model-base/`, `lib/db/queries/match-model-snapshots.ts`, `app/api/cron/compute-match-models/route.ts`, `components/match-model-line.tsx`, `components/match-model-reading.tsx`.
