# PLAN-562: "Explicar com IA" na avaliação das apostas registradas

Issue #562 (follow-up do #556 / PR #559, ADR 0053 Alternativa 2). Depende da Fase 1 (base por jogo, ADR 0052, PR #563) e da Fase 3 (Seu palpite, ADR 0055, PR #570), as duas na `main`. Referências `arquivo:linha` valem para a `main` de 2026-10-21 (`7b81eb9`).

## 0. Sanity-check

Faz sentido e não é coberto pelo "Seu palpite": ele lê só resultado/placar e proíbe por regra falar de odd, edge, stake e EV (ADR 0055). A avaliação do registro (`evaluateSlip`) é a superfície de valor legítima (ADR 0034 §9) e cobre O/U, BTTS, dupla chance e combinada. Hoje ela mostra números secos; o botão narra o porquê desses números sem mudá-los.

## 1. Decisões

| Ponto | Decisão | Por quê |
|---|---|---|
| Fronteira de LLM | Seam `AIProvider` + `ai_calls` (cópia de `lib/ai/user-palpite/narrate.ts`), fora do `predict.ts`. | `predict.ts` é o motor da análise de mercado e grava `predictions`. ADR 0036 (bet-parse) e ADR 0055 §8 já aprovaram a segunda porta com a mesma disciplina: `getProviderForModel`, `ai_calls` com `promptVersion` e `servedModel`, Zod, nunca o SDK direto. A ADR 0063 registra a exceção. |
| Limite diário | 1 unidade do limite de palpites (`checkPalpitesRateLimit`, 50/dia), cobrada depois de todos os portões grátis. | Mesmo custo do `user_palpite_narrate_v1` (1 chamada, ≤ 2.000 tokens, effort low). A ADR 0036 Alt. 11 rejeitou cobrar o balde de análises (20/dia) por chamada barata. Desvio consciente do texto da issue ("limite de análises"). |
| Ao vivo | Só pré-jogo na v1. Registro ao vivo não oferece o botão; a action recusa slip `is_live`. | A avaliação ao vivo não tem edge, odd de referência nem stake (ADR 0060); só chance e EV, que a leitura em código já diz. Variante `bet_slip_explain_live_v1` fica como follow-up. |
| Kill switch | Coluna `ai_config.enable_bet_slip_explain` (default true) + entrada no registro de flags do `/admin/settings`. | Mesmo padrão do `enableUserContext`; flag própria porque custo e superfície são outros. |
| Superfície | Só no painel "Suas apostas", na avaliação recém-registrada. Não em `/apostas`. | `/apostas` não mostra avaliação nem conjunta da combinada sem marginais (invariante de coerência). |
| Persistência | Efêmera: o texto vive no retorno da action e em `ai_calls.output_payload`. | A avaliação também é efêmera (some no reload). Persistir pediria tabela, LGPD e UI sem quem leia. Reload perde o texto; pedir de novo custa outra unidade. |
| Números | Só das rows congeladas (`bet_slips`/`bet_legs`), por ids do próprio usuário. Nunca do cliente, nunca reavaliando. | A base muda a cada 6h; reavaliar faria o texto divergir do painel (mesmo princípio de `historyLegView`). |
| JEV | Frases de ajuste só quando o snapshot da base em vigor no registro reproduz as pernas `scoreline_model` gravadas (±0,011 pp). Senão, "sem dado de ajuste". Pernas da análise do usuário (`cartridge`) sem frases de JEV na v1. | Não atribuir ao JEV um número que não veio dele. |
| Casas | Nenhum nome de casa no prompt nem na UI; "odd de mercado" / "mercado sem a margem". | Regra de produto (#571/#572). |

## 2. Fluxo

1. `registerBetSlip` passa a devolver `slipIds` (já vinham de `insertBetSlipsBatch`) e `explainable` (pré-jogo, ≥ 1 perna avaliada, flag ligada; leitura da flag com `.catch(() => false)`, porque o insert já aconteceu).
2. Cliente manda só `slipIds` para `explainBetSlip`.
3. `explainBetSlip`: Zod (1..8 uuids únicos) → `auth` → acesso → flag → slips do usuário por id (todos precisam voltar) → mesmo jogo, combinada sozinha → nenhum ao vivo → ≥ 1 perna avaliada → jogo → snapshot da base no registro → builder puro → **cobra** `checkPalpitesRateLimit` → runner (nunca lança; falha vira template).

## 3. Arquivos

- Docs: este plano; ADR 0063; nota de status na 0053; linha de redação na 0046 (`prompt_version LIKE 'bet_slip_explain%'`).
- DB/flag: `db/schema.ts`, migration nova (IF NOT EXISTS), `getEnableBetSlipExplain` em `lib/db/queries/ai-config.ts`, entrada em `lib/config/admin-flags.ts` (+ testes de flags que fixam a lista).
- Queries: `getUserBetSlipsByIds(userId, ids)` em `lib/db/queries/user-bets.ts`; `getMatchModelSnapshotAsOf(matchId, at)` em `lib/db/queries/match-model-snapshots.ts`.
- Builder puro: `lib/bets/explain-input.ts` (`buildBetExplainInput`).
- View: `valueReadingKind` + `BetSlipExplanationView` em `lib/view/bet-slip.ts`.
- Cartucho (`prompt:`): `lib/ai/bet-slip-explain/{cartridge,schema,fidelity,fallback,explain}.ts`, versão `bet_slip_explain_v1`, tool `submit_bet_explanation`.
- Refactor: `resolveUserRunModelId` em `lib/ai/user-run-model.ts` (dois usuários: narração do palpite e explicação).
- Action: `app/actions/bet-slip-explain.ts`.
- UI: estado no `BetSlipProvider` (os dois `SlipPanel`, aside e sheet, compartilham), `components/bet-slip/slip-explain.tsx`, render em `slip-panel.tsx`.
- Copy: `/privacidade` (Anthropic recebe seleções, odds e stakes quando você pede a explicação), `/como-usar`.

## 4. Guardas do texto

- Fidelidade: percentuais, "pontos", odds (decimais 2-3 casas) e unidades só do conjunto permitido; cada perna avaliada exatamente uma vez; `leitura` igual à do código.
- Linguagem: sem imperativo de aposta ("aposte", "vá de", "recomendo"...), sem promessa ("garantido", "certeza"), sem nome de casa, sem "na casa", sem URL. Não reusar o guard do 0055 (proíbe toda linguagem de valor).
- Break-even é "a chance mínima pra sua odd se pagar", nunca probabilidade do mercado (gotcha do `1/odd`).

## 5. Landmines

1. `components/__tests__/bet-slip-guards.test.ts`: em `components/bet-slip/*.tsx` não pode `apostar` nem `cupom`; `<SlipRiskNotice />` fica no painel.
2. `components/__tests__/no-bookmaker-copy.test.ts` não varre `lib/ai/`: o cartucho precisa de teste próprio.
3. `lib/config/__tests__/admin-flags.test.ts` e `admin-flags.pglite.test.ts` fixam lista, contagem e defaults das flags.
4. Mocks existentes: `bet-slip.test.ts` mocka `ai-config` só com `getEnableLiveMode`; `bet-slip-provider.test.tsx` mocka só `registerBetSlip`.
5. Ordem das pernas: slips de um registro têm o mesmo `createdAt`; ordenar pela ordem de `slipIds` e mostrar cada texto sob o rótulo da sua perna.
6. `computeEvPerUnit`/`computeBreakEvenProbPct` lançam com odd ≤ 1.
7. `design-scale-guard`: `font-mono` sempre com `tabular-nums`; `text-meta` nunca com `text-muted-fg-2`.
8. CHECK de `ai_calls`: `userId` e `matchId` obrigatórios fora de prompt de sistema.

## 6. Follow-ups

- Variante ao vivo (`bet_slip_explain_live_v1`, a partir do `live_state` congelado).
- Persistência + explicação em `/apostas`.
- Frases de JEV para pernas da análise do usuário, com a origem dos fatores (`userContext`).
