# ADR 0071 — Prompt caching nas chamadas à API Claude

## Status

Accepted (2026-11-12). Pedido do Fernando depois do e-mail da Anthropic "Your Claude API prompt cache hit rate is low" (o aviso é da conta inteira, não só deste app). Issue #664.

## Contexto

Nenhuma chamada usava `cache_control`. Toda chamada paga passa por `buildAnthropicRequest` (lib/ai/providers/anthropic/request-builder.ts), que monta `tools` (uma tool fixa do cartucho) → `system` (constante do cartucho) → `messages` (uma mensagem de usuário com os dados do jogo). Essa já é a ordem que o cache por prefixo pede: o que é igual pra todo jogo e usuário vem primeiro, o que muda vem no fim.

Prefixo fixo (tool + system) estimado por cartucho, em tokens: narração ~830, palpite ~2.200, placar exato ~2.900, artilheiro/assistência ~1.750, mercados LLM ~1.400–2.100, explicar apostas ~850, extração/narração do "Seu palpite" ~900–1.300, interpretação de apostas ~1.050, notícias e cartões (web search) menores. Todos acima do mínimo cacheável de 512 tokens dos modelos 5.5. A sondagem de versão nova (ADR 0062) fica abaixo: o marcador é inerte lá (sem erro, sem escrita), e ela continua provando que o formato de produção é aceito.

Preço de cache: escrita (TTL 5 min) 1,25× o input; leitura 0,05× no Opus e no Sonnet 5.5 e 0,1× no Haiku 5.5. Uma chamada sem reuso paga +25% só no prefixo; uma com reuso paga 5% dele. Empata com ~21% de acerto.

Onde há reuso: o prefixo é o mesmo por cartucho e modelo, então duas chamadas do mesmo cartucho com menos de 5 min entre o início de uma e da outra leem o cache, de qualquer jogo ou usuário. Isso acontece ao analisar vários jogos em sequência (a lista de /jogos, #661), nos crons de cartões e notícias em série, nos backtests e na retomada de `pause_turn` da web search. Dentro de uma mesma análise os cartuchos são diferentes e correm em paralelo, então não compartilham cache entre si.

## Decisão

1. **Um breakpoint `cache_control: {type: "ephemeral"}` no último bloco do `system`**, nos dois ramos do builder (submit tool e web search). Cacheia tools + system juntos. A mensagem do usuário fica fora: ela muda a cada jogo, e escrevê-la no cache só pagaria o prêmio de escrita. Sem cache automático no topo pelo mesmo motivo.
2. **TTL de 5 min.** O de 1 h custa 2× na escrita e só compensa com reuso espaçado de 5 a 60 min e mais frequente do que o app tem hoje.
3. **Nada que varie por pedido no system ou na tool** (data, id, usuário, flag). Dado variável vai na mensagem do usuário. Isso zera o acerto em silêncio, sem erro.
4. **Contabilidade.** `AnalysisUsage.inputTokens` passa a ser o TOTAL do prompt (`input_tokens + cache_creation_input_tokens + cache_read_input_tokens`; na API `input_tokens` é só a parte sem cache), então os relatórios de tokens seguem medindo o tamanho do prompt e, sem cache, o número é o mesmo de antes. Dois campos novos guardam a escrita e a leitura. `calculateCost` cobra a parte escrita a 1,25×, a lida a `cacheReadMultiplier`× e o resto a preço cheio; sem os campos, cobra tudo cheio (nunca a menos). O multiplicador é fração, não preço, pra uma versão adotada (ADR 0062) herdá-lo da conferida.
5. **Auditoria.** `ai_calls` ganha `cache_creation_input_tokens` e `cache_read_input_tokens` (default 0, migration 0066), gravadas em todo insert. O detalhe do palpite no /dashboard mostra "N do cache" quando houve leitura. A resposta crua no `outputPayload` já trazia o `usage` completo.

## Consequências

- A economia em dólar é pequena no volume atual (um usuário, prefixos de 1–3 mil tokens, custo dominado pelo output e pelo thinking). O ganho maior é a taxa de acerto da conta e a latência um pouco menor nas chamadas que leem o cache.
- Uma análise isolada, sem outra do mesmo cartucho em 5 min, fica ~25% mais cara no prefixo (frações de centavo).
- Verificar com dado real: `cache_read_input_tokens > 0` em `ai_calls` depois de duas análises seguidas no mesmo modelo. Se ficar sempre 0, algo variável entrou no prefixo.
- Mudar `effort` ou modelo entre chamadas troca o prefixo (cache é por modelo e por configuração de thinking). O effort vem do `ai_config` e é estável por rota.
