# docs/reports — Auditoria estratégica do Palpiteiro (2026-07-04)

Reports e análises gerados a pedido do dono, cobrindo 8 frentes: segurança, UX/features, IA
científica, o rework da análise de aposta, legal/LGPD/config, SEO/conteúdo, monetização, e uma
análise do concorrente PalpiteiroFC + risco de marca.

**Natureza:** snapshot de um ponto no tempo (como os `docs/handoffs/`), não spec viva. Cada report é
auto-suficiente e **issue-ready** (recomendações com esforço S/M/L/XL, impacto, labels e flag de ADR).
Aterrados no código real; a auditoria rodou com o checkout local **15 commits atrás de `origin/main`** —
as discrepâncias que importam estão reconciliadas e sinalizadas (ver o [sumário](./00-sumario-executivo.md)).

> ⚠️ **Não é parecer jurídico.** Os reports 05, 07 e 08 discutem regulação/LGPD/marca como leitura de
> engenheiro baseada em pesquisa pública. Pra monetizar ou abrir ao público: advogado de direito
> digital/apostas.

## Como ler

**Comece pelo [00 — Sumário executivo](./00-sumario-executivo.md)** (as 3 mensagens grandes, o roadmap
em ondas, o placar dos 8 pedidos). Depois mergulhe conforme o interesse:

| # | Report | O quê |
|---|---|---|
| 00 | [Sumário executivo](./00-sumario-executivo.md) | Síntese cross-cutting + roadmap sequenciado em ondas |
| 01 | [Segurança](./01-seguranca.md) | Scan adversarial verificado — núcleo sólido, 1 exploit real |
| 02 | [UI/UX e features](./02-ux-e-features.md) | Fricção de UX + funcionalidades novas de alto valor |
| 03 | [IA científica](./03-ia-cientifica.md) | Poisson/Dixon-Coles/ELO/Kelly/calibração — design faseado |
| 04 | [Rework da análise de aposta](./04-analise-de-aposta-rework.md) | "Aposta livre" v2 (o item que te incomoda) |
| 05 | [Legal, LGPD e config](./05-legal-lgpd-e-config.md) | Termos/privacidade/footer/exclusão + links sociais |
| 06 | [SEO e conteúdo](./06-seo-e-conteudo.md) | Quick-wins de SEO + blog/news como motor orgânico |
| 07 | [Monetização](./07-monetizacao.md) | Caminhos sequenciados + exposição regulatória de cada |
| 08 | [Concorrente PalpiteiroFC + marca](./08-concorrente-palpiteirofc-e-marca.md) | Benchmark + risco regulatório + nome/INPI |
| 09 | [O que precisa de você](./09-precisa-de-voce.md) | Estado da execução: PRs a revisar, decisões suas, backlog |
| 11 | [Revisão legal](./11-revisao-legal.md) | Conformidade do que está no ar (LGPD, Lei 14.790, CDC, Marco Civil) — decidida por delegação, ADRs 0046-0048 |

## Fios que cruzam vários reports

- **A base legal (05)** é pré-requisito de monetização (07), sinal de trust pra SEO (06), e um gap de
  go-live vivo (cadastro já aberto).
- **O motor Poisson de placar** é compartilhado entre IA científica (03) e o rework de aposta (04) —
  `lib/quant/scoreline-model.ts`, construir uma vez.
- **A landmine do middleware:** toda rota pública nova (páginas legais, robots/sitemap/ícones/OG, blog)
  precisa da emenda pareada de `middleware.ts` + `next.config.ts` — detalhada no report 06.
- **O concorrente (08)** valida a direção dos itens 3, 7 e 8 (usa Poisson/xG/Elo/Kelly, blog por-jogo,
  freemium) — e serve de contra-exemplo do que NÃO fazer na parte legal (claims de ROI, sem CNPJ).

## Status
Nenhuma issue foi criada no GitHub e nenhum código foi alterado — só estes documentos. Quando quiser
executar, é só apontar quais ondas/itens aprovar.
