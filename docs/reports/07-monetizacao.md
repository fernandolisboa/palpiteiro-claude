# Report 07 — Monetização

> Estratégia de monetização (2026-07-04), aterrada em PRODUCT.md/PRD/ROADMAP e na restrição
> legal dura de [`docs/ops/05-legal-compliance.md`](../ops/05-legal-compliance.md). Pareia com
> o benchmark do concorrente no [Report 08](./08-concorrente-palpiteirofc-e-marca.md).

## Veredito geral

**Zero infra de billing hoje** (sem SDK de pagamento, sem conceito de plano/tier no schema;
monetização explicitamente fora do MVP no PRD) — **mas o app já tem a primitiva mais difícil de
um freemium**: um **teto diário por usuário, env-tunável, aplicado ANTES de qualquer gasto**
(Upstash rate-limit) + custo por-call em `ai_calls.costUsd` com unit economics medida
(~$0.017/análise Sonnet, ~$0.006 Haiku, ~$4.7/mês de burn total sob teste pesado).

**O bloqueador real não é técnico:** o cadastro já está aberto, mas a base legal que a própria
ops-doc exige antes de monetizar — `/termos`, `/privacidade`, footer 18+/jogo-responsável — está
**não shipada** (ver [Report 05](./05-legal-lgpd-e-config.md)), e a doc é explícita: **monetizar ou
abrir ao público exige advogado.**

**Takeaway nº 1 — sequencie dinheiro DEPOIS de confiança:** ship a base legal R$0 + instrumentação
de retenção **agora**, aceite **doações** como a única receita pré-advogado, depois (pós-advogado,
pós-gate Fase-3) converta o **seam de quota que já existe** num soft paywall de volume de análise.
Trate **links de afiliado de casa de aposta como um NÃO duro** até uma decisão deliberada com
advogado — eles mudam a categoria legal do app de "ferramenta de análise" pra publicidade de
apostas (CONAR Anexo X / Lei 14.790) e destroem a defesa de não-operador que mantém a carga de
compliance perto de zero hoje.

**Upside realista na escala pequena = cobrir custo, não renda:** ~R$150–600/mês a 500–1000 MAU com
2–4% de conversão. O que é ótimo pra um side project cujos objetivos declarados são confiança e aprendizado.

## Achados

| # | Prioridade | Achado |
|---|---|---|
| 1 | **crítica** | Base legal exigida antes de QUALQUER monetização está não-shipada — enquanto o cadastro já está aberto (ver Report 05) |
| 2 | **alta** | Zero infra de billing: sem SDK de pagamento, sem plano/tier, controlador é pessoa física (constrange escolha de provider; cobrar implica MEI/PJ) |
| 3 | **alta** | A primitiva de metering do freemium **já existe**: teto diário por usuário antes do gasto, env-tunável (`role`→`plan` é mudança pequena) |
| 4 | **alta** | Unit economics medida e favorável; o **primeiro custo de escala é a quota da The Odds API** (500 req/mês free), não o LLM |
| 5 | média | Link de afiliado de casa é penhasco regulatório **e** contradição de marca — hoje (corretamente) ausente |
| 6 | média | Existe loop de crescimento público (share `/p` + landing) mas **zero instrumentação de funil/retenção** pra precificar/gatear |
| 7 | baixa | API-access e white-label/B2B são greenfield e onerados por termos dos providers upstream |
| 8 | baixa | Monetização é deferida pelos próprios phase-gates do projeto — e esse sequenciamento é sólido |

## Caminhos de monetização (cada um com exposição regulatória explícita)

| Caminho | Modelo | Exposição regulatória | Fit de marca | Esforço | Upside (escala pequena) |
|---|---|---|---|---|---|
| **Doações** (Pix/apoia.se/BMC) | apoio voluntário | **BAIXA** — sem nexo de aposta, sem promessa | ✅ ("amigo cobrindo custo de servidor") | S | dezenas de R$/mês (simbólico) |
| **Freemium "Palpiteiro Pro"** | assinatura mensal | **BAIXA-MÉDIA** — vende análise/conteúdo, não aposta; manter "sem garantia" | ✅ se sóbrio | L | R$150–600/mês |
| **Créditos avulsos (Pix)** | pré-pago | BAIXA-MÉDIA (mesmo serviço) | ⚠️ (cuidado: "análises", nunca "fichas") | M | complemento |
| **Afiliado de casa de aposta** | CPA/revshare | **ALTA** — vira publicidade de apostas (CONAR/Lei 14.790); exige advogado + só `.bet.br` licenciada | ❌ (gut o firewall + a defesa não-operador) | — | (maior lever, mas muda o que o app É) |
| **Ads display/programático** | impressões | MÉDIA (pode servir ad de bookmaker → dispara o penhasco sem salvaguardas) | ❌ (anti-referência estética) | S | negligível (inventário público minúsculo) |
| **API / white-label B2B** | licença | MÉDIA (redistribuição de dado upstream + o comprador vira publicidade) | neutro | XL | zero sem demanda inbound |

## Recomendações (SEQUENCIADAS)

### Agora (pré-advogado)
1. **Ship a base legal** (`/termos`, `/privacidade`, footer 18+, linha de risco) · S · sem ADR
   Já detalhado no [Report 05](./05-legal-lgpd-e-config.md). R$0, horas, e é **pré-requisito duro**
   de doações, tier pago e da revisão jurídica. Vencido independente de monetização (cadastro aberto).
2. **Instrumentar funil e retenção antes de desenhar qualquer paywall** · M · sem ADR (discovery)
   Analytics privacy-light (Vercel Analytics ou Plausible/PostHog self-hosted, divulgável na
   `/privacidade`): share-view → signup (o loop `/p`), ativação (1ª análise), retenção D7/D30,
   distribuição de análises-por-usuário. + view admin sobre `ai_calls`/rate-limit. **Nenhuma decisão
   de preço antes desse dado** (o teto default de 20/dia é guarda de custo, não tier precificado; o
   uso real provavelmente está bem abaixo). Alimenta também o gate Fase-3 do ROADMAP.
3. **Habilitar doações (Pix/apoia.se/BMC)** · S · sem ADR
   Única receita pré-advogado (apoio voluntário, sem serviço vendido, sem relação de consumo). Link
   discreto "Apoie o projeto" no footer/perfil — **nunca** perto de uma recomendação, **nunca** "pague
   por picks vencedores". Pessoa física pode receber. Cobre o ~US$25-30/mês de base fixa.

### Gate (quando o ROADMAP Fase-3 estiver ao alcance)
4. **Engajar advogado de direito digital/apostas + decidir a entidade (MEI/PJ)** · M · sem ADR (discovery)
   Escopo estreito: (1) confirmar que assinatura de ANÁLISE não reclassifica o app sob Lei 14.790/CONAR
   enquanto não houver link/ad de operador e não se prometer lucro; (2) linguagem de contrato/ToS pro
   tier pago ("sem garantia de resultado" como limitação exequível); (3) entidade pra emitir nota
   (MEI no mínimo); (4) **opinião escrita sobre afiliado** pra tornar o não-go durável. Entregável:
   atualizar a ops-05 + ADR curto com o "envelope de monetização sancionado".

### Pós-advogado
5. **Freemium "Palpiteiro Pro" — soft paywall de volume + features pro, no seam de quota existente** · L · **ADR**
   *(O caminho-carro-chefe.)* Assinatura mensal (**sugestão R$14,90–19,90**; Pix + cartão via
   Mercado Pago/AbacatePay se ficar MEI/PF, Stripe se PJ). **Free:** palpites ~ilimitados (o bucket
   Haiku barato — o loop de engajamento fica grátis e compartilhável) + uma cota pequena de análises
   (ex.: 3-5/dia, tunada pela instrumentação). **Pro:** teto maior de análise, model picker (Opus/
   Sonnet — hoje userSelectable pra todos, gatear pro Pro), histórico completo + Yield drill-down,
   dashboard de CLV (ligar `enableClvCapture` — sua pressão de quota Odds vira COGS que justifica um
   plano Odds pago), + alertas futuros. **Impl:** coluna `users.plan` via migration; tornar
   `checkAnalysisRateLimit` plan-aware (o seam está pronto); webhook do provider → flip de plano;
   páginas de billing. **Exposição BAIXA-MÉDIA:** vende análise, não aposta; manter "sem garantia" em
   tudo, nunca vender como renda; firewall da manchete intocado. ADR: novo provider externo + decisão
   de preço.
   > 📊 **Benchmark do concorrente (Report 08):** PalpiteiroFC cobra **R$79,90/mês** (Free = só
   > Brasileirão / Pago = todas as ligas + 6 mercados + Value Bet + Kelly + Bilhete do Dia + alertas)
   > + afiliado 10% da própria assinatura. A âncora de mercado existe — mas o modelo dele com claims
   > "80% de acerto / +25% ROID" é o que você **não** deve copiar (risco CDC/CONAR).
6. **Pacotes de créditos avulsos (Pix)** · M · sem ADR (no mesmo ADR de monetização)
   "20 análises por R$9,90" — converte quem não quer recorrência. Ledger de créditos consumido pelo
   mesmo check de quota. **Só depois** da assinatura provar a UX de paywall. Copy: "análises", nunca "fichas".
7. **ADR: decidir CONTRA links de afiliado de casa agora, com pré-condições de revisão explícitas** · S · **ADR**
   Escrever pra que sessões/agentes futuros não adicionem casualmente um link de operador. Não-go
   duro na escala atual (a receita esperada não precifica a exposição legal + dano de marca).
   Pré-condições pra reabrir: advogado retido com opinião escrita, PJ constituída, só parceiros
   `.bet.br` licenciados, gate 18+ bloqueante, programa de jogo-responsável, e separação total da
   manchete e do `/p`.

### Não perseguir agora
8. **Ads display/sponsorship** · pular — inventário minúsculo, redes programáticas podem servir ad de
   bookmaker (dispara o penhasco sem salvaguardas), anti-referência estética. Único aceitável futuro:
   patrocínio direto manual de marca **não-aposta**, rotulado "apoiador". Documentar no ADR de monetização.
9. **API/B2B/white-label** · parkear — XL pra construir, sem track record multi-temporada pra vender,
   redistribuição de dado upstream constrangida por termos. Nota de parking de um parágrafo.

## Síntese
A ordem correta é: **base legal → instrumentação → doações → advogado/MEI → freemium Pro → créditos**.
O produto já tem o metering pronto; o gargalo é confiança + legal, não engenharia. Afiliado de casa é
o maior lever e o que você **não** deve tocar sem advogado. Upside honesto = cobrir custo, coerente com
o produto ser um side project de confiança e aprendizado.

Relacionados: `docs/PRD.md`, `docs/ROADMAP.md`, `docs/ops/05-legal-compliance.md`,
`docs/ops/08-clv-quota.md`, [Report 05](./05-legal-lgpd-e-config.md), [Report 08](./08-concorrente-palpiteirofc-e-marca.md).
