# PLAN — #182 · Reformular /como-funciona para multi-mercado

**Branch/worktree:** `feat/182-como-funciona-multimercado` em `.claude/worktrees/182` (off origin/main 0ab16fb2, migration head 0028). Sem migration/DB.

## Decisões do dono (AskUserQuestion)
- **Profundidade:** over/under + 1X2 = "do zero" integral; BTTS + dupla chance = seção própria porém concisa.
- **Exemplos numéricos:** os 4 mercados (O/U preservado + 1X2 3-vias + BTTS N=2 + dupla chance par Σ=200%).
- **Cobertura:** sinalizar que BTTS + dupla chance hoje só em jogos de Copa do Mundo (coveredLeagues=['world_cup']); over/under + 1X2 = todas as ligas.

## Estrutura final da página (ordem)
1. **Intro** — reframe multi-mercado: motor de edge; 1 rec por análise (mercado+seleção+linha+stake) ou PASS; dinheiro hipotético.
2. **"O que é over/under 2.5 (do zero)"** [PRESERVADO] — seção de ajuda over/under; +id `mercado-over-under`.
3. **"Como o app decide: edge, confiança e PASS"** [PRESERVADO] — método universal + box O/U canônico (números pinados). **FIX**: `5pp` hardcode L122 → `{MIN_EDGE_PP}pp`. +linha staking 1–3u + "dentro do mercado que você escolhe, recomenda a seleção de maior vantagem ou PASS".
4. **"Os outros mercados"** [NOVO] — jump-links + sub-blocos:
   - **Resultado final: 1X2** (id `mercado-1x2`) — do zero + box 3-vias (casa 2.10/empate 3.40/fora 3.60 → 45,43/28,06/26,50 → modelo 52/27/21 → casa +6,57pp → recomenda; EV +9%).
   - **Ambas marcam (BTTS)** (id `mercado-btts`) — conciso + box N=2 (sim 1.80/não 2.00 → 52,63/47,37 → modelo 60% → +7,37pp → recomenda sim) + nota WC-only.
   - **Dupla chance** (id `mercado-dupla-chance`) — conciso + box par (1X 1.25/X2 2.00/12 1.30 → Σcruas 2.0692, alvo 200% → 77,32/48,33/74,35 → modelo 79/48/73 → edges +1,68/−0,33/−1,35 → PASS) + nota WC-only.
5. **"Como ler os números"** [PRESERVADO] — +nota yield/métricas por mercado.
6. **"Glossário"** [PRESERVADO] — enriquecer glossary.ts: markets keys p/ match_result/btts/double_chance nas entradas selecao/recomendacao/prob-implicita/overround/cenarios (aditivo; over_under intacto).
7. **"Jogo responsável"** [PRESERVADO].

## Invioláveis honrados
- ComoFuncionaContent SÍNCRONO/estático (renderToStaticMarkup). MIN_EDGE_PP de @/lib/odds/scenario (nunca hardcode). Linguagem leiga (ADR 0012). over_under preservado (didático + markets.over_under nas 5 âncoras pinadas). presentation.ts NÃO tocado (pureza intacta). ADR 0018: implícita normalizada governa edge / odd crua governa EV; cada seleção seu edge; dupla chance par Σ=200%.

## Commits (verde a cada passo: typecheck+lint+test, contrato em lockstep)
- C1: page.tsx metadata + intro reframe.
- C2: fix 5pp hardcode → {MIN_EDGE_PP}pp.
- C3: seção "Os outros mercados" (1X2/BTTS/DC + boxes + ids + jump-links + WC notes) + tweaks método/§5 + **como-funciona-page.test.tsx em lockstep** (novos headings, ids de mercado, números dos boxes, nota WC).
- C4: glossary.ts market-aware enrichment + glossary.test.ts (pin novos markets keys, espelho do over_under).

## Saída
1 PR squash --delete-branch. Code-review find→verify postado como PR comment. Sem deploy-gate destrutivo. Atualizar handoff + kickoff da próxima (#180/#181; #173 fechado). Épico #183 fecha só quando a cauda toda fechar.
