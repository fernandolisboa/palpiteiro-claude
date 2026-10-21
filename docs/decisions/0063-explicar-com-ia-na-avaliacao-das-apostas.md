# ADR 0063 — "Explicar com IA" na avaliação das apostas registradas

## Status

Accepted (2026-10-21). Issue #562. Implementa a **Alternativa 2 do [ADR 0053](./0053-registrar-apostas-avaliacao-em-codigo.md)** (explicação sob demanda) depois da Fase 1 (base por jogo, [ADR 0052](./0052-base-do-modelo-por-jogo.md)) e da Fase 3 ("Seu palpite", [ADR 0055](./0055-contexto-do-usuario-como-afirmacoes-a-conferir.md)). Emenda o [ADR 0046](./0046-exclusao-de-conta-lgpd-tombstone-e-anonimizacao.md) (redação dos payloads na exclusão de conta). Plano: `docs/plans/PLAN-562.md`.

## Contexto

A avaliação do registro (`evaluateSlip`) é só código: chance do modelo, odd justa, retorno esperado na odd do usuário, edge contra o mercado completo sem a margem, stake das bandas e quarter-Kelly informativo. Ela mostra os números, mas não o porquê. O "Seu palpite" já tem uma narração com IA, só que é uma leitura de probabilidade que por regra não fala de odd, edge nem stake (ADR 0055 §10); a avaliação do registro é a superfície onde valor é legítimo (ADR 0034 §9).

## Decisão

1. **Botão "Explicar com IA" no painel "Suas apostas"**, sob a avaliação recém-registrada. Só aparece quando o registro foi pré-jogo, tem pelo menos uma perna com número e a flag está ligada (`registerBetSlip` devolve `slipIds` + `explainable`).
2. **Os números vêm das rows congeladas, nunca do cliente nem de uma reavaliação.** O cliente manda só os ids dos slips; a action lê `bet_slips`/`bet_legs` filtrando pelo usuário da sessão (id de outro usuário não volta) e re-deriva EV, break-even e edge dos números gravados, como o `/apostas` faz. Reavaliar com a base atual faria o texto divergir do painel (a base muda a cada 6h).
3. **Proveniência gravada: `bet_slips.model_snapshot_id`** (nullable, FK `on delete set null`). O registro pré-jogo grava a row de `match_model_snapshots` que avaliou as pernas do modelo de placar (`ModelScoreline.baseSnapshotId`); sem base fresca (cálculo na hora) e ao vivo fica null. Os ajustes do JEV citados na explicação saem dessa row: o texto só atribui ao JEV o que de fato moveu o λ daquele número. Sem base, a explicação diz que o modelo foi calculado na hora, sem JEV. Pernas que vieram da análise do usuário não ganham frases de JEV na v1 (o contexto extra do ADR 0055 pode ter movido os fatores).
4. **O LLM só explica.** Cartucho `bet_slip_explain_v1` (`lib/ai/bet-slip-explain/`), ferramenta `submit_bet_explanation` com `{resumo, pernas[{indice, texto}], combinada}`. O veredito de cada perna (com valor, no limite, sem valor, sem odd) é do código e o painel já o mostra; o LLM não o ecoa. Guardas nos campos escritos pelo LLM: Zod estrito; uma explicação por perna avaliada; percentuais (±1 pp), pontos de edge, odds/linhas soltas e unidades só do bloco "Avaliação"; texto da perna não contradiz o veredito; sem imperativo de aposta, promessa, nome de casa ou link. Não reusa o guard do ADR 0055, que proíbe toda linguagem de valor. Qualquer falha vira **template** em código.
5. **Segunda porta de LLM, fora do `predict.ts`**, como `bet-parse` (ADR 0036) e o "Seu palpite" (ADR 0055 §8): seam `AIProvider`, log em `ai_calls` com `promptVersion` e o modelo que serviu (ADR 0062), modelo de análise do usuário (`resolveUserRunModelId`), até 2.000 tokens, `effort: "low"`. O `predict.ts` é o motor da análise de mercado e grava `predictions`; esta chamada não produz predição.
6. **Custo: 1 unidade do limite diário de palpites** (`checkPalpitesRateLimit`, fail-closed pra não-admin), cobrada depois de todos os portões grátis. Depois da cobrança o pedido não falha. Mesmo custo e mesma regra da narração do "Seu palpite".
7. **Efêmera.** Nada é gravado além da row de `ai_calls`: a explicação vive no retorno da action, como a avaliação. Recarregar perde o texto; pedir de novo custa outra unidade.
8. **Só pré-jogo.** Registro ao vivo (ADR 0060) não oferece o botão e a action recusa slip `is_live`: ao vivo a avaliação não tem edge, odd de referência nem stake, e o modelo em jogo não tem backtest.
9. **Kill-switch `ai_config.enable_bet_slip_explain`** (default ON, no `/admin/settings`). Desligado, o painel mostra só a avaliação em código.
10. **Sem casa de apostas** no prompt, na mensagem e no texto ("odd de mercado", "mercado sem a margem"), regra de produto #571/#572. A Decisão 7 do ADR 0053 ("nome de casa só como fonte da odd de referência") não vale aqui.

## Emenda ao ADR 0046

A redação de `ai_calls` na exclusão de conta passa a incluir `prompt_version LIKE 'bet_slip_explain%'`: o payload leva as seleções, odds e stakes do usuário.

## Alternativas rejeitadas

1. **Cobrar do limite de análises (20/dia)**, como o texto da issue sugeria. Rejeitada pelo mesmo motivo do ADR 0036 Alt. 11: uma chamada curta no balde da análise completa é mal dimensionada. O balde de palpites já cobre a narração equivalente do "Seu palpite".
2. **Passar pelo `predict.ts`**, como o texto da issue sugeria. Rejeitada: o `predict` grava `predictions` e roda o fan-out de mercados; a disciplina que importa (seam, `ai_calls`, Zod, guardas, template) é a mesma da segunda porta já aprovada.
3. **Reconstruir a base usada no registro** pela row em vigor no `created_at` e conferir se reproduz as chances gravadas. Rejeitada: mais código e só aproximada (o `checked_at` é sobrescrito pelo heartbeat); gravar o id é exato e serve ao `/apostas` no futuro.
4. **Persistir a explicação** e mostrá-la em `/apostas`. Adiada: pede tabela, LGPD e UI; o `/apostas` também não mostra a avaliação completa (invariante de coerência da combinada).
5. **Variante ao vivo** (`bet_slip_explain_live_v1`, a partir do `live_state` congelado). Adiada.

## Consequências

- Uma coluna nova em `bet_slips` e uma flag em `ai_config` (migration 0061, IF NOT EXISTS).
- Registros anteriores a esta ADR têm `model_snapshot_id` null; como o botão só aparece no registro recém-feito, isso não afeta a explicação.
- O `/privacidade` diz que a Anthropic recebe as seleções, odds e stakes quando o usuário pede a explicação.
