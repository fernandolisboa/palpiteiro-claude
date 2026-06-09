# Ops do Palpiteiro — colocar em produção e abrir pros amigos (Fase 2)

Este diretório é o guia passo a passo pra tirar o Palpiteiro do uso solo (rodando
hoje num subdomínio `*.vercel.app`) e **abrir pros amigos** — a **Fase 2** do
[roadmap](../ROADMAP.md) (meta: **≥3 usuários** logando por convite/whitelist). Os
docs cobrem domínio, configuração de produção na Vercel, e-mail entregável,
observabilidade, conformidade legal e marca, terminando num checklist de go-live.
Leia na ordem abaixo; cada doc é autocontido e se cross-linka com os outros.

> 💡 Lembrete de contexto: o Palpiteiro **não aceita dinheiro nem opera apostas** —
> gera recomendações over/under 2.5 + tracking de Yield hipotético; a aposta real é
> feita pelo usuário fora do app, em plataformas `.bet.br` autorizadas. Isso reduz
> muito a carga regulatória (o app **não** é operador sob a
> [Lei 14.790/2023](https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2023/lei/l14790.htm)),
> mas não zera 18+, jogo responsável e LGPD. Ver [`05-legal-compliance.md`](./05-legal-compliance.md).

## Comece por aqui

Ordem recomendada. O passo **01 (domínio)** destrava quase tudo — sem domínio
próprio, o Resend não sai do modo teste e nenhum amigo recebe magic link.

1. [`01-dominio.md`](./01-dominio.md) — **Comprar o domínio + apontar DNS pra Vercel.** Escolher nome/TLD, registrar e apontar A/CNAME (ou nameservers) pra Vercel, com SSL automático. É o gargalo da Fase 2.
2. [`02-vercel-prod.md`](./02-vercel-prod.md) — **Configurar a Vercel pra produção.** Anexar o domínio custom, preencher a matriz de env vars, proteger os crons com `CRON_SECRET`, confirmar Neon/KV e decidir Hobby vs Pro.
3. [`03-email-resend.md`](./03-email-resend.md) — **Tirar o Resend do modo teste.** Verificar o domínio (SPF/DKIM/DMARC) pra o magic link e o spend-alert chegarem na caixa dos amigos, não só na sua conta Resend.
4. [`04-observabilidade.md`](./04-observabilidade.md) — **Sentry, logs, uptime e alertas.** Instrumentar o Sentry do zero (greenfield), saber onde ver logs e confirmar o spend-alert já existente.
5. [`05-legal-compliance.md`](./05-legal-compliance.md) — **18+, jogo responsável, LGPD e termos.** Páginas `/termos` e `/privacidade`, footer com selo 18+, aviso de risco e o contexto da Lei 14.790/2023.
6. [`06-marca-inpi.md`](./06-marca-inpi.md) — **Registro de marca no INPI (avaliar/adiar).** Busca de anterioridade grátis agora, garantir domínio + handles, e por que o registro formal pode esperar a Fase 3.
7. [`07-checklist-go-live.md`](./07-checklist-go-live.md) — **Checklist final de produção.** Runbook de go-live com checkboxes, matriz de env vars, smoke tests e plano de rollback. **Fonte da verdade do passo a passo.**

## Custo total: o que é grátis e o que se paga

> 💰 **O ÚNICO custo obrigatório pra abrir pros amigos (Fase 2) é o domínio —
> estimativa de ~R$ 40/ano pra `.com.br` (ou ~R$ 55–60/ano pra `.com`).** Todo o resto (Vercel, Neon, Resend, Vercel KV,
> Sentry e os providers de dados esportivos) **cabe em free tier** no tráfego baixo
> da Fase 2. A única exceção é a **Anthropic**, que é **pay-per-use** (custo real de
> tokens por análise) — mas isso já está mitigado por **rate limit por usuário/dia**
> e por **alerta de gasto opt-in** (`DAILY_AI_SPEND_ALERT_USD` + `SPEND_ALERT_EMAIL`).
> Em resumo: **compre o domínio, e o resto não te cobra na escala de amigos.**

Tabela consolidada (reconcilia os custos dos docs 01–07). Preços/limites são
**estimativas de jun/2026 e mudam** — confira sempre no link oficial.

| Item | Provedor | Cabe no free tier? | Custo se pagar (confira no link) | Obrigatório p/ Fase 2? |
| --- | --- | :---: | --- | :---: |
| **Domínio** `.com.br` | registro.br | n/a (sempre pago) | ~R$ 40/ano, registro = renovação ([registro.br](https://registro.br/busca-dominio/)) | **Sim** |
| **Domínio** `.com` | Cloudflare Registrar | n/a (sempre pago) | ~US$ 10,44/ano a preço de custo ([cloudflare](https://www.cloudflare.com/products/registrar/)) | alternativa |
| **Domínio** `.com`/`.app` | Namecheap | n/a (sempre pago) | varia por TLD/promo — cuidado com preço de 1º ano ([namecheap](https://www.namecheap.com/)) | alternativa |
| SSL/TLS do domínio | Vercel | **Sim** | R$ 0 — emitido/renovado automático (Let's Encrypt) | incluso |
| Hosting + cron + integração | Vercel **Hobby** | **Sim** (uso não-comercial) | Pro ~US$ 20/membro/mês ([vercel.com/pricing](https://vercel.com/pricing)) se monetizar | **Sim** (Hobby) |
| Postgres | Neon (integração Vercel) | **Sim** | acima do free tier ([neon.tech/pricing](https://neon.tech/pricing)) | **Sim** (free) |
| Redis | Vercel KV | **Sim** | acima do free tier ([vercel.com/pricing](https://vercel.com/pricing)) | **Sim** (free) |
| E-mail (magic link + alerta) | Resend | **Sim** (~3.000/mês, ~100/dia, 1 domínio) | acima do free tier ([resend.com/pricing](https://resend.com/pricing)) | **Sim** (free, exige domínio) |
| LLM (análises) | **Anthropic** | **Não** — pay-per-use | custo real de tokens por análise; mitigado por rate limit + spend-alert ([anthropic.com/pricing](https://www.anthropic.com/pricing)) | **Sim** (pay-per-use) |
| Odds | The Odds API | **Sim** (500 req/mês) | acima do free tier ([the-odds-api.com](https://the-odds-api.com/)) | **Sim** (free) |
| Dados de jogos | API-Football (api-sports.io) | **Sim** (100 req/dia) | acima do free tier ([api-sports.io](https://www.api-football.com/pricing)) | **Sim** (free) |
| Dados de jogos (fallback) | football-data.org | **Sim** (10 req/min) | acima do free tier ([football-data.org](https://www.football-data.org/pricing)) | **Sim** (free) |
| Observabilidade | Sentry **Developer** | **Sim** (~5.000 erros/mês, 30d) | Team a partir de ~US$ 26/mês ([sentry.io/pricing](https://sentry.io/pricing)) | não (recomendado) |
| Uptime externo | UptimeRobot / Better Stack | **Sim** (free tier) | acima do free tier (confira nos links) | não (opcional) |
| Páginas legais `/termos` `/privacidade` + footer | você (texto) | n/a | R$ 0 + algumas horas de trabalho | **Sim** |
| Registro de marca | INPI | n/a (taxa GRU) | ~R$ 440 (reduzido) / ~R$ 880 por classe ([tabela INPI](https://www.gov.br/inpi/pt-br)) | não (adiar) |
| Handles sociais (Instagram/X/TikTok) | redes sociais | **Sim** | R$ 0 — recomendado reservar já | não (recomendado) |

> ℹ️ "Cabe no free tier?" assume o tráfego baixo da Fase 2 (uso solo + alguns
> amigos). Se a Fase 3 (público/monetização — **não planejada**) acontecer, vários
> destes precisam ser reavaliados (Vercel Pro, cotas dos providers, Sentry Team).

## Decisões abertas (suas)

Agregadas dos docs 01–07. A primeira destrava as outras — **resolva o nome do
domínio antes**, porque Resend, marca e e-mail de contato legal dependem dele.

1. **Nome + TLD do domínio** (candidato: `palpiteiro.com.br`; `.com`/`.app` também na mesa). _Default: `.com.br`_ pelo público BR. Checar disponibilidade **e** handles sociais antes de fechar. Ver [`01-dominio.md`](./01-dominio.md).
2. **Registrador do `.com`/`.app`**: Cloudflare Registrar (preço de custo, prende ao DNS Cloudflare) vs Namecheap (não prende) vs Vercel Domains (mais caro, conveniente). Ver [`01-dominio.md`](./01-dominio.md).
3. **Caminho de DNS**: registros A/CNAME (_default_, mantém DNS no registrador) vs nameservers da Vercel (centraliza, obrigatório p/ wildcard). Ver [`01-dominio.md`](./01-dominio.md).
4. **Plano Vercel**: Hobby (_default_, uso não-comercial) vs Pro. Confirmar a leitura de "não-comercial" no Fair Use atual. Ver [`02-vercel-prod.md`](./02-vercel-prod.md).
5. **Variante canônica `www` ↔ apex** (_default_: apex canônico, `www` redireciona). Ver [`02-vercel-prod.md`](./02-vercel-prod.md).
6. **Ligar o spend-alert** (`DAILY_AI_SPEND_ALERT_USD` + `SPEND_ALERT_EMAIL`) — opt-in, _recomendado pra Fase 2_. Ver [`02-vercel-prod.md`](./02-vercel-prod.md).
7. **Subdomínio de envio no Resend** (`send.SEUDOMINIO`, _recomendado_) vs domínio raiz; e a política DMARC (começar em `p=none`, evoluir depois). Ver [`03-email-resend.md`](./03-email-resend.md).
8. **Sentry agora vs adiar** (_default: ligar o free tier agora_, é greenfield); instrumentar só server/edge primeiro; manter `sendDefaultPii` desligado (cruzar com LGPD); registrar a adoção como ADR curto. Ver [`04-observabilidade.md`](./04-observabilidade.md).
9. **Uptime externo** (opcional na Fase 2) e qual serviço (UptimeRobot / Better Stack / cron-job.org). Ver [`04-observabilidade.md`](./04-observabilidade.md).
10. **Gate 18+ bloqueante (modal) vs só aviso** (_default: só aviso na Fase 2, gate na Fase 3_); aceite explícito (checkbox) vs implícito por login; identidade do controlador (pessoa física vs PJ) e e-mail de contato (`privacidade@seudominio`). Ver [`05-legal-compliance.md`](./05-legal-compliance.md).
11. **Registrar marca no INPI agora vs adiar** (_default: adiar na Fase 2_, mas garantir domínio + handles já); quantas classes NCL; nominativa vs mista; DIY vs agente. Ver [`06-marca-inpi.md`](./06-marca-inpi.md).

## Status de alto nível

O passo a passo detalhado, com checkboxes pra marcar, vive em
**[`07-checklist-go-live.md`](./07-checklist-go-live.md)** — é a **fonte da verdade**
do go-live. Resumão do que cada etapa fecha:

| # | Etapa | Doc | Estado |
| --- | --- | --- | :---: |
| a | Domínio comprado + DNS apontado | [`01`](./01-dominio.md) | [ ] |
| b | Vercel produção + matriz de env vars + crons | [`02`](./02-vercel-prod.md) | [ ] |
| c | Resend fora do modo teste (domínio verificado) | [`03`](./03-email-resend.md) | [ ] |
| d | Observabilidade (Sentry/logs) + spend-alert | [`04`](./04-observabilidade.md) | [ ] |
| e | Páginas legais (`/termos`, `/privacidade`) + footer 18+ | [`05`](./05-legal-compliance.md) | [ ] |
| f | Marca: domínio/handles garantidos, INPI adiado | [`06`](./06-marca-inpi.md) | [ ] |
| g | Whitelist dos amigos + `db:claim-admin` | [`auth-setup.md`](../runbooks/auth-setup.md) | [ ] |

> ✅ **Definition of done (Fase 2):** ≥3 amigos convidados logam por magic link
> (e-mail chega na caixa deles), veem recomendações + dashboard/Yield, e os crons
> rodam autenticados. Detalhe completo em [`07-checklist-go-live.md`](./07-checklist-go-live.md).

## Cross-links

- [`07-checklist-go-live.md`](./07-checklist-go-live.md) — checklist mestre de go-live (passo a passo).
- [`../runbooks/auth-setup.md`](../runbooks/auth-setup.md) — setup de auth, whitelist e `db:claim-admin`.
- ADRs: [0007 — auth multiuser](../decisions/0007-auth-multiuser-jwt-env-whitelist.md) · [0009 — whitelist em tabela DB](../decisions/0009-whitelist-db-table.md).
- [`../ROADMAP.md`](../ROADMAP.md) · [`../PRD.md`](../PRD.md) · [`../../CLAUDE.md`](../../CLAUDE.md) · [`../../.env.example`](../../.env.example).
