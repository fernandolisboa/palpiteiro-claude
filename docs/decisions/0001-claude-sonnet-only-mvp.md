# ADR 0001 — Claude Sonnet 4.5 como único provedor de IA do MVP

## Status
Accepted (2026-05)

## Contexto

A ideia inicial considerava suporte a múltiplos provedores de IA (Anthropic, OpenAI, Google, xAI) com comparação side-by-side, BYOK (Bring Your Own Key), e plano pago oferecendo um pool interno de tokens.

## Decisão

Usar **apenas Claude Sonnet 4.5** durante o MVP (Fases 1+2). Adiar multi-provider e BYOK pra Fase 3+.

## Razão

1. **Foco**: validar a tese central (LLM + dados estruturados + comparação com odds gera Yield positivo) é prioritário sobre flexibilidade de modelo
2. **Custo cognitivo**: gerenciar 4 SDKs e 4 dialetos de prompt em paralelo atrasa o aprendizado real
3. **Structured outputs**: Anthropic tem suporte robusto via tool use; integração direta
4. **Aprendizado**: o objetivo paralelo é dominar o SDK Anthropic — múltiplos providers diluiriam isso
5. **BYOK overhead**: criptografia at-rest, key management, validação por provider — custo alto sem retorno na Fase 1+2 (que rodam na minha key mesmo)

## Alternativas consideradas

- **Multi-provider via abstração comum (Vercel AI SDK)**: viável e tentador, mas adiciona camada extra; rejeitada pra simplificar setup do MVP
- **Começar com modelo mais barato (Haiku)**: rejeitada porque qualidade do raciocínio importa mais que custo unitário nesta fase de validação. Haiku entra em consideração se for adicionar tier gratuito interno na Fase 3
- **GPT-4o ou Gemini 2.5 como provider único**: equivalente em capacidade, mas sem o motivo extra de aprendizado do SDK Anthropic

## Consequências

- (+) Setup mais rápido, foco no problema central
- (+) Aprendizado profundo de uma stack
- (−) Refatoração futura se decidir multi-provider (mitigado mantendo `lib/ai/predict.ts` como fronteira de abstração)
- (−) Não há comparação side-by-side de modelos no MVP

## Reavaliação

Quando atingir 30+ predições com dados, decidir se vale adicionar segundo provider pra A/B test de qualidade.
