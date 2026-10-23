# PLAN-619 — escalação confirmada como sinal de rotação (JEV v3) e reconferência só em código

Issue #619. Proposta: https://claude.ai/artifact/DhAYuVkXK3PsQXsxEa1CKH (item 3). Snapshot de 2026-10-22, sobre `main` `310b3ad` (depois do #617/PR #621).

## Problema (no código)

- O predict (passo 3, `lib/ai/predict.ts:562`) e o cron da base (`lib/model-base/judgment-data.ts`) já buscam a escalação **deste** jogo, mas ela só serve de fallback pro papel do desfalcado (`judgment-input.ts`: `previousLineups?.home ?? lineups?.home`). Efeito colateral ruim: jogador em dúvida que está no banco hoje vira `rotation midfielder (doubtful)`; desfalcado fora da lista vira `player (...)`.
- `rotation_risk` só olha calendário (`rest_before_match`/`next_match`); `attack_weakened` só olha `absences`. Time que poupa 6 titulares sai igual a time que repete o XI.
- Nada reage à publicação da escalação (~20–60 min antes do KO). A análise da véspera fica com o número pré-escalação até o apito; refazer exige "Analisar com IA" (LLM + limite diário).
- `fetchPreviousLineups` pega o último jogo de qualquer competição e só pros times com desfalque.

## Desenho

### 1. XI de referência (mesma competição), custo zero antes da escalação

- `NormalizedLineupPlayer` (`lib/providers/sports-data/types.ts`) ganha `providerPlayerId?: string` (aditivo). Adapter api-football preenche `api-football:<player.id>` quando não-nulo. Cruzamento entre XIs: por id quando os dois lados têm, senão por nome normalizado (`normalizePersonName`, em `state.ts`).
- `pickLineupBaseline(form, { league, kickoffMs }): NormalizedFixture | undefined` em `lib/ai/engine/judgment-input.ts` (pura, sem nomes):
  - candidatos: jogos da forma com `competition?.league === league` (fora: amistoso, outra competição, forma sem `competition`), antes do KO, idade ≤ 45 dias (`LINEUP_BASELINE_MAX_AGE_MS`);
  - prefere o mais recente **não congestionado** (sem outro jogo do time — forma, qualquer competição — nem este jogo a < 72 h dele); senão, o mais recente.
  - Por quê: com um XI só, um jogo de liga poupado antes de Champions viraria referência e o time completo de hoje sairia "5+ mudanças" (erro de direção). Filtro usa só datas da forma: zero request.
- "Titular habitual" = titular no XI de referência (documentado no ADR).
- Busca em `prepareMatchJudgmentInput` (`predict.ts:2381`) **só quando `data.lineups` existe** (adapter só devolve escalação com os dois lados publicados). Memo por chamada `lineupForFixture` compartilhado com `fetchPreviousLineups` (mesmo jogo → uma busca). Fail-open: erro/prazo/lado ausente → `"announced, changes unknown"`. Prazo `JUDGMENT_EXTRAS_BUDGET_MS` (8 s) no predict; cron e reconferência sem prazo.
- `MatchJudgmentData` ganha `lineupBaseline?: { home?: NormalizedTeamLineup; away?: NormalizedTeamLineup }`; `JudgmentFetchedData` omite também esse campo.

### 2. State v3 (`lib/ai/judgments/state.ts`, `types.ts`)

- `JudgmentTeamState` ganha dois campos **sempre presentes**:
  - `lineup: string` ∈ `"not announced"` | `"announced, changes unknown"` | `"announced, 0 to 2 changes from the usual starting lineup"` | `"… 3 to 4 changes …"` | `"… 5 or more changes …"`.
  - `starters_left_out: string[]`: papéis dos titulares habituais fora do XI de hoje **e não listados em `absences`** — `"starting forward (on the bench)"`, `"starting defender (not in the squad)"`, `"first-choice goalkeeper (on the bench)"`, `"starting player (on the bench)"` (posição desconhecida); sem banco na resposta, sem parênteses. Ordenado (GK, DEF, MID, FWD) pra estabilidade do `stateHash`. `[]` antes da escalação ou com mudanças desconhecidas.
- Em `state.ts` (nomes nunca saem do módulo): `LineupChangeBucket = "0-2" | "3-4" | "5+"`, `lineupChangeBucket(changes)`, `LineupSummary = { status: "not_announced" } | { status: "announced"; changes: LineupChangeBucket | null; leftOut: { position?; whereabouts?: "bench" | "out_of_squad" }[] }`, `summarizeLineup({ today?, reference?, absences })` (`changes = 11 − |XI hoje ∩ XI ref|`; XI ≠ 11 titulares → `null`), `lineupStateFields(summary)`. Constantes do vocabulário exportadas pro teste de criteria.
- `JudgmentTeamInput` ganha `lineup: LineupSummary` (montado em `buildMatchJudgmentInput`); `MatchJudgmentInput` ganha `lineup: { home; away }` (sem nomes) pro jsonb e o texto templado.
- Jogador em dúvida: o papel do desfalcado deixa de vir da escalação deste jogo (ordem: XI do jogo anterior → XI de referência → sem papel). Com XI confirmado, desfalcado **entre os titulares de hoje** sai de `absences` (vai jogar). `enrichAbsences` ganha `context.confirmedLineup`. Antes da escalação nada muda.

### 3. Perguntas (`lib/ai/judgments/questions.ts`)

- `JUDGMENTS_VERSION = "jev_judgments_v3"`, commit `prompt:`. Pesos inalterados (`judgment_weights_v1`).
- `rotation_risk` true: `T.lineup` announced com 5+ mudanças (forte) ou 3–4 (moderada); goleiro titular em `T.starters_left_out` também aponta rotação. Sem escalação ou mudanças desconhecidas: critério de calendário atual. False: announced com 0–2 mudanças, qualquer calendário; ou não anunciada/desconhecida + critério de calendário atual.
- `attack_weakened`: instrução "The absences or lineup choices listed for this team remove a first-choice attacking player who is central to how the team scores." (sem negação); true ganha "or `T.starters_left_out` includes a starting forward"; false ganha "and `T.starters_left_out` has no starting forward".
- `attack_weakened` e `defense_weakened`: "Once `T.lineup` is announced, every player still listed in `T.absences` is outside the starting lineup, including doubtful ones." `defense_weakened` não lê `starters_left_out` (fora do escopo).

### 4. Paridade, reuso, cron da base e jsonb

- Antes da escalação, state v3 = v2 + `lineup: "not announced"`, `starters_left_out: []`: predict e cron montam igual, mesmo `stateHash`.
- Depois: os dois caminhos já buscam a escalação; a referência sai do mesmo `prepareMatchJudgmentInput`. Única divergência possível: prazo do predict ("changes unknown") → outro hash → JEV de novo (custo, não erro).
- `compute-match-models`: com escalação publicada o pior caso sobe ~4 req (~16 req ≈ 120 s + JEV) → `RUN_DEADLINE_MS` 180 → 160 s.
- Bump: bases `v2` vão pro bucket 0 da fila; "Seu palpite" não reusa base v2 até o próximo cron (≤ 6 h).
- `PredictionJudgments` (`lib/ai/engine/types.ts`, jsonb aditivo) ganha `lineup?: { status; home: { changes; leftOut: number } | null; away }`, gravado em toda predição code_jev nova.

### 5. Reconferência: `recheckPredictionWithLineup` (exportada de `lib/ai/predict.ts`)

- Em `predict.ts` pra reusar `runCodeJevEngine` → `decideRecommendation` → `toPredictionJudgments` → `persistPrediction` e manter a porta única do JEV. Nenhum caminho de LLM alcançável (teste garante).
- Entrada `{ parent: { prediction; marketKey }, match, scoreline, judgment: { input; run }, extraLines }`; saída `{ kind: "persisted"; predictionId; flipped } | { kind: "skipped"; reason: "not_code_jev_market" | "no_recent_odds" | "kickoff_passed" }`.
- Odds **só do banco**: `getLatestFreshSelectionOddsSnapshots(args, now, RECHECK_ODDS_MAX_AGE_MS = 6 h)`; nenhuma → skip. 6 h porque `prewarm-odds` (0 */6, janela 24 h) mantém 1X2 e O/U 2,5 de toda liga ativa com captura ≤ 6 h, e a captura mais recente nunca é mais velha que a da análise original. Helpers puros extraídos de `runPredict`: `bundleFromSnapshot`, `impliedFromBundle`.
- Texto: `templatedNarration` + `NarratorDecision.lineupNotes?: string[]` (frases de `LineupSummary` via `lineupNotePhrases` em `labels.ts`, sem nomes), abrindo o racional e como 1º key factor. Narrador LLM não lê o campo (sem bump).
- Row nova: `userId` do pai; `aiCallId = run.aiCallId ?? parent.aiCallId` (row JEV de sistema, `user_id` null permitido pro typesafe); `modelVersion` `${modelId do pai}${codeJevModelTags};recheck=lineup_v1`; `judgments` + `lineup`, `narration: "lineup_recheck_template"`, `recheck: { kind: "lineup"; version: "lineup_v1"; of: parent.id; parentStateHash; oddsCapturedAt }`. Referência em jsonb (ADR 0020, sem coluna). Guarda de KO imediatamente antes do insert.
- `ownsAiCall` false pra `"lineup_recheck_template"` (sem custo no card).
- Sempre grava uma row por pai elegível com odds (texto antigo cita números que mudaram; par pai → reconferência é o grupo de controle; marcador "nada muda" exigiria mutar o pai).

### 6. Quem é reconferido: `getLineupRecheckCandidates` (`lib/db/queries/lineup-recheck.ts`)

- Jogos `scheduled` com KO em (agora + 5 min, agora + 75 min]. Por (jogo, usuário, `marketKey`), só a predição pré-jogo mais recente. Elegível: `engine = code_jev`, sem `judgments.recheck`, `judgments.lineup?.status !== 'announced'`, sem `judgments.userContext`. Pass e aposta entram.

### 7. Gatilho: cron `recheck-lineups`

- `vercel.json` `"5,15,25,35,45,55 * * * *"`; rota `app/api/cron/recheck-lineups/route.ts` (`maxDuration = 300`, `isAuthorizedCron`); lógica `lib/lineup-recheck/run.ts`.
- `runLineupRechecks({ now })`: flag OFF → sai; lock KV; candidatos (vazio → sai, 1 query); sem key TypeSafe → sai com log; por jogo em ordem de KO até 140 s: KO > agora + 2 min; sonda `getLineups` (não saiu → próximo); marcador KV `lineup-recheck:done:<matchId>` (3 h); JEV do jogo via `fetchMatchJudgmentData` + `resolveModelBaseJudgments` (1 chamada por jogo, serve todos os usuários/mercados; falha solta o marcador); `recheckPredictionWithLineup` por pai em sequência. Log `scope: "recheck_lineups"` com contadores.
- Não toca `lib/rate-limit.ts`, provider de odds, `ensureOddsSnapshotsFresh` nem Anthropic.
- API-Football: sonda ≤ 2 req/run; passada completa ~12–17 req, uma vez. Teto ≈ 30 req/jogo.

### 8. Flag (única migration)

- `ai_config.enable_lineup_recheck boolean DEFAULT true NOT NULL` (`0062_lineup_recheck.sql`, `ADD COLUMN IF NOT EXISTS`), `getEnableLineupRecheck()`, `ADMIN_FLAGS` "Reconferir com a escalação". Desliga só a reconferência; o state v3 vale sempre.

### 9. Tela

- `MarketAnalysisSectionItem` ganha `lineupRecheck?: { at; oddsAt; before; after; changed; notes }` (montado em `toMarketAnalysisSections` achando o pai por `recheck.of`); `market-analysis-section.tsx` mostra selo "Atualizado com a escalação", "Recalculado em código às HH:MM com as escalações confirmadas, sem nova chamada de IA. Odds de HH:MM." e "Antes da escalação: … → agora: …". Pai segue em "análises anteriores". `oddAtRecAgo` pela captura. `formatAnalysisEngine` acrescenta "atualizado com a escalação".
- Hero: se há reconferência mais nova que `palpiteSets[0].createdAt`, aviso "Palpite gerado antes da escalação. As análises foram atualizadas às HH:MM" (+ ", e a recomendação de <mercado> mudou"). Só texto e hora (firewall ADR 0030).

## Custo

Anthropic zero; limite diário zero; The Odds API zero. JEV ≤ 1 chamada por jogo com pai elegível (~US$0,0001). API-Football ≤ ~30 req por jogo na última hora; +4 no predict e no cron da base com escalação publicada. Vercel 144 invocações/dia (1 query sem candidato).

## Valor esperado e medição

O mercado precifica a escalação em minutos e a odd usada é quase sempre anterior a ela: o ganho é **não agir num número velho**, não edge novo. Medir: calibração por `judg=…v3;recheck=lineup_v1` × v3 sem recheck; Brier/log-loss pareado pai × reconferência; distância à probabilidade de fechamento sem margem (com CLV ligado); contadores do log.

## Versão e docs

`jev_judgments_v3` (`prompt:`), tag `recheck=lineup_v1`. Adendo ADR 0041 "(2026-10-22, #619)"; linha no ADR 0052.

## Fora

Narrador LLM ciente da escalação; `check-claims` com XI; `defense_weakened` com `starters_left_out`; tag de artilheiro em `starters_left_out`; `fetchPreviousLineups` por competição; snapshot da "Leitura do modelo" na escalação; reconferir análise LLM/com contexto do usuário/ao vivo; segunda passada; odds novas; regenerar manchete; notificação; recalibrar pesos.

## Testes

Ver lista por arquivo no PR: `state.test.ts` (bucket, `summarizeLineup`, `enrichAbsences` com XI confirmado), `judgment-input.test.ts` (`pickLineupBaseline`), `questions.test.ts` (vocabulário v3), `predict.code-jev.test.ts` (busca condicional da referência, fail-open, `recheckPredictionWithLineup` sem Anthropic/odds provider, 6 h, multi-linha, campos, flip, KO), pglite (paridade cron → predict; candidatos), `run.test.ts` (flag, sonda, 1 JEV p/ N pais, falha solta marcador, prazo, lock, rate-limit nunca chamado), `ownsAiCall`, `formatAnalysisEngine`, view, admin flags, rota 401.

## Riscos abertos (pro review)

1. Preço anterior à escalação infla edge/Yield/CLV da reconferência.
2. Yield passa a contar a reconferência no lugar da análise original.
3. Um XI de referência só (ruído).
4. Cruzamento por nome quando falta id.
5. Forma com 5 jogos pode não ter jogo da mesma competição em copa.
6. JEV nunca viu esse vocabulário (probe manual de 4–5 states antes do merge).
7. Capacidade do cron em horário cheio.
8. Análise interativa depois da escalação sai "changes unknown" e não é reconferida.
9. `defense_weakened` ignora goleiro titular no banco.
10. "Antes → agora" também carrega outras mudanças (refit, desfalques).
11. Cron de 10 min no plano da Vercel.
12. Volume: best bet com 7 mercados → 7 reconferências por pessoa e jogo.
13. `resolveModelBaseJudgments` com outro chamador (nome e log enganosos).

## Ajustes do review do plano (valem sobre o resto)

Divisão em **dois PRs**: **A** = state v3 (sinal da escalação no JEV, sem reconferência); **B** = reconferência (cron, flag, tela, exclusão do Yield).

### PR A (`prompt:`, `jev_judgments_v3`)

1. **Mudanças voluntárias, não totais.** O bucket conta só titulares do XI de referência fora do XI de hoje **e fora de `absences`** (= `starters_left_out.length`). Lesionado/suspenso já pesa em `attack_weakened`/`defense_weakened`; contar de novo em `rotation_risk` puniria duas vezes o mesmo λ. O campo vira `"announced, 0 to 2 voluntary changes from the usual starting lineup"` etc.
2. **Diff só com id do mesmo provider.** `changes` só é calculado quando os dois XIs têm 11 titulares com `providerPlayerId` do mesmo prefixo; senão `null` ("changes unknown"). Football-data.org (fallback de escalação) escreve nomes diferentes e daria "5+" falso. Nome normalizado só pro cruzamento desfalcado ↔ XI (já é assim hoje).
3. **Referência sem prazo**, como `fetchPreviousLineups` (até +4 req: referências em datas diferentes custam a busca de jogos por data e a escalação de cada uma; o memo compartilhado evita repetir o mesmo jogo). Com prazo, a análise interativa depois da escalação sairia quase sempre "changes unknown" e quebraria a paridade de `stateHash` com o cron.
4. **`defense_weakened` também lê `starters_left_out`** (goleiro titular / zagueiro titular no banco), já que o bump v3 é a parte cara; evita um v4.
5. `compute-match-models`: `RUN_DEADLINE_MS` 180 → 150 s (comentário com a conta nova).
6. Testes extras: paridade predict ↔ cron com escalação publicada; diff `null` com providers mistos/sem id; voluntária × forçada; em dúvida no XI sai de `absences` e não entra em `starters_left_out`, em dúvida no banco fica; `pickLineupBaseline` (amistoso, sem `competition`, > 45 dias, congestionado); LGPD (nomes marcantes na fixture, ausentes do state e do jsonb).

### PR B (reconferência)

7. **Placar do pai, não refit.** `ModelScoreline` reconstruído do jsonb do pai (`judgments.lambda.{source, degraded, rho, base}`): isola o efeito da escalação do refit diário. `standings` buscado uma vez por jogo; falhou → pula o jogo (`data_unavailable`, como o cron).
8. **JEV falhou (`run.answers === null`) = falha**: pula, solta o marcador, conta `jev_failed`. Nunca grava DC puro rotulado "atualizado com a escalação".
9. **Pula reconferência sem informação** (`lineup_uninformative`): os dois lados com `changes: null` e nenhum desfalcado removido.
10. **Odds:** over/under avalia só a linha do pai (`marketParams.line`). Fonte: captura ≤ 6 h no banco; sem ela, as odds congeladas do próprio pai (`prediction_selection_odds`), marcadas `oddsFrom: "parent"`. Zero crédito. `extraLines` vem de um helper extraído de `app/actions/predictions.ts` (flag ∩ ligas cobertas).
11. **Fora do Yield/CLV/Kelly:** `selectDashboardRows` exclui `judgments.recheck` em SQL antes do dedup (junto do filtro `isLive`); `getNonPassPredictionsNearKickoff` também (uma virada não gasta crédito de closing line). Calibração mantém (segmentada pela tag `recheck=lineup_v1`). Adendo no **ADR 0020** (ponteiro `recheck.of` e exclusão do "mais recente").
12. **Candidatos:** `DISTINCT ON (match, user, market)` sobre pré-jogo por `createdAt desc` **antes** de aplicar elegibilidade (pai + reconferência → 0 candidatos).
13. **Corrida com análise interativa:** antes do insert, junto da guarda de KO, confere que não há pré-jogo mais nova que o pai no mesmo balde; senão `superseded`.
14. **Marcador KV com timestamp:** pais criados depois do marcador ainda entram.
15. **Tela:** `lineupRecheck` vai no `AnalysisView` (`toAnalysisView`), não na seção, pra aparecer em todo layout e sumir na troca client-side. `ownsAiCall` vira allow-list (`narration` ausente ou `"llm_call"`). Notas da escalação entram **depois** de probabilidade/edge nos key factors. Hero: uma linha "Palpite gerado antes da escalação" quando há reconferência mais nova; sem `formatAnalysisEngine` novo.
16. **Cron:** prazo de início 120 s; pula o run enquanto o lock do `compute-match-models` está tomado (evita ~16 req/min entre instâncias); 200 quando não há nada a fazer. Capacidade: ~1–2 jogos por run, ~10 por horário de KO.
17. `resolveModelBaseJudgments` ganha parâmetro de escopo do log.

## Notas da implementação do PR A

- As strings de `lineup` e o tipo `LineupChangeBucket` ficam em `lib/ai/judgments/lineup-vocabulary.ts` (sem dependências), reexportados por `state.ts`. Motivo: `questions.ts` cita essas strings e é importado por componentes de cliente via `lib/user-palpite/types`; importar `state.ts` puxaria o mapa de times canônicos pro bundle.
- `starters_left_out` só leva o lugar entre parênteses quando o banco de hoje veio com id do mesmo provider em todos os jogadores; senão sai sem parênteses (mesma regra do item 2 do review).
- ~~Fica para depois (sem bump do narrador neste PR)~~ Feito no code review (`narrator_v1.4`, item 6 abaixo): `FACTOR_PHRASE` de `attack_weakened`/`defense_weakened` em `lib/ai/markets/_narrator/labels.ts` começa com "Desfalques…", e na v3 o fator também pode subir por titular poupado (`starters_left_out`).

### Ajustes do code review do PR A

1. Desfalcado ↔ XI por id: `NormalizedInjury.player.providerPlayerId` (`api-football:<id>`, mesmo formato da escalação), porque o `/injuries` grafa o nome curto ("K. Walker"). Vale pra tirar o titular de hoje de `absences`, pra excluir desfalcado das mudanças voluntárias e pro papel no XI anterior/de referência. Id de prefixo diferente ou ausente → nome normalizado.
2. `pickLineupBaseline`: todos os candidatos congestionados → `undefined` ("changes unknown", o calendário decide), não o mais recente.
3. Atacante titular poupado conta em `rotation_risk` e em `attack_weakened`: aceito e documentado no ADR 0041.
4. Criteria de `attack_weakened`/`defense_weakened`: "Once `T.lineup` is announced, a doubtful player still listed in `T.absences` is not starting and counts like an injured one" no true e no false; `starting player` (posição desconhecida) citado como papel desconhecido. Segue `jev_judgments_v3` (não mergeado).
5. XI vazio não é escalação: adapter da API-Football devolve `undefined` com `startXI` vazio de um lado; `summarizeLineup`/`enrichAbsences` tratam XI de hoje sem titulares como não anunciado.
6. Narrador `narrator_v1.4`: `FACTOR_PHRASE` de ataque/defesa cobre desfalque e titular poupado (commit `prompt:` próprio).
7. Conferência das afirmações do usuário recebe `providerAbsences` (lista do provider, sem tirar o XI de hoje), igual a `lib/user-palpite/facts.ts`.
8. Falha de escalação passada logada uma vez, dentro do memo (`past_lineup_fetch_failed`, só nomes dos times); o memo vira `undefined` e os chamadores não logam.
9. Só o XI de referência precisa de ids completos. Hoje basta 11 titulares, ids sem repetição, nenhum de outro provider e ao menos um do mesmo (estreante sem id conta como mudança; hoje sem id nenhum, o fallback football-data.org, segue "changes unknown").
10. Custo corrigido pra "até +4 req" (item 3 acima e ADR); ADR registra a espera maior atrás do limite de 8 req/min na análise interativa.
11. Testes novos: nome curto × completo por id, fallback por nome, lesionado no XI de hoje sai, ids repetidos, estreante sem id, XI vazio (state e adapter), lançamento síncrono no memo, cron fail-open com a referência falhando, `providerAbsences` na conferência, vocabulário inteiro nos criteria.

## Notas da implementação do PR B

Onde o código difere do plano e dos ajustes acima:

1. **`before` no jsonb.** `judgments.recheck` grava o `before` do pai (recomendação, linha, confiança, edge), além do `of`. A view monta o "Antes da escalação: … → agora: …" só com a row, sem buscar o pai por id.
2. **Sem helper de `extraLines`.** Como só a linha do pai é avaliada (item 10), basta o cartucho base mais `marketParams.line` do pai. Não houve o que extrair de `app/actions/predictions.ts`.
3. **`judgeIf` em `resolveModelBaseJudgments`.** O teste de "sem informação" (item 9) roda sobre o input, antes do JEV, então pular não gasta a chamada. Junto do `logScope` (item 17).
4. **Marcador.** Carimbo = instante da busca dos candidatos. Gravado só no fim da passada do jogo (ver o ajuste 5 do code review abaixo); "sem informação" também marca: só um pai novo reabre o jogo.
5. **Ordem do run.** Flag → lock do `compute-match-models` → lock próprio → candidatos → chave do JEV. Sem candidatos, o run faz uma query e sai sem log.
6. **Elegibilidade em JS.** O `DISTINCT ON` roda em SQL (item 12) e a elegibilidade (`code_jev`, sem `recheck`, sem `userContext`, escalação não anunciada, λ válido) é filtrada em JS sobre esse resultado, na mesma query.
7. **Motivo `parent_incomplete`.** Pai sem λ válido ou over/under sem linha é pulado com esse motivo (além de `not_code_jev_market`, `jev_failed`, `no_odds`, `superseded` e `kickoff_passed`).
8. **"(mesma recomendação)".** Na tela, o "antes → agora" ganha esse sufixo quando a recomendação não mudou.
9. **Hero.** Uma linha sem horário ("Palpite gerado antes da escalação."), só quando a reconferência é mais nova que o palpite.
10. **Guardas de KO.** O jogo só é começado com KO a mais de 2 min. Antes do insert, a guarda estrita é `kickoffAt > now`, pelo horário e não pelo status.
11. **"Odd há X".** Na reconferência é medido a partir da captura usada. Vem `null` quando as odds são as do pai, e a linha diz "Odds da análise anterior."
12. **`aiCallId`.** Aponta pra row de `ai_calls` do JEV usado quando ela é de sistema: a desta passada (`user_id` nulo) ou a da base do modelo que a fez. JEV reusado de outra predição (row de outro usuário) ou sem row → a do pai. `ownsAiCall` (allow-list) não atribui custo de LLM à reconferência.
13. **Notas da escalação no racional.** Os fatores vêm depois de probabilidade e edge, e o racional só ganha o prefixo das notas se tudo couber em `RATIONALE_MAX_CHARS`. O prompt do LLM não lê `lineupNotes`, então o narrador não muda de versão.

### Ajustes do code review (PR #624)

1. **Guarda `superseded` em SQL.** `hasNewerPreMatchPrediction` comparava `created_at` com o `Date` do JS (ms); o Postgres guarda µs, então o pai contava como mais novo que ele mesmo e quase toda reconferência saía `superseded`. Agora compara `(created_at, id)` com a row gravada do pai (subquery) e exclui o próprio id. Teste pglite com `created_at` em µs.
2. **Gate do Kelly sem reconferências.** `getOverUnderCalibrationRows({ excludeRechecks: true })` (`judgments->'recheck' IS NULL`) no `loadKellyGate`.
3. **Calibração sem contagem dupla.** As rows ganham `isRecheck`; resumo, "por motor" e "por mercado" (e a contagem de apostas do resumo) as deixam de fora. Só a tabela por versão as mostra, no segmento `recheck=lineup_v1`.
4. **"Em dúvida" é informação.** `isLineupInformative` também dispara quando um lado anunciado ainda tem desfalcado `doubtful` na lista (o v3 o trata como fora do jogo).
5. **Marcador no fim.** Gravado só depois da passada pelos pais, e só sem erro de pai (pulos determinísticos marcam). Pai que lança ou run que morre no meio não marcam: o próximo run refaz, e quem já virou reconferência sai sozinho pelo `DISTINCT ON`. Falhas antes do JEV não mexem no marcador.
6. **Odds robustas.** A leitura da captura lança em captura incompleta/incoerente: vira fallback pras odds do pai (com log). Captura mais velha que `pai.createdAt − ODDS_SNAPSHOT_FRESHNESS_MS` também perde pras odds do pai.
7. **`aiCallId`.** A row do JEV só quando `reusedFromPredictionId` é nulo (chamada nova de sistema ou base do modelo); senão a do pai (item 12 acima).
8. **Teste de ponta a ponta.** `lib/lineup-recheck/__tests__/run.pglite.test.ts`: `runLineupRechecks` com o `predict` real contra pglite (persistência + PSO, predicado da linha do over/under contra capturas reais, pai em µs), 0 candidatos depois, e Anthropic, The Odds API, `ensureOddsSnapshotsFresh` e limite diário nunca chamados.
9. **Detalhes.** Notas da escalação cabem em `KEY_FACTOR_MAX_CHARS` (menos papéis citados e, no limite, corte com reticências) e sem artigo ("Escalação: <time> com …"). Rodapé da reconferência diz "texto automático" em vez do modelo narrador do pai. A reconferência não reordena "Suas predições recentes" nem as seções por mercado da página do jogo. O log `run_complete` traz todos os motivos de pulo zerados (`no_odds`, `superseded`…) e `uninformative`. Aviso do hero só no pré-jogo.
10. **Não feito: exclusão nos dois sentidos com o `compute-match-models`.** Pular o cron da base quando o lock da reconferência está tomado custaria uma base inteira (ele roda de 6 em 6 h), e esperar comeria o prazo dele (150 + 135 s de 300 s). Os horários já separam os dois: a reconferência de :25 não começa jogo depois de :27 (prazo de 120 s) e a base roda às :30; a de :35 já cede ao lock da base.
11. **Não feito: janela entre a guarda e o insert.** Entre o `hasNewerPreMatchPrediction` e o insert sobra uma janela de milissegundos sem advisory lock; uma análise interativa que caia nela deixa a reconferência como a mais recente do balde até a próxima análise. Aceito: raro, sem efeito em Yield/CLV/Kelly (a reconferência está fora deles) e corrigido pela próxima análise do usuário.
