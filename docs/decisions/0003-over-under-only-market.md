# ADR 0003 — Over/Under 2.5 gols como único mercado do MVP

## Status
Accepted (2026-05)

## Contexto

Existem dezenas de mercados em apostas esportivas: 1x2 (resultado), over/under (gols), ambas marcam (BTTS), handicap asiático, escanteios, cartões, escanteios por tempo, dupla chance etc. Cada um tem dinâmica estatística e padrão de ineficiência diferentes.

Tentar suportar muitos mercados desde o MVP explodiria complexidade de prompt, schema e UI.

## Decisão

MVP suporta **apenas over/under 2.5 gols**.

## Razão

1. **Modelagem com fundamentação**: literatura clássica (Dixon-Coles 1997, Poisson bivariado) modela bem distribuição de gols; LLM tem chão sólido pra raciocinar quantitativamente
2. **Liquidez**: over/under tem mercado profundo, odds estáveis, baixa variância entre bookmakers
3. **Ineficiências documentadas**: estudos mostram que mercados de over/under apresentam desvios mais frequentes vs mercados de resultado direto
4. **Settlement trivial**: somar gols é determinístico; ambiguidade zero
5. **Prompt simplificado**: foco em estimar 1 número (probabilidade de over) reduz superfície de erro
6. **Foco**: expandir mercados antes de validar 1 = construir em cima de fundação não testada

## Alternativas consideradas

- **1x2 (resultado)**: mais popular mas mais difícil de prever; menos edge típico; settlement com empate adiciona caso edge
- **Ambas marcam (BTTS)**: candidato razoável, matematicamente parecido com over/under; preterido por menor profundidade de mercado em ligas BR
- **Múltiplos mercados desde o MVP**: explode complexidade de prompt, schema e validação; rejeitada
- **Over/under com linha alternativa (1.5, 3.5)**: reduzido a 2.5 fixo pra simplicidade. Adicionar linhas alternativas é evolução natural pós-MVP

## Consequências

- (+) Foco profundo num problema bem definido
- (+) Schema, prompts e UI mais simples
- (+) Validação de tese central acontece mais rápido
- (−) Usuários que querem outros mercados ficam de fora (aceitável na Fase 1+2)
- (−) Comparação com tipsters multi-mercado é injusta (não é nosso problema agora)

## Próximos

Após validação, próximos mercados em ordem provável:
1. Over/Under com linhas alternativas (1.5, 3.5)
2. BTTS
3. 1x2 (com cuidado especial em calibração)
