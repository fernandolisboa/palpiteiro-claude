# Roadmap — Palpiteiro

## Fases

### Fase 1 — Uso pessoal (semanas 1-12)
Construir + validar com 30+ predições reais geradas e usadas por mim mesmo.

### Fase 2 — Família e amigos (semanas 13+)
Abrir pra 3-5 conhecidos via whitelist; observar uso real e refinar prompts com base em feedback.

### Fase 3 — Público (não planejado neste roadmap)
Condicionado a Yield positivo + revisão regulatória completa + decisão consciente de investir tempo/dinheiro.

## Pivot multi-mercado (épico #183)

O Palpiteiro deixa de ser tipster de over/under 2.5 e vira um **motor de seleção de edge multi-mercado**: domínio mercado-agnóstico, com over/under como o **primeiro registro** do registry (ADR 0015). Pivot por **expand-migrate-contract** (sem big-bang), com Yield histórico preservado. As fases abaixo correspondem às issues `pivot-fase-*`:

| Fase | Tema | Issues |
|---|---|---|
| 0 | ADRs + docs (esta) | #152–158 |
| 1 | Fundação de dados (`markets`/`market_selections`, `result_data`, backfill) | #159–162 |
| 2 | Math + plumbing plugável (implícita/edge N-vias, settlement por mercado, cartuchos) | #163–168 |
| 3 | UI multi-outcome + tracking por mercado (KPIs segmentados) | #169–172 |
| 4 | Mercados novos (Tier 1 completo + Tier 2: BTTS / dupla chance) | #173–176 |
| 5 | Refino + contract (spec-mãe multi-mercado, contrair enum `market`) | #177–182 |

**Saída:** domínio mercado-agnóstico, over/under é o 1º registro; mercados do MVP entram via migration sem ADR novo (Tier 3 e provider novo de IA continuam exigindo ADR).

## Tarefas (alto nível)

| # | Tarefa | Saída | Semanas |
|---|---|---|---|
| 1 | Discovery & especificação de IA | JSON schemas + spec do prompt v1 | 1 |
| 2 | Setup de infraestrutura | App rodando + auth básica em produção | 1 |
| 3 | Schema de tracking | Migrations + ER diagram | 2 |
| 4 | Integração com provedores | Clientes API-Football + Odds + cache | 2-3 |
| 5 | Camada de IA | `lib/ai/predict.ts` + prompt v1 + backtest | 3-4 |
| 6 | UI: lista + análise | Fluxo navegável end-to-end | 5 |
| 7 | UI: dashboard de tracking | KPIs + drill-down por predição | 6 |
| 8 | Settlement automático | Cron + override manual | 6 |
| 9 | Multi-user (Fase 2) | Magic link + whitelist + rate limit | 13 |
| 10 | Operações & custo | Admin de gastos + alertas | 13 |

Detalhes de skills, delegação humano/IA e entregáveis por tarefa: GitHub Issues (cada tarefa vira 1 ou mais issues com label `phase-1` ou `phase-2`).

## Marcos críticos

- **Semana 4**: prompt v1 testado em ≥ 20 jogos passados com resultado conhecido (backtest manual)
- **Semana 6**: loop fechado funcionando — predição gerada → resultado registrado → métrica atualizada
- **Semana 12**: ≥ 30 predições reais com Yield calculado — **decisão go/no-go pra Fase 2**
- **Semana 16**: Fase 2 ativa com ≥ 3 usuários

## Critérios de avanço

### Fase 1 → Fase 2

- ≥ 30 predições com resultado conhecido
- Yield ≥ +5% **OU** sinal qualitativo claro de utilidade ("eu confiaria nesse app pra apostar meu próprio dinheiro")
- Pass rate entre 30% e 60% (calibração saudável)
- Custo médio por análise dentro do orçamento (< R$ 0,50)

### Fase 2 → Fase 3

- Não automático; decisão consciente após análise regulatória
- Yield agregado positivo de Fase 2
- ≥ 3 usuários ativos com ≥ 30 dias de uso
- Disposição financeira pra investir em conformidade (advogado, processos SPA, etc.)

## Riscos e mitigações

| Risco | Probabilidade | Mitigação |
|---|---|---|
| LLM não bate baseline → produto sem valor | Alta | Tracking obsessivo desde dia 1; comparar com baseline trivial **por mercado** (over/under: always over/under; 1X2: prior do favorito; BTTS: always yes/no) — ADR 0015 D9 |
| Custo de tokens descontrolado | Média | Rate limit por usuário/dia; alerta de gasto; cache agressivo |
| API-Football com cobertura ruim do Brasileirão | Média | Validação manual nos primeiros 10 jogos; ter fallback identificado |
| Free tier de The Odds API insuficiente | Alta | Aceitar limite no MVP; consultar odds só quando usuário pede análise |
| Eu abandonar antes de 30 predições | Alta | Compromisso com 1 análise/dia mínimo; aceitar que abandono também é dado |
| Schema mal projetado dificulta análises depois | Média | Investir tempo na Tarefa 3; revisar 2x antes de codar UI |
