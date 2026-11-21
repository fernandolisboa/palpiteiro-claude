# ADR 0072 — "Chances do azarão": advogado da zebra com revisor adversarial

## Status

Accepted (2026-11-21). Issue #671 (PR B de 3: A = #670, C = #672). Proposta aprovada pelo Fernando: "Chances do azarão, e notícias que chegam de verdade" (seção 1, "O botão"). Plano: `docs/plans/PLAN-671.md` (a seção "Ajustes pós-review" prevalece). Emenda o [ADR 0070](./0070-tom-de-mesa-de-amigos.md) §7 e o runbook do [ADR 0046](./0046-exclusao-de-conta-lgpd-tombstone-e-anonimizacao.md).

## Contexto

O palpite da IA mostra o resultado mais provável. A graça de futebol entre amigos também está no improvável: "e se der zebra?". Quase tudo o que mostra como a zebra acontece já existe em código: a base do modelo por jogo (ADR 0052, `match_model_snapshots`), o modelo em jogo (ADR 0060, `lib/quant/in-play.ts`) e os fatores do JEV (ADR 0041). Falta contar a história. Um texto que defende o resultado improvável é justamente onde a IA mais tende a exagerar, então ele precisa de conferência de verdade, além das regras fixas.

## Decisão

1. **Botão "Chances do azarão" abaixo do palpite**, fora do `section[aria-label="palpite"]` (firewall da ADR 0030: o `%` não entra no HERO) e depois de "Ler análise completa". O teaser fechado mostra o lado e a chance, grátis, lidos da base.
2. **Quem é o azarão (porta de 8 pp).** Na matriz refeita da base atual (`scorelineMatrix(λ, ρ)` pós-JEV, o mesmo número da tabela de Mercados), o azarão é o lado com menor chance de vitória quando a diferença entre as vitórias dos dois lados é de pelo menos 8 pontos. O empate não entra na regra. A base precisa valer (versão, `checked_at` até 24h, antes do apito). O teaser só aparece antes do apito, com palpite da IA na tela, sem run em andamento e quando o placar provável do palpite não dá a vitória ao lado que a base chama de azarão (porta de coerência, até o #668 decidir o palpite em código). Uma função pura só (`lib/underdog/gate.ts`) serve à página e à action.
3. **Números em código, nunca no LLM** (`lib/underdog/`, versão `underdog_calc_v1`): chances, os 3 placares de vitória do azarão mais prováveis e três cenários. A: o azarão vencendo por 1 × 0 aos 30' (`inPlayScoreline`). B: o favorito com um a menos desde os 60', em forma fechada (`λ·((1−r60)+r60·RED_OWN|RED_OPP)`, que um teste confere contra a mistura pelo modelo em jogo). C: o favorito desfalcado e com rodízio no máximo que o modelo aplica (`applyJudgments` sobre o λ base com `attack_weakened`, `defense_weakened` e `rotation_risk` do favorito em 1). Cenário que muda menos de 1 ponto sai. Sinais a favor (confronto direto, forma, lista de desfalques e fatores do JEV da base) também são código, cada um com a origem ("dados" ou "modelo").
4. **Advogado da zebra** (`underdog_advocate_v1`): modelo de análise do usuário (`resolveUserRunModelId`), até 1.500 tokens, `effort: "low"`. Escreve de 3 a 6 frases, e cada frase cita de 1 a 3 ids do bloco de fatos (`P#`, `S#`, `C#`, `F#`, `M#`). Guardas por frase, em código: ids existentes, percentuais, placares e minutos só do bloco, e as guardas de linguagem compartilhadas (`lib/ai/language-guards.ts`: imperativo, promessa, casa de apostas, link, "aposta"), mais linguagem de valor (ADR 0030 §3) e "bet". Frase reprovada é cortada, não derruba o texto.
5. **Revisor adversarial** (`underdog_review_v1`): Haiku (`UTILITY_MODEL_ID`, `UTILITY_EFFORT`), em contexto limpo. Recebe só o bloco de fatos e o rascunho numerado, nada do system do advogado. Dá um veredito por frase (`apoiada`, `exagerada`, `sem_base`) e escreve um contraponto de 1 a 2 frases. **O código corta só `sem_base`** (objetivo: número, fato ou causa fora do bloco); "na dúvida, o mais severo" vale só entre `apoiada` e `exagerada`, e as exageradas ficam para o contraponto rebater. Menos de 2 frases `apoiada`, ou menos da metade do rascunho sobrevivendo, vira **texto padrão** em código. Contraponto reprovado nas guardas, ou que repete 6+ palavras seguidas de uma frase cortada, vira contraponto padrão. Revisor que falha também vira texto padrão: texto sem revisão não vai à tela.
6. **Segunda porta de LLM, fora do `predict.ts`**, como ADR 0036, 0055 §8 e 0063 §5: seam `AIProvider`, uma row em `ai_calls` por chamada com o `promptVersion` de cada uma, custo com os tokens de cache e o modelo que serviu (ADR 0062). O `predict.ts` grava `predictions`; este texto não é predição.
7. **Prompt caching** (ADR 0071): os dois system prompts e as duas ferramentas são constantes; times, liga, data e fatos vão na mensagem do usuário. Os prompts são curtos e podem não chegar ao mínimo cacheável; não prometemos economia.
8. **Custo: 1 unidade do limite diário de palpites** (`checkPalpitesRateLimit`, fail-closed para não-admin), cobrada depois de todos os portões grátis, inclusive o cálculo dos números. Depois da cobrança o pedido não falha. A mensagem de limite passa a ser uma constante só para todas as ações desse balde.
9. **Persistência por (usuário, base)** em `underdog_views` (migration 0067): os números do painel congelados (`facts`), o texto revisado (`narrative`), as versões e as duas rows de `ai_calls`. Reabrir não cobra. A row guardada vale como atual enquanto o lado é o mesmo e azarão, empate e favorito mudam menos de 2 pontos (materialidade, porque a base ganha row nova pelo menos uma vez por dia com o refit do Dixon-Coles); a action aplica o mesmo teste antes de cobrar. Mudança material → o texto antigo aparece com "O modelo foi recalculado desde este texto" e o botão "Atualizar". Se a base atual não passa mais na porta, o texto pago continua na tela até o apito, com "O modelo mudou desde este texto" e sem botão. Grava o template determinístico (guardas ou Zod do advogado, revisor com menos de 2 frases apoiadas); não grava falha de infraestrutura nem qualquer falha do revisor, e o usuário pode tentar de novo. `UNIQUE (user_id, model_snapshot_id)` só deduplica a corrida de dois cliques.
10. **Só pré-jogo.** Ao vivo o azarão muda com o placar e a base deixa de servir como chave. Fica para depois.
11. **Kill-switch `ai_config.enable_underdog_view`** (default ON), no `/admin/ia`. Desligado, nada aparece (nem o texto guardado) e a action recusa.
12. **Sem casa de apostas, sem "bet", sem mandar apostar** no prompt, no texto e na tela. Tom de mesa de amigos (ADR 0070): "zebra" e "azarão" podem. Sem odd, odd justa, stake ou cor de edge no painel, e nenhum aviso de risco extra (um aviso por tela, ADR 0057).
13. **O estado do JEV não é guardado no snapshot**, só as respostas. Os sinais do JEV leem `judgments.answers` (≥ 0,7) e dizem que o fator já está na chance.
14. **Notícias ficam fora da v1.** Entram como fator conferido com o PR C (#672).

## Emenda ao ADR 0070 §7

A etiqueta **azarão** do /jogos continua "o lado com menos de 20% de vitória na base fresca" (`lib/view/match-tags.ts`). O botão "Chances do azarão" usa outra regra, mais larga: o lado menos provável quando a diferença entre as vitórias é de pelo menos 8 pontos (Decisão 2). As duas convivem; o líder do campeonato pode ser o azarão do botão sem ganhar a etiqueta.

## Emenda ao ADR 0046

`underdog_views` guarda comportamento do titular (que jogo abriu e quando). O runbook manual ganha `DELETE FROM underdog_views WHERE user_id = :uid;`. Os payloads em `ai_calls` só têm dados do jogo, então a redação da Decisão 1 não muda.

## Alternativas rejeitadas

1. **Passar pelo `predict.ts`**: gravaria uma predição falsa (mesmo motivo da ADR 0063 Alt. 2).
2. **Texto compartilhado por (base, família) entre usuários**: mais barato, mas o dono decidiu por usuário, e a cobrança por uso viraria cobrança sem chamada. Follow-up.
3. **Código grátis ao expandir e cobrança só no texto da IA**: dois cliques e mais estado.
4. **Cenário B condicionado em 0 × 0 aos 60'**: mistura o efeito do placar com o da expulsão.
5. **"Poupa titulares" como −15% no λ do favorito**: o piso de 0,85 é do produto de todos os fatores, não de um só; o cenário C usa o código real do JEV.
6. **Cortar também `exagerada`**: subjetivo demais para um Haiku em `low`; o contraponto responde.
7. **Notícia como sinal em código**: o código não sabe dizer se a matéria favorece o azarão (é o PR C).

## Consequências

- Tabela nova `underdog_views` e uma flag em `ai_config` (migration 0067, IF NOT EXISTS).
- Duas chamadas de LLM por uso novo (advogado + Haiku), na faixa de US$ 0,006 com Sonnet; reabrir é grátis.
- Form, confronto direto e desfalques vêm do provider com cache (o mesmo da aba Dados); nunca a The Odds API nem a busca na web.
- A linha "Atualizar" aparece só depois de mudança material da base, não a cada refit.
