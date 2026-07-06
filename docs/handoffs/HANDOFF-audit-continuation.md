# HANDOFF — Continuação autônoma pós-arcos aposta-livre + IA-científica

> Snapshot de um ponto no tempo (2026-07-06), NÃO spec viva. Escrito pra a próxima
> sessão rodar **sem depender do dono**. Aterrado no código/issues em `main @ ab5ae784`.
> Contexto de fundo na memória `strategic-audit-execution-2026-07` e nos `docs/reports/`.

## O que já foi entregue (merged + prod)

Dois arcos grandes do audit estratégico (`docs/reports/` 00-09), fechados:

- **Item 4 — Aposta livre (Report 04, ADR 0036), COMPLETO:** Fases 1/2/3 (#471/#472/#473,
  PRs #474/#478/#480). Input NL→chips→grade roteado (cartucho com edge / modelo de placar
  sem edge), combinada same-game via joint-sum, histórico `/apostas`, settlement próprio.
  `lib/quant/scoreline-model.ts` (double-Poisson+DC) + `lib/bets/`.
- **Item 3 — IA-científica (Report 03), Fases A+B COMPLETAS:**
  - **ADR 0037** (#450/PR #481) — camada estatística Poisson como insumo do LLM.
  - **Tracer** (#482/PR #483) — `predict.ts` injeta P(over) Poisson por linha no over/under
    (`descriptor.minEdgePp`, adapter promovido pra `lib/providers/sports-data/match-lambdas.ts`).
  - **Harness de calibração** (#484/PR #485) — `lib/calibration/` (Brier/log-loss/reliability)
    + `/admin/calibration`. Mede o modelo vs mercado no-vig, sem migration.
  - **CLV flip** (#486/PR #487) — `enableClvCapture=true` em prod (migration de dados 0042).
  - **Gate de edge determinístico** (ADR 0038, #489/PR #488) — `predict.ts` rebaixa rec com
    edge persistido < piso do mercado pra pass genuíno (`isBelowEdgeFloor` em `lib/ai/staking.ts`).

Leia primeiro: `docs/reports/03-ia-cientifica.md` + `docs/decisions/0037-*.md`/`0038-*.md`
(pra saber o que já foi decidido e o vocabulário), depois esta seção de "o que fazer".

## O que está BLOQUEADO — NÃO comece isto

- **Report 03 Fase C** (Dixon-Coles MLE rec.6 + Kelly fracionário rec.7) — **gated em DADO,
  não em trabalho.** O critério de saída (ADR 0019) exige a calibração provar `reliability
  slope ∈ [0.8, 1.2]` + `Brier ≤ no-vig` sobre **≥150 apostas resolvidas**. Esse dado não
  existe ainda — precisa de semanas de jogos liquidados via o harness/CLV recém-ligados.
  Cheque `/admin/calibration` no início: se ainda não há ~150 liquidadas com skill estável,
  **a Fase C NÃO pode começar**. (Este é o único trabalho "óbvio" do arco, e está travado.)
- **Ações que exigem o DONO** (Report 09 §3 — NÃO faça sozinho): decisão de monetização,
  razão social/MEI, ADR de LGPD-deletion (anonymize-vs-cascade), fornecer links sociais
  (#455 depende disso), busca INPI. **NÃO flipar `enable_best_bet_fan_out`** até o fix de
  rate-limit do fan-out (Report 01 #3) — ver abaixo.
- **#431/#432/#433** (legal: termos/privacidade/footer/consent) — já ENTREGUES pelo #461;
  ficam abertas só porque o guard de permissão bloqueou o fechamento. **O dono fecha.** Não
  re-implemente nem feche.

## O que FAZER — menu autônomo, priorizado (nenhum depende do dono)

Todos abaixo são acionáveis sem input do dono. Recomendo nesta ordem (valor × baixo risco):

1. **Report 01 #3 — fix de rate-limit do fan-out cross-mercado** (não tem issue ainda; criar).
   ALTO valor: destrava o `enable_best_bet_fan_out` (hoje OFF por causa deste risco). O
   fan-out (`lib/ai/best-bet.ts` `runFanOut`) roda N `predict()` por jogo; cada MISS gasta
   rate-limit/quota. Investigar o custo pior-caso e pôr um teto seguro (por-jogo ou por-run),
   espelhando a disciplina de `checkAnalysisRateLimit`. Aterrar no Report 01 achado #3 antes.
2. **#438 — re-auditar segurança de `/p/[id]` contra ADR 0035** (discovery/security). Autônomo:
   verificar que o compartilhamento público é manchete-only, firewall-bound, sem vazar
   edge/EV/odd/rawInput; `middleware.ts` libera só o segmento certo. Vira issues de fix se achar.
3. **#442 — OG image dinâmica da landing** (`app/opengraph-image.tsx`, seo/ui). Só código
   (ImageResponse do Next), sem asset externo. Cuidar do CSP/edge-runtime.
4. **#449 — documentar a família de tokens `palpite-*` no DESIGN.md** (docs). Trivial, zero risco.
5. **#445 — dívida de copy pivot-consistente** (docs/ui). Varredura de copy inconsistente
   com o pivot palpite-first (ADR 0030). Baixo risco.
6. **Follow-ups leves da Fase B** (ADR 0038 "não-escopo"): o prompt do over_under hardcoda
   `"5"` em vez de importar `MIN_EDGE_PP` (`lib/ai/markets/over_under/prompt.ts:9`) — unificar
   a fonte (pinado hoje só por teste `toContain`). Opcional: flag explícito de "downgraded"
   na row (exige migration — só se valer).

**#440** (ícones/manifest) e **#446** (empty-state polish) são visuais — o dono prefere que
polish visual venha por último com `/impeccable` (memória `separate-functional-from-visual-polish`).
Deixe pro fim ou pule.

## Como trabalhar (flow inegociável)

Siga o flow do `CLAUDE.md`: **subagent de contexto fresco por passo** (exploração → plano/ADR →
review adversarial → rework → implementação → code review → correções), **worktree isolado**,
**triad (`pnpm lint`+`typecheck`+`test --no-file-parallelism`) + `pnpm build` local** antes do
push, PR, e mergear quando verde (CI + Vercel preview). Fechar a issue no merge (PT-BR "Fecha
#N" NÃO auto-fecha — fechar à mão; memória `github-fecha-not-autoclose`).

- **Se for ADR novo:** `to-issues`/`gh issue create` PRIMEIRO, depois o ADR — a PR grabou o
  número que eu tinha reservado pra issue (#488↔#489 nesta sessão). **Cria a issue antes.**
- **ADRs relevantes:** plan-gate adversarial de contexto fresco antes de finalizar (pegou 2
  blockers + should-fix no 0037 e no 0038). O próximo nº de ADR é **0039**.
- **Entrega autônoma:** levar a MERGED sem esperar autorização de merge (memória
  `autonomous-multiagent-delivery-flow`); fix de ressalvas de valor no code review antes de mergear.

## Landmines que carregam

- **`lib/quant` é PURO** — zero imports de provider/DB/ai (ADR 0036 Decisão 9). Adapter de
  fronteira (standings→λ) vive em `lib/providers/sports-data/match-lambdas.ts`.
- **Firewall da manchete intacto** (ADRs 0030/0031): número de valor (edge/EV/Poisson) viaja
  como DADO pra síntese, NUNCA na manchete; zero novos callers de `containsValueLanguage`. A
  barreira real é a FORMA do schema de síntese (qualitativo), não o guard de linguagem.
- **Gate de edge (ADR 0038):** um pass REBAIXADO grava rationale NEUTRO (não a prosa pró-lado
  do LLM); o cru fica em `ai_calls.outputPayload`. Não reverta isso.
- **drizzle numeric → string:** `Number()` na fronteira de view antes de qualquer math.
- **The Odds API free tier = 500 créditos/mês** — cache/batching obrigatórios; o fan-out
  (item 1) é justamente o risco de estouro.

## Gotchas de ambiente

- Worktree: `git worktree add -b <branch> ../palpiteiro-<x> main` + `cp
  ../palpiteiro-claude/.env.local .env.local` + `pnpm install --ignore-workspace`.
- `gh pr merge --delete-branch` FALHA em deletar a branch LOCAL de dentro do worktree — depois
  do merge, `git worktree remove ../palpiteiro-<x> --force` + `git branch -D <branch>`
  (memória `gh-pr-merge-delete-branch-worktree`).
- Suíte cheia flaka pglite em 8-core: `pnpm test --no-file-parallelism`.
- Migration de DADOS hand-authored (se precisar): `.sql` (UPDATE, modelo 0032) +
  `NNNN_snapshot.json` (cópia do anterior com `id`=uuid novo + `prevId`=id do anterior) +
  entry no `_journal.json` (`{idx,version:"7",when:<epoch_ms>,tag,breakpoints:true}`);
  `db:generate` NÃO gera (sem schema diff). Ver `0042_enable_clv_capture.sql`.

## Critério de saída da sessão

Pegar 1-2 itens do menu autônomo e levar a MERGED+verde. NÃO tocar no bloqueado. Se
`/admin/calibration` mostrar ≥150 liquidadas com skill estável, aí sim propor a Fase C
(ADR 0039 pra DC-MLE). Atualizar a memória `strategic-audit-execution-2026-07` no fim.
