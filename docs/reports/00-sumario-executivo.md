# Sumário executivo — Auditoria estratégica do Palpiteiro

> Síntese dos 8 relatórios desta pasta (2026-07-04). Cada dimensão foi auditada por um agente
> especialista lendo o código real; os achados de segurança passaram por verificação adversarial.
> Leia isto primeiro; mergulhe nos reports individuais conforme o interesse.

## ⚠️ Contexto que enquadra tudo: o checkout local estava 15 commits atrás de `origin/main`

Durante a auditoria, o working tree local estava **15 commits atrás** de `origin/main`. Reconciliei
os achados afetados contra `origin/main`. As correções que importam:

- **`/p/[id]` (share público) + OG image JÁ ESTÃO shipados** (#384/#415) — o report de SEO e o de
  segurança leram a árvore stale e disseram "não construído". A OG image existe; a rota existe.
- **O item 4 já tem um v1 shipado:** grade-my-bet "Analise minha aposta" (ADR 0034 + #412) — um
  picker estruturado, exatamente a tediosidade que você quer eliminar. O [Report 04](./04-analise-de-aposta-rework.md)
  é o design da **v2**.
- **Cartões liquidáveis (#394), `/time` histórico (#408), palpites_v8, e o go-live da Fase 2
  (palpiteiro.live)** já estão em `origin/main`.
- **Genuinamente ausentes** em `origin/main` (verificado): `/termos`, `/privacidade`, footer global,
  `robots.ts`, `sitemap.ts`, manifest, ícones/favicon, OG image da raiz, JSON-LD, qualquer modelo
  estatístico (Poisson/ELO/Kelly), e caminho de exclusão LGPD.

**Ação:** trabalhar e construir contra `origin/main` (o local está dirty com teu draft de CONTEXT.md
+ 0035). Antes de corrigir qualquer coisa de segurança, revalidar contra `origin/main`.

## As 3 mensagens grandes

1. **A base legal é um gap de go-live VIVO, não um "nice to have".** O app está no ar com cadastro
   aberto, mas sem `/termos`, `/privacidade`, footer 18+ nem caminho de exclusão LGPD — coisas que a
   sua própria ops-doc marca como obrigatórias. É barato (R$0, horas), é o pré-requisito de
   monetização e de trust/SEO, e resolve tua ansiedade legal do jeito certo. **Faça primeiro.**

2. **O item 3 (IA científica) e o item 4 (aposta livre) compartilham o mesmo motor.** O modelo de
   distribuição de placar Poisson/Dixon-Coles (`lib/quant/scoreline-model.ts`) é a peça central dos
   **dois**: no item 3 ele vira o baseline quantitativo que alimenta os cartuchos; no item 4 ele
   precifica props derivados de placar ("casa marca primeiro", "gols no 1º tempo", placar exato). O
   concorrente PalpiteiroFC usa exatamente esse arsenal (Poisson/xG/Elo/Kelly) — é o padrão do nicho.
   **Construir uma vez, servir os dois.**

3. **Segurança está sólida no núcleo; monetização tem um penhasco claro.** Nenhuma falha crítica de
   authz/IDOR/injeção. O único exploit real é email-bombing do magic link (fix S). Em monetização, o
   maior lever de receita (afiliado de casa de aposta) é justamente o que muda a categoria legal do
   app — o concorrente evita, e você também deve, até ter advogado.

## Roadmap sequenciado (ondas)

### 🌊 Onda 0 — Base legal + higiene + quick-wins (fazer JÁ; barato; destrava tudo)
| Item | Report | Esforço | Por quê agora |
|---|---|---|---|
| `/termos` + `/privacidade` + footer global + middleware | 05 | M+S | Gap de go-live vivo; pré-req de tudo |
| Linha de risco no card de análise | 05 | S | Compliance, superfície de máxima intenção |
| Magic-link IP rate-limit | 01 | S | Único exploit confirmado |
| Headers de segurança (next.config) | 01 | S | Hardening pré-público |
| robots.ts + sitemap.ts + ícones + manifest + metadata + OG raiz + JSON-LD | 06 | S cada | SEO quick-wins (com emenda pareada de middleware) |
| Re-auditar `/p/[id]` contra ADR 0035 | 01 | S | Lacuna da auditoria (leu árvore stale) |
| CTA de conversão no `/p` + Wordmark linkado | 02 | S | Melhor custo-benefício de crescimento |
| PR de dívida de copy (pivot-consistente) | 02 | S | Coerência de marca |

> **Landmine transversal:** toda rota pública nova (páginas legais, robots, sitemap, ícones, OG, blog)
> DEVE shippar com a emenda pareada de `middleware.ts` (matcher) + `next.config.ts` (lookahead), senão
> 307 pro `/signin`. Ver [Report 06](./06-seo-e-conteudo.md) achado #2.

### 🌊 Onda 1 — Item 4: "Aposta livre" (a dor que te incomoda)
ADR emendando 0034 → tracer bullet (placar-exato end-to-end) → `lib/quant/scoreline-model.ts` →
cartucho de parse Haiku → persistência + `settle-user-bets.ts` → UI + histórico "Minhas apostas".
Ver [Report 04](./04-analise-de-aposta-rework.md). **Compartilha o motor com a Onda 2.**

### 🌊 Onda 2 — Item 3: IA científica
ADR camada estatística → tracer Poisson (over/under primeiro, medindo) → harness de calibração
(Brier/log-loss) → ligar CLV capture → gate de edge no código. Depois (gated na calibração):
Dixon-Coles fitted + Kelly fracionário. Ver [Report 03](./03-ia-cientifica.md).
**Sequenciar com a Onda 1 (mesmo `lib/quant`).**

### 🌊 Onda 3 — Crescimento: SEO/conteúdo + retenção
Blog/news MDX (ADR) — o motor orgânico → flip de indexabilidade do `/p` → enriquecer landing →
"palpites de hoje" no `/jogos` + track record do palpite + digest de e-mail pré-apito (ADR) →
dashboard mobile pass → seguir times. Ver [Reports 06](./06-seo-e-conteudo.md) e [02](./02-ux-e-features.md).

### 🌊 Onda 4 — Monetização (gated em advogado + Fase-3)
Instrumentar funil/retenção (fazer cedo) → doações (única receita pré-advogado) → advogado + MEI →
freemium "Palpiteiro Pro" (R$14,90–19,90, no seam de quota) → créditos avulsos → ADR de não-go de
afiliado → site_settings de links sociais (item 6). Ver [Report 07](./07-monetizacao.md) e [08](./08-concorrente-palpiteirofc-e-marca.md).

## Placar dos teus 8 pedidos

| # | Pedido | Estado | Onde |
|---|---|---|---|
| 1 | Scan de segurança | ✅ Feito — núcleo sólido, 1 exploit real (magic link), resto é hardening | [01](./01-seguranca.md) |
| 2 | UI/UX + features | ✅ Feito — palpite invisível fora da match page é o gap nº 1 | [02](./02-ux-e-features.md) |
| 3 | IA científica (Poisson/Value/Kelly/ELO) | ✅ Design faseado — hoje 100% LLM, zero modelo estatístico | [03](./03-ia-cientifica.md) |
| 4 | Rework análise da aposta do usuário | ✅ Design v2 "Aposta livre" — v1 (picker) já shipou e é a tediosidade | [04](./04-analise-de-aposta-rework.md) |
| 5 | Legal (termos/privacidade/contato/LGPD) | ✅ Plano — tudo spec'd, nada construído; gap de go-live vivo | [05](./05-legal-lgpd-e-config.md) |
| 6 | Links sociais (DB/env) | ✅ Recomendado `site_settings` singleton (não env, não redeploy) | [05](./05-legal-lgpd-e-config.md) |
| 7 | SEO | ✅ Feito — quick-wins baratos + blog como motor orgânico | [06](./06-seo-e-conteudo.md) |
| 8 | Monetização | ✅ Estratégia sequenciada + benchmark do concorrente | [07](./07-monetizacao.md) |
| + | Concorrente PalpiteiroFC + medo da lei + marca | ✅ Análise dedicada | [08](./08-concorrente-palpiteirofc-e-marca.md) |

## Próximo passo
Estes reports são **issue-ready**: cada recomendação tem título, esforço (S/M/L/XL), impacto, labels
sugeridas e flag de ADR. Não criei issues no GitHub (você pediu pra revisar depois). Quando voltar, é
só dizer quais ondas/itens aprovar que eu transformo em issues seguindo o flow do CLAUDE.md
(sanity-check → plano → issues → subagent por passo).
