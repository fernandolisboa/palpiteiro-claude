# Report 06 — SEO, descoberta e conteúdo (blog/news)

> Auditoria de SEO técnico + estratégia de conteúdo (2026-07-04). **Correção importante de
> checkout:** o agente de SEO leu a árvore local stale e afirmou que `/p/[id]` e a OG image
> "não existem" — **isso está errado**: `origin/main` **tem** `app/p/[id]/page.tsx` +
> `opengraph-image.tsx` (shipados em #384/#415). Os demais achados (robots/sitemap/icons/
> manifest/JSON-LD/metadata raiz stale) **valem** em `origin/main` (verificado).

## Veredito geral

O Palpiteiro tem hoje **duas páginas indexáveis** (`/` e `/como-funciona`) e **quase zero camada
de SEO**: sem `robots.txt`, sem `sitemap.xml`, sem ícones/favicon/manifest, sem OG image na raiz,
sem canonical, sem JSON-LD. A metadata raiz ainda tem descrição stale ("Recomendações de aposta em
over/under 2.5 gols"), e páginas autenticadas não exportam metadata.

**Takeaway nº 1 — a landmine transversal:** o matcher de auth do middleware gateia todo path não
excluído explicitamente, então `/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest`, `/icon.*` e
qualquer `opengraph-image` adicionado via convenção de metadata do Next vão **307 pro `/signin`**
pra crawlers — a menos que o matcher (e o lookahead de cache do `next.config.ts`) sejam emendados
**no mesmo PR**. Robots+sitemap+icons+OG são **quick-wins S** só se essa emenda vier junto.

**Estrategicamente:** a decisão deliberada "SEO = 1 página rankeável, sem long-tail"
(`docs/discovery/perf-cost-scaling.md`) significa que crescimento orgânico precisa de **dois vetores
novos**: um **blog/news pt-BR** (o motor de tráfego orgânico — validado pelo concorrente, ver
[Report 08](./08-concorrente-palpiteirofc-e-marca.md)) e a **indexação futura do `/p/[id]`** (hoje
`noindex` por escolha do ADR 0035), engenheirada pra o flip da Fase-3 ser uma mudança de uma-constante.

## Achados

| # | Prioridade | Achado |
|---|---|---|
| 1 | **alta** | Sem `robots.ts`/`sitemap.ts` — e `/robots.txt`/`/sitemap.xml` hoje são auth-redirected pro `/signin` |
| 2 | **alta** | **Landmine:** o matcher do middleware quebra silenciosamente TODA rota de metadata do Next adicionada (só `favicon.ico` está no allowlist) |
| 3 | **alta** | Zero ícones/favicon/manifest — aba do browser, favicon no SERP e instalabilidade todos default/quebrados |
| 4 | **alta** | Sem OG image na raiz e sem twitter card — todo share da landing é texto puro |
| 5 | **alta** | Metadata raiz stale e contraditória; sem title template; páginas gated e `/signin` sem metadata própria |
| 6 | média | Sem JSON-LD (structured data) em lugar nenhum — falta Organization + WebSite baseline |
| 7 | **alta** | Só 2 páginas indexáveis + landing keyword-thin pra intenção de busca pt-BR — decisão deliberada que agora precisa de emenda |
| 8 | média | `/p/[id]` **está shipado** (`origin/main`) mas é `noindex` por ora — o vetor de crescimento está engatilhado mas não indexado (por escolha do ADR 0035, pendente Fase-3) |
| 9 | média | Sem `/termos` nem `/privacidade` — gap de E-E-A-T/trust num domínio YMYL (ver [Report 05](./05-legal-lgpd-e-config.md)) |
| 10 | baixa | Sem canonical e sem canonicalização `.vercel.app`→`palpiteiro.live` |
| — | (positivo) | Core Web Vitals das páginas públicas saudável (estáticas, next/font, sem LCP image); o pesado (`force-dynamic`) é todo gated |

## Recomendações (dimensionadas)

### Quick wins (S, alto impacto — cada um com a emenda pareada de middleware/headers)
1. **`app/robots.ts` + `app/sitemap.ts` + emenda middleware/headers + submissão no Search Console** · S
   `robots.ts` (allow `/` e `/como-funciona`; disallow `/jogos`, `/dashboard`, `/match`, `/perfil`,
   `/admin`, `/signin`, `/api`, `/p/` per ADR 0035 §6; linha Sitemap). `sitemap.ts` com as URLs
   públicas. **OBRIGATÓRIO no mesmo PR:** emendar `middleware.ts:35` pra excluir `robots.txt$` e
   `sitemap.xml$` (âncora, disciplina de regex do ADR 0035) + estender o lookahead do
   `next.config.ts:36`. Verificar palpiteiro.live no Google Search Console e submeter o sitemap.
2. **Ícones (favicon + app icon + apple-icon) + `app/manifest.ts`** · S
   `favicon.ico` + `app/icon.png` (192/512) + `app/apple-icon.png` + `app/manifest.ts`. **SEM service
   worker** (ADR 0024 fica; manifest-only pra instalabilidade é compatível). Mesmo-PR: estender o
   lookahead do `next.config.ts` (o ADR 0024:39 já pede isso) + excluir os paths no middleware.
3. **Overhaul de metadata** · S
   No `app/layout.tsx`: `title { default, template: '%s · Palpiteiro' }`, descrição multi-mercado
   palpite-first (sem "recomendações de aposta"; alinhar com `PALPITE_DISCLAIMER`), `openGraph.siteName`
   + locale `pt_BR`, twitter defaults. Por-página: canonical em `/` e `/como-funciona`; `/signin` com
   `robots:{index:false}`; páginas gated com títulos simples (UX); `/match/[id]` com `generateMetadata`
   (nomes dos times). **Reescrever o título/descrição da landing** pra intenção de busca real ("palpites
   de futebol com IA") em vez do jargão "motor de seleção de edge multi-mercado".
4. **OG image dinâmica da landing (`app/opengraph-image.tsx`)** · M
   `ImageResponse` (next/og, built-in no Next 15, zero deps): wordmark, tagline, faixa "18+ · não é
   recomendação de aposta". Mesmo-PR: exclusão de `opengraph-image*` na raiz no middleware. Faz todo
   share de palpiteiro.live no WhatsApp/X renderizar card rico.
5. **JSON-LD: Organization + WebSite na landing** · S
   `<script type="application/ld+json">` server-rendered no `app/page.tsx` (const tipada +
   JSON.stringify). **Pular FAQPage** (Google restringiu rich results de FAQ a gov/health em 2023).
   SportsEvent e Article ficam deferidos pro flip de `/p` e pro blog.

### Vetores de crescimento (L, alto impacto)
6. **Blog/news `app/blog` com MDX versionado em git — o motor de tráfego orgânico** · L · **ADR**
   *(Teu item 3 — blog/news.)* 3ª exceção ao auth shield (daí o ADR curto emendando a decisão
   "SEO = 1 página"). `content/posts/*.mdx` in-repo (casa com a cultura docs-as-code; contentlayer
   está sem manutenção — usar `@next/mdx` ou `next-mdx-remote`), `app/blog/page.tsx` +
   `app/blog/[slug]/page.tsx` com `generateStaticParams` — **100% estático, zero auth/DB/Odds/IA**,
   mesma classe de custo da landing (shield intacto). Per-post `generateMetadata` + Article JSON-LD +
   inclusão automática no sitemap + RSS opcional. Middleware: exclusão `blog(?:/|$)`. **Guardrails
   editoriais:** todo post renderiza o footer 18+/jogo-responsável/não-operador; conteúdo educacional
   pt-BR ("o que é edge", "como ler odds", "palpites de futebol com IA", análise de rodada) — **NÃO**
   dicas por-jogo (isso recriaria o corpus de tips indexável que o ADR 0035 §6 defere pra revisão
   legal). Minerar as 508 linhas do `/como-funciona` como cluster de tópicos semente. **CMS DB
   rejeitado** (dono solo, fluxo de review no git, sem custo de runtime).
   > ⚠️ **Nuance regulatória (cruza com Report 08):** o concorrente PalpiteiroFC publica ~3
   > artigos/dia **por jogo** com picks — isso é ótimo pra SEO mas mora mais perto da linha de
   > "recomendação/publicidade". Recomendação: blog **educacional/analítico**, sem virar feed de
   > tips por-jogo, até ter advogado. Você ainda pode superar o SEO dele com **JSON-LD SportsEvent**
   > (que ele não tem) quando/se indexar o `/p`.
7. **Executar o flip de indexabilidade do `/p/[id]`** (engenheirado como 1 constante) · S (a engenharia)
   O `/p` já existe (`noindex`). Centralizar a postura de indexação numa constante exportada consumida
   por `generateMetadata`/`X-Robots-Tag`/`robots.ts`/`sitemap.ts` — pra o sign-off legal da Fase-3 (o
   ADR 0035 Alternativa 3 **defere, não rejeita**) virar indexabilidade + SportsEvent JSON-LD
   (homeTeam/awayTeam/startDate; **nunca** odds) + inclusão no sitemap num único PR revisado. A
   viralidade (unfurls) já funciona hoje independente do flip.

### Complementos
8. **`/termos` e `/privacidade` públicas** · S — cruza com [Report 05](./05-legal-lgpd-e-config.md); duplo valor: E-E-A-T + desbloqueia parte do checklist Fase-3.
9. **Canonicalização de domínio** · S — redirect 308 do alias `.vercel.app` de produção pra `palpiteiro.live` (config Vercel, sem código).

## Síntese
Os quick-wins 1-5 são horas de trabalho e destravam indexação/unfurl decentes — desde que cada um
carregue a **emenda pareada de middleware+headers** (a landmine). O **blog (#6)** é o motor de
crescimento de longo prazo (o concorrente prova a tese), e o **flip do `/p` (#7)** é o vetor de
viralidade + SEO já 90% pronto. Tudo respeitando o firewall (zero odds/EV em superfície pública).

Relacionados: ADR 0024 (sem SW), ADR 0035 (share), `docs/discovery/perf-cost-scaling.md`,
[Report 02](./02-ux-e-features.md) (CTA no `/p`), [Report 05](./05-legal-lgpd-e-config.md), [Report 08](./08-concorrente-palpiteirofc-e-marca.md).
