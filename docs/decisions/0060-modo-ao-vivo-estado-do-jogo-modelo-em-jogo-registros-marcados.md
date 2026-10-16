# ADR 0060 — Modo ao vivo: estado do jogo pela API-Football, modelo em jogo em código, registros marcados

## Status

Accepted (2026-10-15). Issue #580 (pedido do dono, 2026-10-15); PR A1 #595 (issue #590). **Emenda** a ADR 0054 §3 (o bolão fecha aos 15 minutos de jogo, não no apito), a ADR 0052 §9 (a base é lida "no apito" depois dele), a ADR 0053 §5-6 (sem edge do modelo e sem stake sugerido ao vivo) e a ADR 0055 (o "Seu palpite" existe durante o jogo). **Reafirma, sem emendar:** ADR 0048 (nenhuma casa na tela, o app não toca em dinheiro), ADR 0038 (sem preço não há edge), ADR 0030 (firewall do HERO) e ADR 0057 (um §3 por tela). Plano: `docs/plans/PLAN-580.md` (a "Revisão do plano" vale sobre o resto).

## Contexto

Até aqui tudo no app fechava no apito inicial: análise, "Seu palpite", registro de apostas e bolão seguem o mesmo portão de pré-jogo (`matchUnavailableReason`, `lib/view/match-availability.ts`). O dono pediu que o app sirva durante o jogo, que é quando o grupo está reunido: ler o jogo com o placar e o minuto, registrar a aposta feita no intervalo e anotar o bolão de quem chegou atrasado.

Três restrições moldam a resposta. A The Odds API está no free tier (500 créditos/mês) e não pode pagar odd ao vivo. O modelo de placar (Dixon-Coles, ADR 0051) é uma matriz de placares **finais**, e todo mercado da tabela é um predicado sobre ela. E os números de desempenho (CLV, calibração, retorno) medem o motor de pré-jogo: um registro feito aos 60' com o placar à vista não pode entrar nessas séries.

## Decisão

1. **O que fica liberado ao vivo** (decisão do dono): "Analisar com IA", "Gerar só o palpite", "Seu palpite", registrar em Suas apostas e o bolão. A reanálise de um mercado e os mercados escolhidos (`analyzeMatch`, `analyzeMarkets`) continuam **só pré-jogo**: são um `predict()` pago por mercado, contra odds. O gating passa a ser **por capacidade** (`matchCapabilities`, `lib/view/match-availability.ts`), com a capacidade nova `analyzeMarkets`:

   | Capacidade | Pré-jogo | `in_play` / `half_time`, estado ≤ 2 min, minuto conhecido | resto |
   |---|---|---|---|
   | `analyze` | sim | sim, se há modelo | não |
   | `seuPalpite` | sim | sim, se há modelo | não |
   | `registerBets` | sim | sim (sem modelo: registra sem avaliação) | não |
   | `pool` | sim | enquanto a janela do bolão está aberta (item 7) | não |
   | `analyzeMarkets` | sim | não | não |

   Os motivos de bloqueio ganham `extra_time` (prorrogação e pênaltis: os mercados de 90' já estão decididos), `interrupted` (`INT`, `SUSP`) e `live_unavailable` (o apito passou e não há estado ao vivo utilizável). A copy sai por capacidade e motivo (`capabilityBlockedMessage`, `app/actions/not-analyzable.ts`).

2. **Estado do jogo pela API-Football, nunca pela The Odds API.** Placar, minuto, acréscimo e expulsões vêm de `/fixtures?id=` (plano Pro, 7.500 req/dia), buscados **quando a página do jogo abre**, sem cron nem polling. Não existe odd ao vivo: a tela mostra a última odd pré-jogo, rotulada como pré-jogo. O cache entre instâncias é a tabela `match_live_states` (uma row por jogo), com **lease na própria row** (`UPDATE … RETURNING`, 20 s) em vez de lock no KV; no pior caso, uma chamada por minuto por jogo aberto. Idades (`lib/live/freshness.ts`): 60 s para buscar de novo, **2 min** no máximo para registrar (o bolão, sem estado fresco, anota com carimbo de relógio) e 10 min no máximo para mostrar o placar. As actions nunca confiam em minuto ou placar vindos do cliente: releem o estado no servidor. Guarda de cota: abaixo de 5% do limite diário (lido dos headers da última resposta), não busca. A row é só exibição e portão: nunca alimenta settlement nem escreve em `matches`.

3. **Fases do jogo** (`lib/live/phase.ts`, pura): `pre`, `in_play` (1º/2º tempo, ou `NS`/`TBD` já depois do horário = atraso, minuto 0), `half_time`, `extra_time` (`ET`, `BT`, `P`), `interrupted` (`INT`, `SUSP`), `finished` (`FT`, `AET`, `PEN`, `AWD`, `WO`), `postponed` (`PST`), `cancelled` (`CANC`, `ABD`, como no sync) e `started_unknown` (apito passou, sem estado utilizável). Com a flag desligada ou sem estado, a fase é derivada só de `matches` e o comportamento é o de hoje.

4. **Modelo em jogo em código** (`lib/quant/in-play.ts`, `live_model_v1`). O LLM só narra; as probabilidades saem do código.
   - **Entrada:** o mesmo modelo que a página mostrava no apito (`resolveSlipModel(match, { asOf: kickoffAt })`), com λ pós-JEV e ρ do fit, mais o placar atual `(h0, a0)`, o status, `elapsed`, `extra` e as expulsões.
   - **Fração do jogo que falta, `r`:** cada tempo é uniforme na sua duração esperada com acréscimos, com κ₁ = 0,45 dos gols no 1º tempo (`KAPPA_FIRST_HALF`) e κ₂ = 0,55 no 2º. Com `m` o minuto dentro do tempo: `1H` → `κ₁·max(L1 − m, ε)/L1 + κ₂`; `HT` → `κ₂`; `2H` → `κ₂·max(L2 − m, ε)/L2`; `NS` atrasado → 1. `L1 = 45 + S1`, `L2 = 45 + S2`.
   - **Expulsões:** `d = clamp(vermelhos do mandante − do visitante, −2, 2)`; quem tem menos multiplica o λ restante por `RED_OWN^|d|` e o adversário por `RED_OPP^|d|`. Sem dado de expulsão, multiplicadores 1 e o rótulo diz.
   - **Matriz final, a condicional coerente do Dixon-Coles:** `F[h][a] ∝ Pois(h − h0; μH) · Pois(a − a0; μA) · τ(h, a; λH, λA, ρ)` para `h ≥ h0`, `a ≥ a0` (0 no resto), renormalizada, com `μ = λ · r · multiplicador` e o τ do pré-jogo nas coordenadas **finais** (helper `dixonColesTau` compartilhado com `scorelineMatrix`). Em `r = 1`, 0-0, sem expulsão, `F` é exatamente a matriz de pré-jogo; em `r → 0`, massa no placar atual; sem expulsão, a média de `F` sobre o placar do minuto t que o próprio modelo implica devolve a matriz de pré-jogo. Com algum lado em 2+, o τ não pesa (Poisson puro, como no DC).
   - **Constantes provisórias**, a calibrar com os dados que esta feature passa a gravar: `S1 = 3`, `S2 = 6` minutos de acréscimo esperado; `ε = 0,5` minuto; `κ₁ = 0,45`; `RED_OWN = 0,70`; `RED_OPP = 1,25`. Mudou fórmula ou constante, a versão sobe.
   - **Limites do v1:** intensidade uniforme dentro de cada tempo (a real sobe no fim e depende do placar); sem backtest; o τ cheio no placar final deixa o "0-0 no fim" alguns pontos acima do Poisson puro no 2º tempo. Sem leitura nem registro em `ET`/`BT`/`P` e nos terminais. `first_half_*` e `first_to_score` ficam fora ao vivo (`priceLeg` os recalcula do λ, não da matriz). Seleção já decidida é um predicado sobre o placar atual (`isDecided`), nunca `P ∈ {0, 1}`.

5. **Sem odd ao vivo não há edge.** Toda predição ao vivo é `pass`, com `odd_at_recommendation`, `implied`, `edge` e `bookmaker` nulos e `prediction_selection_odds.odd` nulo (a coluna deixa de ser NOT NULL); o `model_version` é `…;engine=code_jev;lambda=…;live=live_model_v1`. Comparar o modelo em jogo com a odd pré-jogo fabricaria edges enormes e fica proibido. O valor ao vivo é só o EV na odd que o usuário digita em Suas apostas, sem stake sugerido.

6. **Registros ao vivo marcados e fora das métricas de pré-jogo.** `predictions`, `bet_slips`, `palpite_sets`, `user_palpite_analyses` e `friend_pool_entries` ganham `is_live boolean not null default false` e `live_state jsonb`, com CHECK `is_live = false OR live_state IS NOT NULL`. O carimbo (`LiveStampSchema`, `lib/live/stamp.ts`) guarda fonte (`api_football` ou `clock`), status, minuto, rótulo do minuto, placar, expulsões, idade do estado, instante do registro e, quando houver, as entradas do modelo em jogo; é validado por Zod na escrita e lido com `safeParse` (carimbo inválido = "ao vivo, sem carimbo", nunca derruba a página). Exclusões **na query, antes de qualquer dedup**: calibração (`settledFilter` com `is_live = false`), dashboard e gate do Kelly (`selectDashboardRows`, só pré-jogo por padrão), CLV (guarda explícita além de `pass`) e o resumo de retorno de `/apostas` (linha "ao vivo" separada). Settlement não muda: registros ao vivo liquidam pela mesma regra e pelo mesmo placar de 90'.

7. **Bolão ao vivo (emenda a ADR 0054 §3).** As apostas do bolão ficam abertas até **15 minutos de jogo** e fecham sozinhas. Sem minuto do provider (sem estado, sem `elapsed`, provider fora), fecham no apito + 15 min de relógio. O atraso (`NS` depois do horário) mantém aberto: o corte é de minuto jogado. O minuto é extrapolado pela idade do estado, para um estado velho não deixar aberto. O dono pode **fechar antes** (`bets_closed_at`, só fecha, não reabre). O admin pode **estender** os **próprios** bolões (+15/+30/+60 min a partir de agora, teto apito + 3h; `bets_extended_until`, `bets_extended_by_user_id`); estender o bolão de outra pessoa exigiria tela nova e fica fora. **Tirar aposta depois do apito continua bloqueado** (tirar quem perdeu mudaria o pote). Cada aposta anotada ao vivo grava minuto e placar do momento, visíveis na lista e na linha do ganhador; a pontuação não muda. O bolão nunca movimenta dinheiro (ADR 0054 §7).

   **Atualização (#601, 2026-10-16, pedido do dono):** o "fechar" do dono deixa de ser definitivo. Depois do apito, com `enable_live_mode` ligado, o dono vê **"Reabrir apostas"** sempre que as apostas estão fechadas (pelo corte dos 15', por ele mesmo ou por uma extensão vencida), enquanto o jogo não terminou (`poolMatchEnded`), o bolão não tem resultado (`poolHasResult`) e antes do teto técnico do apito + 3h (`poolOwnerReopenable`, `lib/pools/pool-state.ts`). Reabrir fica aberto até o dono fechar de novo ou o jogo acabar; fechar e reabrir se alternam quantas vezes ele quiser. Sem coluna nova nem migration: reabrir (`reopenFriendPoolBets`, que relê dono, flag e estado do jogo no servidor) limpa `bets_closed_at` e grava `bets_extended_until` = apito + 3h com `bets_extended_by_user_id` = dono, então `poolExtensionActive` mantém aberto até o fim; fechar continua limpando a extensão. Extensão no teto aparece como "abertas até o fim do jogo" (`poolOpenUntilEnd`), não "estendidas até HH:MM". Antes do apito não há reabrir (o fechar do dono vale até o apito; depois dele o botão aparece). Os presets do admin seguem como estão (o cartão some enquanto o bolão está aberto até o fim, onde um preset só encurtaria). Continuam valendo: cada aposta grava minuto e placar, tirar aposta depois do apito é bloqueado e o placar manual só com as apostas fechadas. Flag desligada: como antes, sem controles e fechando no apito.

8. **Prompts.** Os de pré-jogo ficam byte-idênticos. As variantes ao vivo têm versão própria: `narrator_live_v1` (leitura sem aposta, situação do jogo no contexto, contexto enxuto sem forma, H2H, tabela ou desfalques, que já estão no λ), `palpites_live_v1` (sem placar do 1º tempo, primeiro a marcar e cartões; placar provável nunca abaixo do atual) e `user_palpite_narrate_live_v1`. Toda chamada continua por `lib/ai/predict.ts` ou pelo seam `AIProvider`, com log em `ai_calls`. O "Contexto extra" (ADR 0055, emenda #565) não é oferecido ao vivo nesta versão.

9. **Kill-switch `ai_config.enable_live_mode`** (default ON, no `/admin/settings`). Desligado: tudo fecha no apito como antes e nada busca estado ao vivo.

10. **Dados** (migration 0059, aditiva e idempotente, segura no DB de preview compartilhado): tabela `match_live_states` (FK `matches` em cascata: é cache derivado), as colunas do item 6, o `DROP NOT NULL` do item 5, as três colunas de `friend_pools` do item 7 e a flag do item 9. Nenhum dado pessoal novo (o carimbo é estado do jogo).

## Emendas

- **ADR 0054 §3:** "as apostas fecham no apito inicial" passa a ser "fecham aos 15 minutos de jogo, ou no apito + 15 min de relógio sem minuto do provider; o dono pode fechar antes e o admin pode estender os próprios bolões". "Depois disso não dá pra tirar aposta" passa a valer **a partir do apito**, como hoje. Com `enable_live_mode` desligado, vale o texto original.
- **ADR 0052 §9:** depois do apito, o modelo em jogo lê a base **como ela era no apito** (`getMatchModelScoreline` com `now = kickoff − 1 ms`: a idade de 24h é medida no apito e o corte "o jogo já começou" não se aplica a essa leitura). As demais leituras da base continuam devolvendo null depois do apito.
- **ADR 0053 §5-6:** ao vivo não há "edge do modelo" (a referência é pré-jogo) nem stake sugerido (banda ou Kelly: o modelo em jogo não tem calibração). A probabilidade da avaliação vem sempre do modelo em jogo calculado na hora, não de uma análise salva (§3). A odd do usuário continua fora do Σ1/odd.
- **ADR 0055:** o bloco "Seu palpite" existe durante o jogo. A leitura pelos botões refaz `F` no cliente com a mesma função pura (placares abaixo do atual saem 0%); "Analisar meu palpite" usa a base do apito, aplica a evidência do usuário no λ pré-JEV como hoje e só depois a transformação em jogo (o JEV nunca entra duas vezes). O veredito continua em código.

## Reafirmadas

- **ADR 0048:** nenhum nome, link ou logo de casa em tela; o bolão não movimenta dinheiro.
- **ADR 0038:** sem preço não há edge, então toda leitura ao vivo é `pass`.
- **ADR 0030:** o cabeçalho do jogo ganha placar e minuto, nunca modelo, odd ou edge.
- **ADR 0057:** um §3 por tela onde se registra aposta, também ao vivo.

## Alternativas rejeitadas

- **Odd ao vivo pela The Odds API.** O free tier não paga, e gravar odd ao vivo em `selection_odds_snapshots` contaminaria a referência pré-jogo da tabela de mercados e do registro.
- **Comparar o modelo em jogo com a odd pré-jogo.** A odd de over 2.5 de antes do jogo não vale aos 70' com 0–0; o edge seria fabricado.
- **O LLM estimar as probabilidades ao vivo.** Sem limite nem auditoria; o motor `code_jev` já separa número (código) de texto (LLM).
- **Aplicar o τ do Dixon-Coles aos gols que faltam** (`scorelineMatrix(μH, μA, { rho: ρ·r })` deslocada, o rascunho do plano). Repondera placares finais que o DC não mede, precisa do ajuste ad hoc `ρ·r` e não fecha com o pré-jogo (aos ~60' em 0-0 com λ 1,4 × 1,1: 42,0% de 0-0 no fim contra 46,8% na condicional coerente). Qual das duas calibra melhor fica para os dados gravados.
- **Lock no KV para a busca.** Uma ida de rede a mais no render e um segundo estado para manter coerente com a row; o `UPDATE … RETURNING` é atômico no próprio Postgres.
- **Cron ou polling do placar.** Custo de cota sem leitor; a busca acontece só quando alguém abre a página.
- **Pontuação do bolão por minuto.** Mudaria a regra fixada pelo dono; o carimbo visível basta, porque o dono anota tudo na frente do grupo.

## Consequências

- **(+)** O app serve durante o jogo sem nenhum crédito da The Odds API, e a página deixa de gastar créditos em jogo começado (correção avulsa do PR 0, #588).
- **(+)** Os números de desempenho continuam medindo só o pré-jogo, com a exclusão pronta antes do primeiro registro ao vivo.
- **(+)** Cada registro ao vivo grava o estado do jogo: é o dado que falta para calibrar o modelo em jogo.
- **(−)** O modelo em jogo não tem backtest; as constantes são da literatura. Mitigado por nunca recomendar aposta nem sugerir stake ao vivo e pelo rótulo "modelo ao vivo".
- **(−)** O provider pode atrasar um gol: alguém pode anotar no bolão com o placar anterior. O carimbo deixa visível; o corte de 15' e a idade máxima de 2 min limitam a janela.
- **(−)** Uma busca ao provider (teto de 4 s) pode segurar o render da página quando a row está velha.
- **(−)** O payload real de `/fixtures?id=` (`events`, `status.extra`, o texto do segundo amarelo) é inferido da documentação até ser validado com a chave num jogo ao vivo; sem `events`, as expulsões degradam para "sem dados".

## Referências

ADRs 0030, 0038, 0041 (motor `code_jev`), 0048, 0051 (Dixon-Coles), 0052, 0053, 0054, 0055, 0057. Plano: `docs/plans/PLAN-580.md`. Código (PR A1): `db/migrations/0059_*.sql`, `lib/db/queries/match-live-states.ts`, `lib/live/stamp.ts`, `lib/live/freshness.ts`, `lib/live/phase.ts`, `lib/view/match-availability.ts`, `app/actions/not-analyzable.ts`.
