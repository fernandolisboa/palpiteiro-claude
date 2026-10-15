# ADR 0059 — Telas públicas: marca sem sufixo, rodapé na coluna da página e ilustrações em código

## Status

Accepted (2026-10-15). Issue #579 (linhas 25 e 27 da revisão de design de 2026-10). **Reafirma, sem emendar:** ADR 0048 Decisões 2 a 4 (nada de casa de apostas; 18+, "Aposta não é investimento" e "não é casa de apostas" no rodapé global; nenhuma alegação de acerto ou desempenho em página pública), ADR 0056 (vocabulário de tela, piso de 11px) e ADR 0057 Decisão 6 (o §3 uma vez onde se registra ou lista aposta). Camada de apresentação: não toca prompt, seed, `lib/view/markets/presentation.ts` nem valores do banco. Plano: `docs/plans/PLAN-579.md` (a "Revisão do plano" vale sobre o resto).

## Contexto

As telas públicas (landing, `/signin`, `/como-funciona`, `/termos`, `/privacidade`) tinham três sufixos diferentes na marca ("edge multi-mercado", "· edge multi-mercado", "v0 · edge multi-mercado"), um rodapé com largura e gutter próprios que não alinhava com nenhuma página (o texto começava em x=200 a 1440px; o conteúdo em 232, 424 ou 530, conforme a tela), três avisos de responsabilidade na landing (o inline, a linha 18+ do rodapé e o "não é casa de apostas" do rodapé) e nenhuma imagem do produto. A issue pede a landing "com print".

## Decisão

1. **Aviso da landing é só o rodapé global.** A landing não registra nem lista aposta, então não leva o §3 (ADR 0057 D6). A ADR 0048 D4 põe o 18+ "em toda página (footer global)" e o "Aposta não é investimento" no footer, Termos §4 e disclaimers; o `docs/ops/05-legal-compliance.md` §7 manda 18+, jogo responsável e "não é casa de apostas" no footer de toda página. A linha inline da landing sai; a evidência do item A5 do Report 11 (`docs/reports/11-revisao-legal.md`) passa a ser o rodapé (`components/site-footer.tsx`) e os Termos §4. O rodapé fica travado por `components/__tests__/site-footer.test.tsx`.
2. **Imagens de produto em tela pública são ilustrações renderizadas em código.** Server Components em `components/landing/` que compõem os primitivos reais (`Card`, `ResultBadge`, `TeamAvatar`, os pedaços do palpite público) com dados fictícios fixos (`components/landing/preview-data.ts`), times inventados com monograma, dentro de uma `<figure>` com a legenda visível "Exemplo ilustrativo, com times fictícios." e a prévia `aria-hidden` + `inert`. **Nenhuma odd, stake, vantagem, R$, pote nem resultado do app** (os selos do bolão são dos amigos fictícios). Nada em `public/` (o matcher do `middleware.ts` não exclui `public/`: o arquivo tomaria 307 → `/signin` sem sessão) e nenhum `<img>`.
3. **Marca só "palpiteiro".** O `Wordmark` não aceita sufixo; o tipo impede a volta.
4. **O rodapé segue a largura da coluna da página.** A página marca a largura no contêiner (`PageContainer` emite `data-page-width`; páginas sem `PageContainer` levam o atributo à mão) e o `app/globals.css` lê com `body:has([data-page-width="…"]) [data-footer-column]`. O rodapé usa o mesmo gutter do `PageContainer` (`px-5 lg:px-8`, border-box). `reading` = 640px; `form` = 380px + os dois gutters (o login põe o gutter por fora da coluna). As variáveis levam fallback literal (o `@theme` é `inline` e não emite `--container-reading`/`--container-form` no `:root`). Sem marca, ou sem suporte a `:has()`, fica `content`.
5. **Exceção de cor: a marca do Google.** O "G" do botão "Continuar com o Google" usa os quatro hex oficiais (`#EA4335`, `#4285F4`, `#FBBC05`, `#34A853`) só em `app/signin/google-mark.tsx`, com atributo `fill` (nenhum `style`), a 18px (`size-4.5`, que escapa do `size-4` da base do `Button`) e sobre um círculo branco nos dois temas. Não são tokens do app; nenhuma outra tela usa esses hex.

## Alternativas rejeitadas

- **Prints PNG/WebP do app.** Envelhecem a cada PR de UI sem teste nenhum acusar, pedem dois por bloco (claro e escuro) e, em `public/`, caem no gate do middleware. Um `import` via `next/image` sairia do gate, mas não resolve o envelhecimento.
- **Mapa `pathname → largura` dentro do `SiteFooter`.** Duplica a decisão que cada página já toma no `PageContainer` e quebra em silêncio quando uma tela muda de largura.
- **Manter o aviso inline na landing.** O Report 11 (§4) já o chamava de "redundância inofensiva"; três avisos na mesma tela ensinam a pular.

## Consequências

- **(+)** Uma marca, um rodapé alinhado ao texto da página em todas as larguras, uma tela de entrada com o produto à vista e sem bytes de imagem; a landing continua `force-static` e sem JS novo.
- **(+)** A prévia acompanha os primitivos: mudou o `ResultBadge` ou o `TeamAvatar`, muda a ilustração; mudou a assinatura, quebra o `typecheck`.
- **(−)** O arranjo das prévias pode divergir das telas reais (os primitivos acompanham, a composição não). Follow-up: trocar as prévias pelos cartões de `components/bets/` e do bolão quando eles aceitarem dados fictícios sem data relativa ao "agora" (a landing é estática e congelaria a data do build).
- **(−)** Quem não rola até o rodapé não vê o 18+ antes do "Entrar"; o checkbox obrigatório do `/signin` cobre o cadastro.
- **(−)** Se uma página tiver dois contêineres de larguras diferentes, vence o mais estreito (ordem das regras no CSS); hoje nenhuma tem.
