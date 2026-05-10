# PRD — Palpiteiro

## Problema

A maioria das pessoas que aposta em jogos de futebol (eu incluído) o faz "no feeling": sem dados estruturados, sem comparar com odds do mercado, sem registrar histórico. Resultado típico: prejuízo no longo prazo invisível, porque ninguém mede.

Tipsters do Telegram/YouTube se propõem a resolver isso, mas exigem confiança cega em terceiros com track record opaco.

## Solução

Web app (mobile-first) que:

- Lista jogos próximos das ligas configuradas
- Sob demanda, gera análise via LLM com base em dados estruturados (forma recente, H2H, classificação, lesões, escalação) + odds atuais
- Recomenda **somente** quando estima edge ≥ 5% sobre a probabilidade implícita das odds (forçando "passar a vez" frequentemente)
- Registra cada palpite com input/output completos pra validação posterior
- Mostra dashboard de Yield, win rate, pass rate e bankroll hipotético

**Diferencial**: transparência total. Você vê o input que a IA recebeu, o racional dela, e mede objetivamente se as recomendações estão acima da média do mercado.

## Usuário-alvo

### Fase 1 — Uso pessoal
Eu mesmo, validando se o approach funciona.

### Fase 2 — Família e amigos
~3 a 5 pessoas conhecidas, via whitelist de e-mails, sem cobrança.

### Fase 3 — Público
Fora do escopo deste PRD. Decisão futura, condicionada a Yield positivo nas Fases 1+2 e estudo regulatório (Lei 14.790/2023).

## Escopo do MVP (Fases 1+2)

### Incluído

- Auth via magic link (whitelist controlada manualmente)
- Lista de jogos próximos (próximas 48h) das ligas configuradas
- 1 mercado: **over/under 2.5 gols**
- 2 ligas: **Brasileirão Série A + UEFA Champions League**
- Botão "analisar" → recomendação estruturada com racional
- Dashboard de tracking (Yield, win rate, pass rate, bankroll, drill-down por predição)
- Resolução automática de resultados após o jogo
- Audit log completo de chamadas de IA (input, output, tokens, custo, latência)

### Fora do escopo

- App mobile nativo (web responsivo basta)
- Múltiplos provedores de IA / BYOK
- Mercados além de over/under (1x2, BTTS, escanteios, handicap)
- Stake variável (Kelly criterion etc)
- Notificações push proativas
- Plano pago / monetização
- Conformidade regulatória completa

## Métricas de sucesso

### Primária
**Yield** (lucro hipotético / volume apostado) calculado sobre ≥ 30 predições.

### Saúde
- **Pass rate** entre 30% e 60% (IA deve recusar análises sem edge claro)
- **Win rate** consistente com a confiança declarada (calibração)
- Custo médio por análise < R$ 0,50

### Aprendizado
- Fluência prática com SDK Anthropic, structured outputs e prompt engineering iterativo
- Decisão informada (com dados reais) sobre Fase 3 ou pivô

## Premissas

- Apostas reais são feitas em outras plataformas (`.bet.br` autorizadas), não dentro do app
- Usuários são adultos cientes do risco
- A IA pode (e deve) passar a vez frequentemente (`recommendation: "pass"`)

## Riscos principais

- LLM não bate baseline do mercado → app vira entretenimento sem valor real
- Custo de tokens descontrolado na Fase 2
- Dados de provedores externos com cobertura insuficiente pro Brasileirão

Mitigações detalhadas em `docs/ROADMAP.md`.
