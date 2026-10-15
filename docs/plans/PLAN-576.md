# PLAN-576: página do jogo compacta (linhas 1, 19 e 24 da revisão de design)

Rascunho anterior à implementação (ver `docs/plans/README.md`). Referências conferidas no código em `7f059b9` (main, com #574/#581 e #575/#582 mergeados). Regras herdadas do PLAN-574/575: nenhum nome, link ou logo de casa; **não mexer em prompt nem em valores do banco** (`lib/view/markets/presentation.ts` espelha o seed); vocabulário de tela da ADR 0056 (`lib/view/markets/display.ts`); tokens da ADR 0029/0056 (piso de 11px, mono só em número, zero `text-[Npx]`, guardas em `components/__tests__/design-scale-guard.test.ts`); `ResultBadge` para resultado; alvos `data-tour` e rótulos de `/como-usar` sempre consistentes com a tela.

Fora de escopo: escudo e nome curto (PR 5, linhas 13/14, `docs/plans/PLAN-578.md`); `/apostas`, bolão e listas (PR 4); landing e `/como-funciona` (PR 6); jogo ao vivo (#580, só deixar o encaixe pronto, ver "Encaixe do ao vivo").

**Ordem de merge (revisão):** o PR 5 (#578) entra **antes** deste. Ele mexe em `page.tsx` (apaga o objeto `teams` canônico e passa `displayTeams` à grade e ao "Seu palpite"; põe `homeTeamCrestUrl`/`awayTeamCrestUrl` no input do `toMatchHeroView`), em `components/match-hero.tsx:46` (`TeamAvatar` → `TeamCrest`) e em `app/actions/bet-slip.ts:224-227` (rótulos da avaliação). Os números de linha de `page.tsx` e `match-hero.tsx` abaixo são de `7f059b9` e **vão mudar**: reconferir no começo do PR A, depois do rebase sobre o PR 5. Onde este plano diz `teams`, leia o `displayTeams` que o PR 5 deixa.

## Situação hoje (medida no código)

`app/(app)/match/[id]/page.tsx` (825 linhas) monta **duas árvores** com o mesmo conteúdo: `MobileMatch` dentro de `<div className="lg:hidden">` e `DesktopMatch` dentro de `<div className="hidden lg:block">` (`:383-436`). Cada componente assíncrono roda **duas vezes** por request (as promises são compartilhadas, mas `MatchSections`/`MatchAuxiliarySections` chamam o provider nas duas árvores), e o `BetSlip`/`SeuPalpite` existem em duas instâncias com estado separado (a ponte `BetSlipBridgeProvider` é uma por árvore).

Ordem no celular: cabeçalho → `PalpiteHero` → "ver análise por mercado" (`MatchCollapsible` com um `MatchCollapsible` por mercado dentro, mais "análises anteriores": acordeão dentro de acordeão) → 2 × `OddsCard` → `MatchModelReading` → `SeuPalpite` → `BetSlip` → `MatchSections` + `MatchAuxiliarySections`. No desktop a análise por mercado vem **depois** da Leitura do modelo.

Fronteiras de streaming hoje (cada uma duplicada): `MatchOddsCards` (`oddsP`, refresh da The Odds API), `MatchModelReading` (`modelReading`, leitura do banco), `SeuPalpiteSection` (`seuPalpiteP`), `BetSlipSection` (`betGridP` = modelo + odds de referência lidas depois de `oddsP`), `MatchSections`, `MatchAuxiliarySections`.

A mesma probabilidade aparece em 4 lugares: `OddsCard` ("normalizada"), `MatchModelReading` (14 seleções + placares, ~935px no celular), grade do `BetSlip` ("justa"), análise por mercado.

Avisos de responsabilidade numa tela de jogo analisado (celular):

| Onde | Texto | Arquivo |
|---|---|---|
| Fim do `PalpiteHero` | `PALPITE_DISCLAIMER` "É só um palpite, não é recomendação de aposta." | `components/palpites/palpite-hero.tsx:351-354` (ADR 0031 §5) |
| Rodapé de cada `AnalysisResult` (até 7) | `ANALYSIS_RISK_DISCLAIMER` | `components/analysis-result.tsx:248-253`, `lib/view/analysis.ts:50` |
| Fim do `SeuPalpite` | §3 completo | `components/seu-palpite.tsx:278-280` (ADR 0055 D10) |
| Abaixo da grade (só celular) | §3 completo | `components/bet-slip.tsx:358-360` |
| Fim do painel Suas apostas | §3 completo | `components/bet-slip.tsx:800-803` (ADR 0034 §12, 0036 D8) |
| Rodapé global | "Aposte com responsabilidade. Aposta não é investimento." + 18+ + CVV + JA | `components/site-footer.tsx:30-35` |

Reanálise por mercado: o `SectionFooterDispatch` existe, mas a página o usa em modo **só leitura** (`NeutralAnalysisDetail`, `page.tsx:770-790`, sem `analyzable`/`matchId`). Na tela só existem "Analisar com IA", "Analisar de novo", "Gerar/Refazer só o palpite", "Compartilhar/Copiar link/Parar de compartilhar" e "Contexto extra (opcional)", todos no `PalpiteHero`. O plano não liga a reanálise por mercado (seria feature nova); só mantém as ações que existem.

## Proposta em uma frase

Uma árvore só: cabeçalho → Palpite da IA compacto com "Ler análise completa" (análise por mercado num nível só) → abas **Mercados / Seu palpite / Dados**, com o painel **Suas apostas** fora das abas (coluna fixa à direita no desktop, barra + folha no celular). A tabela de Mercados é a grade de hoje enriquecida e substitui os cartões de odds e a Leitura do modelo. Um aviso de responsabilidade por tela: o §3 completo **uma vez**, onde se registra aposta (painel Suas apostas; no celular, também abaixo da grade, porque o painel fica numa folha modal e os dois nunca aparecem juntos); o rodapé global fica como está (selo 18+, frase curta, CVV, JA). Ver A4 e a revisão: a "linha curta no painel" da revisão de design foi trocada pelo §3 inteiro, por conservadorismo legal.

## Divisão: 2 PRs

Recomendo **2 PRs**, os dois na #576 (o primeiro "Refs #576", o segundo "Closes #576"):

- **PR A, estrutura sem mudar o produto** (linhas 24 e 19, e o palpite compacto da linha 1): uma árvore responsiva, `PageContainer`, palpite compacto + "Ler análise completa" num nível, avisos cortados com a ADR. A ordem já é a final (palpite → mercados → seu palpite → dados), mas sem abas e com os cartões de odds e a Leitura do modelo ainda na tela. Diff grande e quase mecânico, fácil de conferir lado a lado com o de hoje.
- **PR B, tabela única e abas** (resto da linha 1): estado do cupom num provider, tabela de mercados, abas com `?aba=`, Dados compacto, tour com abas, remoção de `OddsCard`/`MatchModelReading`.

Motivo: o PR B depende de tirar o painel Suas apostas de dentro do `BetSlip` (hoje um componente de 938 linhas), e isso só é seguro com uma instância só (PR A). Separar também deixa a decisão legal (ADR 0057) e o corte de avisos revisáveis sem o barulho da tabela.

### Commits do PR A

1. `docs:` ADR 0057 "Avisos de responsabilidade na página do jogo: um por tela" (texto em A4) + DESIGN.md (seção Layout: "uma árvore responsiva" no lugar de "two CSS-toggled subtrees").
2. `refactor(jogo):` uma árvore responsiva (linha 24). `MobileMatch`/`DesktopMatch` viram um `MatchLayout`; `BetSlip` e `SeuPalpite` perdem a prop `variant`; `loading.tsx` com um esqueleto só.
3. `feat(jogo):` Palpite da IA compacto + "Ler análise completa" num nível só.
4. `feat(jogo):` um aviso por tela (linha 19): sai o §3 do "Seu palpite" e a linha por `AnalysisResult`; uma linha de análise no "Ler análise completa"; guardas atualizadas. Rodapé e painel não mudam.
5. `docs:` tour, `/como-usar` e os avisos de contexto do HERO com o rótulo novo ("Ler análise completa").

### Commits do PR B

1. `feat(view):` `toBetGridView` vira a tabela de mercados (margem, chance do mercado, idade da odd, marca da IA, modo só leitura) + `getReferenceOddsForMatch` com `maxAgeMs` opcional. Testes de view.
2. `refactor(bet-slip):` estado do cupom num `BetSlipProvider` (substitui a ponte); `MarketTable`, `SlipPanel` e `SlipMobileBar` viram consumidores.
3. `feat(jogo):` tabela única de mercados; saem `OddsCard`, `MatchOddsCards`, `MatchModelReading` e seus testes/golden.
4. `feat(jogo):` abas Mercados / Seu palpite / Dados (`components/ui/tabs.tsx` sobre `radix-ui`, `?aba=`) + coluna Suas apostas.
5. `feat(jogo):` Dados compacto (bloco vazio vira uma linha).
6. `feat(tour):` passos com aba + `/como-usar`.
7. `docs:` DESIGN.md (padrão de abas) e medição final no PR.

Cada commit deixa `pnpm test`, `pnpm lint` e `pnpm typecheck` verdes; `pnpm build` no último de cada PR.

**Ponto de corte do PR B (se o diff passar de ~1.500 linhas):** os commits B1-B3 (tabela única, provider) se sustentam sozinhos, sem abas: a tabela entra no lugar dos cartões e da Leitura, com o painel ao lado como no PR A. Nesse caso B4-B7 (abas, Dados compacto, tour) viram um PR C, também na #576. Decidir na hora pelo tamanho do diff; não é obrigatório.

---

## PR A

### A2. Uma árvore responsiva (linha 24)

**`app/(app)/match/[id]/page.tsx`**
- Apagar `MobileMatch` e `DesktopMatch` (`:493-759`) e o par `lg:hidden`/`hidden lg:block` (`:383-436`). Um `MatchLayout` (no próprio arquivo) recebe o mesmo `Common` e renderiza:
  ```
  <PageContainer width="content">          // px-5 / lg:px-8, max-w-content (ADR 0056 D6)
    <h1 className="sr-only">{home} × {away}</h1>   // na página, não no MatchHero (ver abaixo)
    <MatchTopBar back={backHref} pool={caps.pool ? matchId : null} />
    <MatchHero … />
    <div className="flex flex-col gap-4 pt-4 lg:gap-6">
      <PalpiteArea …/>                      // A3
      <NotAnalyzableNotice …/>              // como hoje (unavailable && sem análise)
      <div data-tour="odds">MatchOddsCards</div>   // grid lg:grid-cols-2, como hoje
      <MatchModelReading …/>                // se modelReading (só analisável, como hoje)
      {caps.registerBets && (
        <BetSlipBridgeProvider>             // UMA ponte, envolve grade E Seu palpite
          <BetSlipSection …/>               // grade + painel (BetSlip interno)
          <SeuPalpiteSection …/>
        </BetSlipBridgeProvider>
      )}
      <div data-tour="match-stats">         // Dados
    </div>
  </PageContainer>
  ```
  A ordem é a mesma nas duas larguras (hoje o celular põe o Seu palpite antes da grade; aqui a grade vem antes, como no PR B). Sem `aria-labelledby="mercados"` no PR A: o título "mercados" da grade é um `<span>` do `BetSlip` que chega por streaming; um `div` simples basta.
- `MatchTopBar`: `BackLink` ("jogos") à esquerda, `PoolLink` à direita, numa linha `flex justify-between`. Hoje a página não usa o `BackLink` (monta o `Link` à mão, `:521-527`/`:651-657`); o `BackLink` tem `mb-6` fixo: passar `className` opcional ao `BackLink` (`components/back-link.tsx`, merge com `cn`) e usar `mb-0` aqui. Os outros 3 chamadores (`page-header.tsx`, `admin/page-heading.tsx`, `admin/users/[userId]/page.tsx`) não mudam.
- Capacidades num lugar só (encaixe do #580): `const caps = matchCapabilities(unavailableReason)` em `lib/view/match-availability.ts`, devolvendo `{ analyze, seuPalpite, registerBets, pool }` (hoje todas = `reason === null`). A página lê `caps.*` em vez de `analyzable`/`unavailableReason === null` espalhados (`:292`, `:297`, `:311`, `:344`, `:528`, `:658`). Casos novos no `lib/view/__tests__/match-availability.test.ts` **existente**. O `PalpiteHero` continua recebendo o `unavailableReason` (escolhe a copy).
- `MatchHero` (`components/match-hero.tsx:69`): tirar o `px-5 pt-5 pb-5 lg:px-0 lg:pt-0 lg:pb-0` (o gutter passa a ser do `PageContainer`; fica `pt-2 pb-2`). **O `<h1>` sr-only vai em `page.tsx`, não no `MatchHero`**: o terceiro caso de `__tests__/page-header-coverage.test.ts` ("em components/, só o PageHeader e o PageHeading do admin têm `<h1>`") quebraria com um h1 em `components/match-hero.tsx`. Em `app/(app)/match/` o teste já pula; atualizar só o comentário "PR 3" do topo do teste. Texto do h1: os nomes de `heroView.home.name`/`away.name` (nome curto depois do PR 5).
- Os componentes assíncronos passam a renderizar **uma vez**. Os comentários "UMA promise pras duas árvores" (`:145-148`, `:294-296`, `:301-305`, e o tipo `Common` `:443-444`) e os de `bet-slip-section.tsx:5-8`, `seu-palpite-section.tsx:6-8`, `match-odds-cards.tsx:12-16`, `bet-slip-bridge.tsx:8-11` são reescritos.

**`components/bet-slip.tsx`** (sai `variant`)
- Uma instância renderiza grade + painel numa grade responsiva: `<div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-4">`, o painel em `<div className="hidden lg:sticky lg:top-20 lg:block">` e a barra fixa + `Sheet` + o espaçador `h-16` (`:380-381`) com `lg:hidden`. O `SheetContent` do Radix só monta aberto, então o painel fica duas vezes no DOM só com a folha aberta no celular, e o **estado é um só** (o do componente). É um toggle de CSS pequeno e interno, não duas páginas.
- O §3 abaixo da grade (`:356-360`, hoje só na árvore celular) **fica** e ganha `lg:hidden`: no desktop o painel (com o §3) está ao lado; no celular o painel está na folha modal. Ver A4.
- Ponte (`fromBridge`, `:200-207`): trocar `variant === "mobile"` por `window.matchMedia?.("(min-width: 1024px)")?.matches === true` → desktop rola até a seção, celular abre a folha. Os `?.` são de propósito: o jsdom não tem `matchMedia` e o `seu-palpite.test.tsx` monta o `BetSlip` (sem ele, cai no ramo da folha).
- `components/bet-slip-section.tsx`, `components/seu-palpite-section.tsx`: sem `variant`.

**`components/seu-palpite.tsx`** (sai `variant`): `:240` `variant === "desktop" && "grid-cols-2 items-start"` → `lg:grid-cols-2 lg:items-start`; `:506` → `grid-cols-1 sm:grid-cols-2`.

**`components/tour/guided-tour.tsx`**: `findTarget` continua procurando o primeiro **visível** (a lista `/jogos` ainda tem duas árvores); só o comentário `:68-69` muda.

**`app/(app)/match/[id]/loading.tsx`**: um esqueleto só, na ordem nova (barra, hero, palpite `h-72`, bloco de mercados, `MatchSectionsSkeleton`, `MatchAuxiliarySkeleton`), dentro do `PageContainer`.

**Testes**: `components/__tests__/seu-palpite.test.tsx` (tira `variant`, `:104`, `:238-321`; com uma instância, a barra fixa "Suas apostas (N)" e o painel convivem no DOM do jsdom, então consultas por texto podem achar dois nós: trocar por `getAll…`/escopo onde precisar); novo teste de fonte `app/(app)/match/[id]/__tests__/single-tree.test.ts`: `page.tsx` e `loading.tsx` não contêm `lg:hidden` nem `hidden lg:block` (trava a volta das duas árvores); `lib/view/__tests__/match-availability.test.ts` (existente) cobre `matchCapabilities`; `__tests__/page-header-coverage.test.ts` segue verde sem mudar a lista de `components/` (o h1 está em `page.tsx`).

### A3. Palpite da IA compacto e "Ler análise completa" num nível só

**Firewall da ADR 0030 continua de pé**: o `<section aria-label="palpite">` do `PalpiteHero` não ganha número de valor. A análise por mercado (com odd, vantagem, stake) fica num bloco **irmão**, logo abaixo, nunca dentro da casca quente.

- **Novo `components/palpites/palpite-area.tsx`** (`"use client"`): guarda `open` (fechado por padrão) e renderiza
  1. `<PalpiteHero … expanded={open} />`;
  2. o botão "Ler análise completa" / "Fechar análise completa" (`Button type="button" variant="ghost" size="sm"`, fora do `<form>` do HERO, `aria-expanded`, `aria-controls="analise-completa"`), só quando há palpite **ou** análise (`heroPalpite !== null || sections.length > 0`);
  3. `<div id="analise-completa" role="region" aria-label="Análise completa" hidden={!open}>{analysis}</div>`, onde `analysis` é um `ReactNode` montado no servidor (slot). `hidden` em vez de desmontar: o texto fica no DOM (busca do navegador, leitor de tela ao abrir) e o estado não se perde.
- **`PalpiteHero`** ganha `expanded?: boolean` (default `true`, para os testes e qualquer outro chamador continuarem iguais). Com `expanded=false`:
  - narrativa com `line-clamp-2` (`:312`; o texto inteiro continua no DOM);
  - `citedMarkets` (`:316-320`), `DimensionScorecard` (`:322`) e `CitedSources` (`:324`) só com `expanded`;
  - ficam sempre: kicker + confiança/selo, veredito, placar provável/recibo, a linha de ações (Analisar de novo, Refazer só o palpite, Compartilhar), "Contexto extra (opcional)" e o `PALPITE_DISCLAIMER` (ver A4).
  - O `EmptyHero` e o `PendingHero` não mudam.
- **Novo `FullAnalysis`** (servidor, em `components/full-analysis.tsx`): substitui `NeutralAnalysisDetail` (`page.tsx:770-790`). Ordem: `AnalysisUserContext` ("o que você acrescentou") → **uma** linha `ANALYSIS_RISK_DISCLAIMER` logo antes do primeiro mercado (ver A4: perto da recomendação, à vista assim que abre, e não 2.000px abaixo) → `MarketAnalysisSections layout="flat" showRiskDisclaimer={false}` → `PreviousAnalyses showRiskDisclaimer={false}`. Título da região: `h2` sr-only "Análise completa" (os mercados são `h3`).
- **`components/market-analysis-section.tsx`**: prop `layout?: "collapsible" | "flat"` (default `"collapsible"`; hoje o único chamador é a página do jogo, mas o default preserva os testes). `flat`: cada mercado (inclusive quando há um só) é um cabeçalho (`h3` com `marketLabel` + `sectionMeta` à direita, mono só no número) seguido do `AnalysisResult` aberto. Prop `showRiskDisclaimer` repassada a cada `AnalysisResult` (a prop já existe em `analysis-result.tsx:16`, usada hoje pelo fan-out). Nenhum acordeão dentro do "Ler análise completa".
- **`PreviousAnalyses`** recebe `showRiskDisclaimer` também. Fica como **um** `MatchCollapsible` no fim (é histórico, não a análise). É a única divulgação dentro da análise aberta; ver questão Q10.
- Tour (`lib/tour/steps.ts`, passo `palpite`): "Depois, \"ver análise por mercado\" abre…" → "\"Ler análise completa\" abre o porquê inteiro e o detalhe de cada mercado…".
- Avisos do HERO depois de analisar com contexto (`lib/user-palpite/analysis-context.ts:157-160`, `CONTEXT_APPLIED_NOTICE` e `CONTEXT_NO_EFFECT_NOTICE`): "Veja … em \"ver análise por mercado\"" → "em \"Ler análise completa\"". É texto de tela (o `contextNotice` do `PalpiteHero`), não prompt. Testes que fixam a frase: `components/__tests__/palpite-hero.test.tsx:617`, `lib/user-palpite/__tests__/analysis-context.test.ts`, `app/actions/__tests__/predictions-best-bet.test.ts` (conferir cada um).

**Testes**: `components/__tests__/palpite-hero.test.tsx`: com `expanded=false` a narrativa tem `line-clamp-2` e não há "e ainda"/"o palpite leu"; o disclaimer e os botões continuam; a firewall (`containsValueLanguage` no HTML) segue valendo nos dois modos. Novo `components/palpites/__tests__/palpite-area.test.tsx`: botão só com palpite ou análise; `aria-expanded`/`hidden` alternam; o slot não fica dentro do `section[aria-label=palpite]`. `market-analysis-section` (novo teste ou no existente): `flat` não renderiza `MatchCollapsible` e repassa `showRiskDisclaimer`.

### A4. Um aviso por tela (linha 19) e a ADR 0057

**Leitura da ADR 0048 (refeita na revisão).** A Decisão 1 diz que o art. 17 da Lei 14.790 e a Portaria 1.231 **não se aplicam** ao Palpiteiro; a Decisão 4 adota o núcleo deles **voluntariamente** e lista onde os avisos ficam. A ADR 0053 (item 7) **atualizou as referências da 0048 D4**: o "aviso de risco na aposta" passou a ser o §3 completo do `components/bet-slip.tsx` (e de `/apostas`), "renderizado junto da lista e da avaliação", e a 0053 lista o "disclaimer §3 completo" entre o que fica intacto. O report 11 (A7) marca como OK "avisos de risco nas superfícies de intenção de aposta" (análise, registro de aposta, `/apostas`, `/p`). A ADR 0034 §12 chama o §3 completo na tela de avaliação/registro de **inegociável** ("tela de máxima intenção de apostar", `docs/ops/05-legal-compliance.md:117`). Conclusão: o §3 completo no painel Suas apostas é texto que a 0048 (como atualizada pela 0053) marca como adotado. **Não sai.** O rodapé com a "frase curta" é exatamente o que o compliance §3 pede para o footer ("selo + frase curta de jogo responsável"). **Não muda.**

O que pode sair sem tocar em nada que a 0048/report 11 marca: o §3 repetido do "Seu palpite" (ADR 0055 D10, uma ADR de feature; o bloco não tem odd nem valor e fica na mesma tela do §3 do registro) e a repetição da linha de análise em cada `AnalysisResult` (fica **uma** linha por análise aberta, como o fan-out já faz, `lib/view/analysis.ts:42-49`; a 0048 D4 pede "avisos de risco na análise", não um por cartão).

**ADR 0057 (`docs/decisions/0057-avisos-da-pagina-do-jogo-um-por-tela.md`)**, emenda 0055 D10; reafirma 0031 §5, 0034 §12, 0036 D8, 0053 item 7 e 0048 D4 (não os emenda):
1. Na página do jogo, o §3 completo e verbatim (`docs/ops/05-legal-compliance.md:102-105`) aparece **uma vez por tela visível**, onde se registra aposta: no painel Suas apostas (coluna no desktop, folha no celular) e, no celular, também abaixo da grade (PR A) / abaixo das abas (PR B), porque a folha é modal e cobre a página: os dois nunca ficam à vista juntos. Só existe quando há registro (`caps.registerBets`).
2. O "Seu palpite" deixa de ter aviso próprio (emenda 0055 D10). Continua sem odd, edge, stake ou valor e sem "apostar"/"cupom" (guardas de hoje).
3. A análise aberta ("Ler análise completa") traz **uma** linha `ANALYSIS_RISK_DISCLAIMER`, logo antes do primeiro mercado; nenhuma por mercado nem nas análises anteriores.
4. `PALPITE_DISCLAIMER` fica na manchete (ADR 0031 §5; mesmo texto do `/p`): é rótulo de natureza do conteúdo, não aviso de responsabilidade.
5. O rodapé global não muda (18+, "Aposte com responsabilidade. Aposta não é investimento.", CVV 188, Jogadores Anônimos, "não é casa de apostas").
6. `/p/[id]` não muda (ADR 0035). `/apostas`, bolão e landing ficam para os PRs 4 e 6, com a mesma regra (o §3 uma vez onde se registra/lista aposta).
7. Alternativa rejeitada: a proposta da revisão de design (rodapé com o §3 e uma linha curta no painel). Tiraria da tela de máxima intenção "nunca para recuperar perdas" e "procure ajuda"; no celular a folha modal esconde o rodapé no momento de registrar; exigiria emendar 0034 §12, 0036 D8, 0053 item 7 e as referências da 0048 D4 por um ganho de ~60px; e mudaria o rodapé de todas as telas (landing e `/signin` incluídas), fora do escopo deste PR. Reabrir só com ADR nova, se o dono quiser.

**Código**
- `components/bet-slip.tsx`: o §3 do painel (`:800-803`) e o abaixo da grade (`:356-360`, agora `lg:hidden`, A2) **ficam**; só o comentário `:356-357` é reescrito (cita a ADR 0057 item 1). Constante local `RISK_DISCLAIMER_PT_BR` igual.
- `components/seu-palpite.tsx`: apagar `:278-280` e a constante `:48-50`; o comentário do topo (`:45-46`, "o aviso de risco fica à vista") passa a citar a ADR 0057.
- `components/full-analysis.tsx`: uma linha `ANALYSIS_RISK_DISCLAIMER` (mesmo estilo de `analysis-result.tsx:248-253`, com o ícone `Info`).
- `components/site-footer.tsx`, `lib/view/bet-slip.ts`: **sem mudança** (sai do plano o `RISK_LINE_SHORT`).

**Testes**
- `components/__tests__/bet-slip-guards.test.ts`: sem mudança no PR A (o componente continua renderizando `{RISK_DISCLAIMER_PT_BR}` verbatim).
- `components/__tests__/seu-palpite-guards.test.ts`: o primeiro `describe` vira "não renderiza aviso de risco próprio (ADR 0057; o §3 fica no registro de apostas)": nenhum `RISK_DISCLAIMER_PT_BR` nem trecho do §3 no arquivo; o filtro da constante no `describe.each` sai.
- Novo `app/(app)/match/[id]/__tests__/one-notice.test.ts` (fonte): `seu-palpite.tsx`, `full-analysis.tsx`, `market-analysis-section.tsx` e `page.tsx` não renderizam o §3; o §3 só é renderizado por `components/bet-slip.tsx` (PR B: `components/bet-slip/*`); `ANALYSIS_RISK_DISCLAIMER` aparece uma vez no caminho da página (em `full-analysis.tsx`) e `market-analysis-section.tsx`/`previous-analyses.tsx` repassam `showRiskDisclaimer`.
- `components/__tests__/analysis-result.test.tsx:380` já cobre `showRiskDisclaimer={false}`.

### A5. Tour e `/como-usar`

- `lib/tour/steps.ts`: só o texto do passo `palpite` (A3). Alvos iguais.
- `app/(app)/como-usar/como-usar-content.tsx`: "ver análise por mercado" (`:202`, `:228`) → "Ler análise completa"; "O palpite aparece no topo e o detalhe de cada mercado fica logo abaixo" (`:185`) → "…e \"Ler análise completa\" abre o detalhe de cada mercado"; `:221-224` ("Embaixo aparecem os mercados que ele usou e … os links das fontes") passa a dizer que os mercados usados, a ficha e as fontes aparecem ao abrir "Ler análise completa"; `:228-235` sem "acordeão".
- `app/(app)/como-usar/__tests__/como-usar-content.test.tsx`: na lista de rótulos, `"ver análise por mercado"` → `"Ler análise completa"` (o literal mora em `components/palpites/palpite-area.tsx`, que o teste varre).
- Comentários que citam "ver análise por mercado" (`components/analysis-user-context.tsx:6`, `components/market-analysis-section.tsx:83`, `lib/view/analysis-user-context.ts:16`, `lib/bets/analysis-probs.ts:5`, `lib/ai/palpites/synthesis-input.ts:73`): atualizar de passagem; o de `synthesis-input.ts` é comentário de código, não texto de prompt (conferir antes de mexer).

### Medida esperada do PR A

Celular, jogo analisado com palpite e 5 mercados: ~6.460px → **~6.000px** (palpite de ~850 para ~500, −1 aviso do Seu palpite ~70, "ver análise" vira o botão; o §3 abaixo da grade fica). O ganho grande vem do PR B.

---

## PR B

### B1. A grade vira a tabela de mercados (view pura)

Hoje a grade (`lib/view/bet-slip.ts:toBetGridView`) já tem, por seleção: odd de referência, chance (a da sua análise daquele mercado, senão o modelo do jogo) e odd justa. Falta o que os cartões de odds e a Leitura do modelo mostram: idade da odd, margem, chance do mercado sem a margem, fonte do modelo e "calculado há". Mais a marca da IA.

- `GridSelectionView` ganha `aiPick: boolean` (a última análise daquele mercado recomendou esta seleção). Fonte: `latestAnalysisByMarket` (`lib/bets/analysis-probs.ts`) passa a guardar `recommendation: string` (vem de `prediction.recommendation`, `db/schema.ts:364`; `"pass"` = nenhuma marca). Comparação por `legMarketPin(kind, params).selectionKey` (o mesmo mapeamento já usado para as probs; a dupla chance usa `home_draw` na grade e `home_or_draw` na leitura do modelo, então **nunca** comparar por rótulo).
- `GridGroupView` ganha:
  - `probSource: "analysis" | "model" | null` (por mercado, já que a análise é por mercado);
  - `odds: { updatedAgo: string; margin: string; impliedPct: string[] } | null`. A **chance do mercado** sai da `ReferenceMarket` com `computeMarketScenarios` + o descriptor do mercado, **igual ao `evaluate-slip.ts:132-162`** (`referenceFor`): mercado completo (`descriptor.selectionKeys`, todas com odd > 1) ou nada; `impliedSumTarget` do descriptor (2 na dupla chance, então as três somam 200%); `marketKind` do descriptor. A **margem** é `Σ(1/odd) ÷ alvo − 1`: com alvo 1 é o `overround` de `computeMarketImpliedProbabilities` (`lib/odds/implied-probability.ts:25-38`, Σ − 1); na dupla chance cada resultado entra duas vezes, então `Σ − 2` mostraria a margem **em dobro** (≈10% para um 1X2 de 5%). Por isso a fórmula divide pelo alvo; teste dedicado. O `evaluate-slip.ts` não calcula margem: a fórmula é nova e fica numa função pura em `lib/odds/` (perto do core), não na view. Nunca `1/odd` cru como probabilidade (CLAUDE.md, ADR 0018). Formatado com `lib/format` (vírgula pt-BR).
- `BetGridView` ganha `mode: "register" | "readOnly"`, `oddsHeading: "Odds de mercado" | "Odds antes do jogo"` e `model: { label: string; computedAgo: string | null } | null`.
  - **Correção da revisão:** o rótulo do modelo tem que descrever o modelo que **gerou os números da grade**, e esse vem de `resolveSlipModel` (`lib/bets/slip-model.ts`), não da `MatchModelReadingView`. Os dois divergem: `getMatchModelScoreline` (`lib/model-base/model-scoreline.ts`) recusa base de outra versão, mais velha que `MODEL_SCORELINE_MAX_AGE_MS` ou de jogo já começado e aí a grade usa o cálculo na hora, enquanto `loadMatchModelReading` mostra a última base sem esses filtros. Ler o "calculado há 3h" da leitura nesse caso seria falso.
  - Como: `getMatchModelScoreline` passa a devolver também `baseCheckedAt` (campo opcional novo em `ModelScoreline`, `lib/quant/match-model.ts:25`; o cálculo na hora não o preenche). Com `baseCheckedAt`: `label` = fonte + JEV da leitura (`source`, `jev`, que vêm da mesma linha de `match_model_snapshots`) e `computedAgo` de `baseCheckedAt`. Sem: `label` = `modelSourceLabel(model.source, model.degraded)` (o `modelLabel` de hoje) e `computedAgo: null`. Sem modelo: `model: null`.
- Modo só leitura (jogo que começou, adiado, cancelado, encerrado): `toBetGridView({ …, model: null, mode: "readOnly" })` com `getReferenceOddsForMatch(matchId, now, { maxAgeMs: null })` (sem o corte de 48h de `REFERENCE_MAX_AGE_MS`, porque hoje o `OddsCard` mostra a última captura de qualquer idade). Sem `topScores`, sem botões.
- `lib/db/queries/reference-odds.ts`: terceiro parâmetro opcional `{ maxAgeMs?: number | null }` (default = `REFERENCE_MAX_AGE_MS`, nada muda para o cupom).
- `page.tsx`: `betGridP` passa a existir **sempre** (register ou readOnly) e junta `modelReading` (só em `caps.registerBets`). `oddsP` continua sendo o gatilho do refresh (`ensureOddsSnapshotsFresh`, mesmo `PAGE_LIVE_MARKETS`, nenhuma chamada nova) e deixa de montar `OddsView`: vira `refreshP: Promise<void>`, com o mesmo `.catch` de hoje (`:172-184`) para erro de banco não derrubar a página.
- Perda aceita: num mercado que o usuário já analisou, a chance crua do Dixon-Coles (que a Leitura do modelo mostra hoje para todos os mercados) deixa de aparecer; a tabela mostra a da análise (como a grade já faz) e marca "pela sua análise". A análise completa continua com os números dela.

**Testes** (`lib/view/__tests__/bet-slip.test.ts`): chance do mercado do 1X2 e do total batem com `computeMarketImpliedProbabilities`; margem com alvo 1 = `overround`; dupla chance: chances somam 200% e a margem de um board derivado de um 1X2 de 5% sai ≈5% (não 10%); mercado incompleto → `odds: null`; `aiPick` só na seleção recomendada, só se a linha bater no total, e nunca em `pass`; `probSource` por mercado; modo `readOnly` sem `topScores`; `model.computedAgo` só quando o modelo veio da base (`baseCheckedAt`), `null` no cálculo na hora; paridade: **quando o modelo veio da base** e o mercado não foi analisado, a chance de cada seleção na grade é a mesma da `toMatchModelReadingView` (±0,1 ponto). `lib/model-base/__tests__/model-scoreline.test.ts`: `baseCheckedAt` preenchido. `lib/db/queries/__tests__` (se houver teste do reader): `maxAgeMs: null` devolve captura velha. `lib/bets/__tests__/analysis-probs*`: `recommendation` preservada.

### B2. Estado do cupom num provider

Para o painel ficar fora das abas e o "Adicionar às suas apostas" do Seu palpite funcionar de qualquer aba, o estado sai do `BetSlip`.

- **Novo `components/bet-slip/bet-slip-provider.tsx`** (`"use client"`): `legs`, `mode`, campos da combinada, `parseMeta`, `notice`, `sheetOpen`, os dois `useActionState` (`registerBetSlip`, `parseBet`) e os efeitos de hoje (`bet-slip.tsx:99-297`). Expõe `toggle`, `addFromBridge(leg)`, `registerGrid(grid)` e o `payload`. `byId` vem da grade registrada; antes de a grade chegar (streaming), `addFromBridge` devolve `"unavailable"`, igual à ponte de hoje.
- `components/bet-slip-bridge.tsx` some: `useBetSlipBridge()` vira um alias de `useBetSlip()` (devolve `{ add }`), para o `seu-palpite.tsx:118-121` mudar uma linha. `slipFullNotice` e `BridgeAddOutcome` mudam de arquivo.
- `components/bet-slip.tsx` é quebrado em `components/bet-slip/market-table.tsx` (B3), `slip-panel.tsx` (painel + `Evaluation`, sem estado próprio), `slip-mobile-bar.tsx` (barra fixa + `Sheet` + espaçador, `lg:hidden`), `risk-notice.tsx` (o §3: **uma** constante local `RISK_DISCLAIMER_PT_BR`, usada pelo painel e pela linha do celular abaixo das abas, B4) e `bet-slip-provider.tsx`. As strings travadas pelo `bet-slip-guards.test.ts` ("Registrar apostas", nenhum "Apostar"/"cupom") passam a ser lidas de `components/bet-slip/*.tsx`; o guarda troca `COMPONENT` por uma lista, e o caso do §3 lê `risk-notice.tsx` (`{RISK_DISCLAIMER_PT_BR}` + cópia verbatim) e confere que `slip-panel.tsx` renderiza o `<SlipRiskNotice />`. A ADR 0053 item 7 cita `components/bet-slip.tsx` como dono da constante: atualizar a referência na ADR 0057 (não precisa reabrir a 0053).
- Ao adicionar pela ponte: celular abre a folha (como hoje); no desktop **nada além da mensagem que o Seu palpite já mostra** ("Adicionado em Suas apostas.", `seu-palpite.tsx:65-70`): o painel está à vista na coluna. (Cortado da versão anterior: o destaque com `ring` de 1,5s; enfeite sem pedido da revisão.)

**Testes**: `components/__tests__/seu-palpite.test.tsx` (`:238-321`) monta `BetSlipProvider` + `MarketTable` + `SlipPanel` em vez de `BetSlipBridgeProvider` + `BetSlip`; casos "added/duplicate/full/unavailable" iguais. Novo `components/bet-slip/__tests__/bet-slip-provider.test.tsx`: uma seleção por mercado, vários placares, limite `MAX_SLIP_SELECTIONS`, limpar depois de registrar, duas instâncias do `SlipPanel` mostram o mesmo estado.

### B3. Tabela única de mercados

**`components/bet-slip/market-table.tsx`** (client; substitui `MarketGrid`/`SelectionButton`):
- Topo: o rótulo "Mercados" fica na aba (não repete; o `SectionHeading` "mercados" sai). Fica a frase de instrução de hoje (`bet-slip.tsx:393-395`, "Toque nas seleções que você apostou, confira a odd que pegou e registre. A avaliação sai na hora, sem gastar análise do dia."), só em `register`. Uma linha de legenda: "odd de mercado · chance do modelo · odd justa", com `HelpHint` (âncoras `prob-implicita`, `leitura-modelo`, `overround` de hoje) e, quando há análise, "Nos mercados que você analisou, a chance é a da análise da IA."
- Por mercado (`MarketRow`): título à esquerda (`text-meta uppercase tracking-label`); à direita, quando `probSource === "analysis"`, "pela sua análise".
- Célula (o botão de hoje, `aria-pressed`, `min-h-11`, invertida quando marcada — o que a revisão pediu para manter):
  1. rótulo (`line-clamp-1`, `title` com o nome inteiro);
  2. odd de mercado (`font-mono text-body-sm font-medium tabular-nums`), ou "—";
  3. `47,8% · 2,13` (`font-mono text-meta tabular-nums text-muted-foreground`): chance do modelo e odd justa. Sem odd de mercado, a linha 2 vira a justa em cinza (como hoje) e a 3 só a chance.
  - Nome acessível: três números soltos não dizem nada ao leitor de tela. Cada número leva um rótulo `sr-only` ("odd de mercado 2,10", "chance do modelo 47,8%", "odd justa 2,13"), ou o botão ganha `aria-label` montado na view.
  - `aiPick`: borda `border-edge-border` + o `Badge` existente (tamanho `xs`, `bg-edge-soft text-edge-fg border-edge-border`, `Sparkles` 12px + "IA"; sem chip feito à mão, DESIGN.md) no canto, e `<span className="sr-only">recomendada pela análise da IA</span>`. O fundo próprio (`edge-soft`) é o que mantém o contraste com a célula marcada (`bg-foreground`): `text-edge-fg` direto sobre `bg-foreground` não passa no claro. Texto descritivo, nunca imperativo ("recomendada pela análise", não "aposte"; ADR 0034 §12).
- Rodapé de cada mercado com odd (uma linha `text-meta`): "sem a margem: 45% · 28% · 27% · margem 5,2% · há 12 min" + `HelpHint` da margem. É onde a chance do mercado normalizada e o overround dos cartões de hoje vão morar; a idade fica por mercado porque cada um tem a própria captura.
- Placar exato e "ou digite sua aposta" iguais a hoje (só `mode === "register"`).
- Rodapé da tabela: "chances pelo modelo Dixon-Coles + JEV · calculado há 3h" (`model`), ou "A chance do modelo aparece quando o cálculo do jogo rodar (a cada 6h, até 7 dias antes)." (texto da Leitura do modelo de hoje) quando `model === null` em jogo analisável; "Odds antes do jogo" no modo só leitura; "Odds indisponíveis" + "fonte: the-odds-api" quando nenhum mercado tem captura (texto do `OddsCard`, `odds-card.tsx:31-37`, por motivo).
- `readOnly`: células são `<div>`, não `<button>`; sem placar exato nem texto livre.
- Registra a grade no provider (`useEffect(() => registerGrid(grid), [grid])`).

**Remoções**: `components/odds-card.tsx`, `components/match-odds-cards.tsx`, `components/match-model-reading.tsx`, `MatchOddsSkeleton`, `toOddsView`/`toNwayOddsView` em `lib/view/odds.ts` (se nada mais usar; `toMatchRowOdds` fica) e os testes `odds-card-parity.golden.test.tsx`, `odds-card-nway.test.tsx`, `match-odds-cards.test.tsx`, `match-model-reading.test.tsx`, partes de `lib/view/__tests__/odds.test.ts`. `loadMatchModelReading` e `toMatchModelReadingView` ficam (fonte/JEV/"calculado há"); o array `markets` fica sem uso na tela (follow-up para enxugar o tipo; não bloqueia).
- `components/analysis-scenarios.tsx:173`: "as atuais estão no card acima" → "as atuais estão na aba Mercados" (+ `components/__tests__/analysis-scenarios.test.tsx:336`). Comentários em `lib/format.ts:293` e `lib/view/analysis.ts:366`.

**Testes** novos em `components/bet-slip/__tests__/market-table.test.tsx`: cada célula mostra odd, chance e justa formatadas em pt-BR; a marca "IA" + texto `sr-only` só na seleção recomendada; rodapé do mercado com margem e "há"; `readOnly` sem `<button>`; jogo sem odds mostra o aviso por motivo; teclado (Tab/Enter/Espaço) alterna `aria-pressed`.

### B4. Abas e a coluna Suas apostas

**Primitivo**: `components/ui/tabs.tsx` no molde shadcn sobre `radix-ui` (já é dependência, `package.json:35`): `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`. O Radix já dá `role=tablist/tab/tabpanel`, `aria-selected`, `aria-controls`, foco itinerante (tabindex 0 só na ativa) e setas/Home/End. `activationMode="automatic"` (o conteúdo já está renderizado, trocar é instantâneo). `TabsContent` com `forceMount` + **o atributo `hidden={tab !== value}`** (não a classe `data-[state=inactive]:hidden`): **todas as abas ficam montadas**, porque (a) o estado do Seu palpite e da tabela não pode se perder ao trocar, (b) o tour precisa dos alvos no DOM, (c) o conteúdo streama uma vez só. Por que o atributo: com `forceMount` o Radix passa `hidden={false}` ao painel inativo; o `{...contentProps}` vem depois no spread, então o nosso `hidden` vence. O atributo tira o painel da árvore de acessibilidade, o preflight do Tailwind v4 já dá `display:none` a `[hidden]`, e o jsdom enxerga (os testes do tour simulam visibilidade por `this.hidden`, `components/tour/__tests__/guided-tour.test.tsx:32-37`; uma classe CSS não aparece no jsdom). Conferir no Radix instalado que o spread continua depois do `hidden`.

**`lib/view/match-tabs.ts`** (puro, vai pro bundle do cliente): `MATCH_TABS = [{ id: "mercados", label: "Mercados" }, { id: "seu-palpite", label: "Seu palpite" }, { id: "dados", label: "Dados" }]`, `type MatchTab`, `parseMatchTab(raw): MatchTab` (default `"mercados"`), `MATCH_TAB_PARAM = "aba"`. Os painéis levam `scroll-mt-28` (cabeçalho `h-14` + tablist sticky): o `scrollIntoView({ block: "start" })` do tour e do "Ler análise completa" não para com o topo do alvo debaixo das duas barras.

**`components/match-tabs.tsx`** (`"use client"`): recebe `initialTab` e três slots (`ReactNode` montados no servidor, cada um com o próprio `Suspense`). Estado local; ao trocar, `window.history.replaceState(null, "", url)` com `?aba=` (preservando `back`; mesmo padrão do `guided-tour.tsx:160-162`, que o Next 15 sincroniza com `useSearchParams`). **Sem navegação de servidor**: a página é `force-dynamic` e refaria `auth`, banco e o refresh de odds a cada troca. `replaceState` e não `pushState`, para o Voltar sair do jogo e não passear pelas abas. O `TabsList` é `sticky top-14 z-30 bg-background/95 backdrop-blur` (abaixo do cabeçalho `sticky top-0 z-40 h-14`, `components/app-shell.tsx:65-66`; o sticky só vale dentro do `Tabs`, que envolve os painéis, e nenhum ancestral tem `overflow`) e rolável na horizontal se faltar espaço. Escuta o evento do tour (B6). Os rótulos ficam em `MATCH_TABS`; o `SeuPalpite` perde o eyebrow "seu palpite" (`seu-palpite.tsx:227-229`), que repetiria a aba (a frase de apoio fica).

**`page.tsx`** lê `searchParams.aba` (`PageProps.searchParams` ganha `aba?: string`) e passa `parseMatchTab(aba)` como `initialTab`: o SSR já sai com a aba certa visível (sem pulo). Depois de uma action com `revalidatePath`, o estado local da aba se mantém (mesmo lugar na árvore).

**Árvore final**
```
page.tsx (server)
└ PageContainer width="content"
  ├ MatchTopBar (BackLink "jogos" · PoolLink se caps.pool)
  ├ h1 sr-only
  ├ MatchHero (TeamCrest do PR 5; placar final/parcial; hora/contagem)
  └ BetSlipProvider (client)
     ├ div  lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-6
     │  ├ div.flex.flex-col.gap-4                                  (coluna principal)
     │  │  ├ PalpiteArea (client)
     │  │  │  ├ PalpiteHero expanded={open}            [data-tour=palpite]
     │  │  │  ├ botão "Ler análise completa"
     │  │  │  └ #analise-completa ← FullAnalysis (server)
     │  │  ├ NotAnalyzableNotice (server, se couber)
     │  │  ├ MatchTabs (client) initialTab        (data-tour no TabsContent, FORA do Suspense)
     │  │  │  ├ Mercados    [data-tour=mercados]  Suspense(MarketTableSkeleton) → MarketTableSection(await betGridP) → MarketTable
     │  │  │  ├ Seu palpite [data-tour=seu-palpite] Suspense(SeuPalpiteSkeleton) → SeuPalpiteSection | linha "fecha no apito"
     │  │  │  └ Dados       [data-tour=match-stats] Suspense → MatchSections · Suspense → MatchAuxiliarySections
     │  │  └ SlipMobileRiskNotice (lg:hidden por dentro; se caps.registerBets)  ← o §3 do celular, abaixo de qualquer aba (A4 item 1)
     │  └ SlipAside (aside hidden lg:block por dentro; se caps.registerBets) → div.sticky.top-20 → SlipPanel (com o §3)
     └ SlipMobileBar + Sheet(SlipPanel)  lg:hidden  (se caps.registerBets)
GuidedTour chapter="jogo"
```
- Mesma ordem no celular e no desktop (o `aside` é o último no DOM). O par `hidden lg:block`/`lg:hidden` sobra só para o painel (coluna × folha) e o §3 do celular, com um estado só. **Essas classes ficam dentro de `components/bet-slip/*`** (`SlipAside`, `SlipMobileBar`, `SlipMobileRiskNotice`), não em `page.tsx`: o teste `single-tree.test.ts` do PR A proíbe `lg:hidden`/`hidden lg:block` em `page.tsx` e continua valendo no PR B.
- Palpite na coluna principal (≈610px: 1040 − 2×32 de gutter − 340 − 24 de gap; cabe no `max-w-reading`), não em largura cheia: o painel Suas apostas fica à vista ao lado dele e de todas as abas.
- Jogo não analisável: sem `aside` e sem o §3 (não há registro, como hoje), a grade vira uma coluna; a aba Seu palpite mostra uma linha ("O Seu palpite fica aberto até o apito inicial."; "registrar" é o verbo das apostas, não do Seu palpite) em vez de sumir (estrutura estável para o #580).
- `data-tour` nos `TabsContent` (sempre montados, fora do `Suspense`): o passo do tour conta como disponível antes de a tabela chegar por streaming. Sai o `data-tour="seu-palpite"` do `<section>` do `SeuPalpite` (`seu-palpite.tsx:225`), para não haver dois alvos iguais. Nenhum `data-tour="suas-apostas"` (nenhum passo usa; a versão anterior marcava sem passo).
- `GuidedTour` fica fora do `BetSlipProvider` (não consome).

**Fronteiras de streaming depois**: `betGridP` (refresh de odds → referências + modelo + leitura do modelo), `seuPalpiteP`, `MatchSections`, `MatchAuxiliarySections`. Uma vez cada (hoje duas). A tabela espera o mais lento entre o refresh de odds e a leitura do modelo; antes a Leitura do modelo podia aparecer antes das odds. Aceito: a grade já esperava o refresh.

**Testes**: `components/__tests__/match-tabs.test.tsx`: `initialTab` vem do parse; só a aba ativa sem o atributo `hidden`; troca atualiza `?aba=` com `replaceState` e preserva `back`; setas movem o foco e ativam; as três abas ficam montadas. `lib/view/__tests__/match-tabs.test.ts`: `parseMatchTab` (valor válido, inválido, ausente, array).

### B5. Dados compacto

- `components/match-sections.tsx` e `components/match-sections-auxiliary.tsx`: bloco **vazio** vira uma linha `DataEmptyLine` (novo `components/data-empty-line.tsx`): `flex justify-between border-b border-border-subtle py-3`, título `text-body` à esquerda, motivo `text-body-sm text-muted-foreground` à direita ("sem jogos recentes", "nenhum confronto recente", "classificação indisponível", "nenhuma baixa reportada", "dados indisponíveis", "ainda não divulgadas"). Os textos saem dos `EmptyState` de hoje (`form-section.tsx:14`, `h2h-section.tsx:13`, `standings-section.tsx:17`, `match-sections-auxiliary.tsx:106-125`). Para isso as views decidem antes de montar o `MatchCollapsible` (`toFormView`, `toH2HView`, `toStandingsView` já dizem se há linhas).
- Bloco com dado fica como hoje (`MatchCollapsible`; forma/H2H/classificação abertos, desfalques/escalações fechados). No desktop, forma e H2H lado a lado (`lg:grid-cols-2`) como hoje.
- `components/skeletons/match-sections-skeleton.tsx`: sem mudança de forma.
- "mandante"/"visitante" dos desfalques e escalações (`match-sections-auxiliary.tsx:149`, `:182`) ficam (texto, não 1X2).

**Testes**: `components/__tests__/match-sections-empty.test.tsx`: view vazia → uma linha com título + motivo, sem `Card`; view cheia → `MatchCollapsible`.

### B6. Tour com abas e `/como-usar`

**Decisão**: o tour **troca de aba** para mostrar o conteúdo real (em vez de só destacar o botão da aba).
- `lib/tour/steps.ts`: `TourStep.tab?: string` (o id da aba; import de tipo de `lib/view/match-tabs.ts`) e `TOUR_TAB_EVENT = "palpiteiro:tour-tab"`. Capítulo `jogo`:
  1. `palpite` (sem aba) — texto do PR A.
  2. `mercados` (aba `mercados`), substitui `bet-slip` e `odds`: "Na aba Mercados ficam a odd de mercado, a chance do modelo e a odd justa de cada seleção; a marca IA mostra o que a análise recomenda. Toque no que você apostou: entra em Suas apostas (ao lado no computador, na barra de baixo no celular). Confira a odd que pegou e toque em \"Registrar apostas\"…"
  3. `seu-palpite` (aba `seu-palpite`), texto de hoje.
  4. `match-stats` (aba `dados`): "Na aba Dados: partidas recentes, confronto direto…".
  5. "Pronto" (sem alvo).
- `components/tour/guided-tour.tsx`:
  - `availableSteps`: passo com `tab` conta como disponível se o alvo **existe** no DOM (`document.querySelector`), mesmo escondido; sem `tab`, a regra de hoje (primeiro visível).
  - **Correção da revisão (onde disparar o evento):** a versão anterior disparava o evento dentro do efeito de troca de passo (`:198-215`) e contava com `flushSync` no ouvinte para o alvo já estar visível no `findTarget` seguinte. Não é confiável: o React não garante o `flushSync` chamado de dentro de um efeito (avisa "flushSync was called from inside a lifecycle method" e pode adiar o render), então o `findTarget` pode rodar com o painel ainda `hidden`. Conferir com um teste antes de descartar de vez, mas o desenho abaixo não depende disso. Em vez disso, um helper `goTo(i)` dispara `window.dispatchEvent(new CustomEvent(TOUR_TAB_EVENT, { detail: steps[i].tab }))` (se o passo tem `tab`) e só então chama `setIndex(i)`. O `goTo` é usado nos três lugares que mudam o passo: o timer de partida (`:185-191`), o "Próximo" (`next`) e o "Voltar" (`prevIndex`). São handler de clique e `setTimeout`, onde o `flushSync` do ouvinte do `MatchTabs` vale. Quando o efeito de troca de passo roda, o painel já está visível. Em outra página ninguém escuta e o passo segue a regra de hoje.
  - Rede de segurança que já existe: o `measure` (`:226-231`) refaz o `findTarget` se o alvo ficar sem `getClientRects`.
  - Ao fechar, a aba fica onde o tour parou (Q5).
- Celular: o passo `mercados` cai numa tabela alta (> 50% da tela) → `scrollIntoView({ block: "start" })` já existente. Sem ajuste, o topo do alvo para debaixo do cabeçalho e da tablist sticky (o `spotlightBox` mede o retângulo, mas o retângulo está coberto): por isso o `scroll-mt-28` nos painéis (B4). Conferir na tela nos dois tamanhos.

**Testes**
- `lib/tour/__tests__/steps.test.ts`: o contrato de alvos continua (`data-tour="mercados"` precisa existir no código); novo: todo `step.tab` está em `MATCH_TABS`.
- `components/tour/__tests__/guided-tour.test.tsx`: alvo dentro de painel `hidden` + um ouvinte que tira o `hidden` ao receber o evento → o passo aparece com spotlight; sem ouvinte, o passo com aba e alvo existente ainda conta no "N de M"; o "Voltar" para um passo de outra aba dispara o evento com a aba certa. Os casos de hoje (`:200-212`, capítulo `jogo` só com o alvo `palpite`) continuam verdes sem mudança.
- `/como-usar` (`app/(app)/como-usar/como-usar-content.tsx`): seções `ler-analise` (`:241-245`: "Mais abaixo na página ficam as odds…" → "As odds de mercado ficam na aba <Ui>Mercados</Ui>; partidas recentes, confronto direto, classificação, desfalques e escalações, na aba <Ui>Dados</Ui>"), `seu-palpite` (`:250`: "a parte seu palpite" → "a aba <Ui>Seu palpite</Ui>"; `:282-284`: "logo abaixo" → "no painel Suas apostas"), `minha-aposta` (`:291`: "a parte mercados" → "a aba <Ui>Mercados</Ui>"; a frase sobre a marca IA e a chance do mercado sem a margem).
- `app/(app)/como-usar/__tests__/como-usar-content.test.tsx`: rótulos + `"Mercados"`, `"Dados"`, `"Seu palpite"` (e o `"seu palpite"` minúsculo sai da lista, junto com o eyebrow). **Atenção:** o `ui` desse teste só varre `.tsx` de `app/` e `components/` (`:11-23`); os rótulos das abas moram em `lib/view/match-tabs.ts` e não seriam achados. Conferir esses três contra `MATCH_TABS` (import direto no teste) em vez de contra o `ui`. O teste "cita o título da grade de apostas (mercados) como ele aparece no bet-slip" (`:70-78`) passa a ler o rótulo de `MATCH_TABS` em vez do `SectionHeading` do `bet-slip.tsx` (que some).

### B7. Esqueleto e DESIGN.md
- `loading.tsx`: barra, hero, palpite `h-56`, tablist (3 × `h-9`), esqueleto da tabela, com a coluna de 340px no `lg:` (anti-CLS).
- DESIGN.md (Components): "abas → `components/ui/tabs.tsx` (Radix, `forceMount`, estado na URL com `replaceState`)"; Layout: "página do jogo: coluna principal + painel Suas apostas fixo no desktop".

---

## Encaixe do ao vivo (#580), sem implementar

O #580 libera análise, Seu palpite, Suas apostas e bolão durante o jogo, com placar/minuto da API-Football e um modelo ao vivo, mostrando a última odd pré-jogo rotulada. O plano deixa isso como troca de dados, não de estrutura:
- **Capacidades num lugar só** (`matchCapabilities`, A2): o #580 muda a função (ex.: `pool` até os 15 minutos), não a página.
- **Cabeçalho**: `MatchHero` já tem o placar parcial (`liveScore`, #574) e a legenda; o minuto entra na `caption`.
- **Mercados**: `BetGridView.mode` e `oddsHeading` separados do modelo. Ao vivo = `mode: "register"`, `oddsHeading: "Odds antes do jogo"` e `model.label = "modelo ao vivo · 63'"`. Nenhum componente novo.
- **Seu palpite**: a aba já existe nos dois estados; o #580 troca a linha por o bloco.
- **Palpite da IA**: o `PalpiteHero` já ramifica por `unavailable`; o #580 passa um motivo novo ou `null`.
- **Abas como dado** (`MATCH_TABS`): uma aba "Ao vivo", se um dia fizer sentido, é uma entrada na lista + um slot.

## Medida (celular, 390px, jogo analisado com palpite e 5 mercados)

Antes, medido no print de produção local (`shots/match-up-md.png`, 6.462px):

| Bloco | px |
|---|---|
| Menu + volta + cabeçalho | ~250 |
| Palpite da IA | ~850 |
| ver análise por mercado | ~50 |
| 2 cartões de odds | ~385 |
| Leitura do modelo | ~935 |
| Seu palpite + última análise + aviso | ~1.855 |
| Registrar apostas (título, grade, aviso) | ~1.190 |
| Dados (com vazios grandes) | ~660 |
| Rodapé | ~185 |

Depois (estimativa):

| Estado | px | Telas de 844px |
|---|---|---|
| PR A | ~6.000 | 7,1 |
| PR B, aba Mercados (padrão) | ~2.370 (topo 250 + palpite 500 + abas 60 + tabela ~1.250 + §3 ~70 + rodapé ~235) | 2,8 |
| PR B, aba Seu palpite | ~2.850 | 3,4 |
| PR B, aba Dados (tudo vazio) | ~1.350 | 1,6 |
| PR B, aba Dados (tudo cheio) | ~2.000 | 2,4 |

A tabela cresce ~230px em relação à grade de hoje (terceira linha nas células, rodapé por mercado) e substitui ~1.320px (cartões + Leitura). Desktop (1440): ~5.090px hoje → ~1.900px na aba Mercados. Conferir com o mesmo script de print no fim de cada PR e pôr os números na descrição.

## Riscos

- **Firewall da ADR 0030**: a análise com números de valor fica fora do `section[aria-label=palpite]` (bloco irmão). Teste do `PalpiteArea` trava.
- **Radix `forceMount`**: o `TabsContent` montado à força recebe `hidden={false}` do Radix; o nosso `hidden={tab !== value}` é obrigatório e precisa vir depois no spread (teste do `MatchTabs` confere o atributo).
- **Dupla chance**: chance do mercado com alvo 2 (ADR 0053 item 5) e margem dividida pelo alvo (senão sai em dobro). Teste dedicado.
- **Rótulo do modelo**: o "calculado há" tem que ser do modelo que gerou a grade (base × cálculo na hora), não da Leitura do modelo. Teste dedicado (B1).
- **Golden do `OddsCard` sai**: perde-se a paridade de DOM do binário pré-#173. Substituída pelos testes da tabela.
- **Painel em dois lugares** (coluna e folha) com um estado: dois `<form>` com a mesma action só com a folha aberta. Só um fica visível; o teste do provider confere a sincronia.
- **Tour**: passos com aba dependem do ouvinte do `MatchTabs` e do evento disparado fora de efeito (B6). Sem ouvinte (outra página), a regra antiga vale.
- **Hidratação**: `initialTab` vem do servidor e do `useState`; o `replaceState` só roda em evento. Sem leitura de `window` no render (o `matchMedia` da ponte roda no handler).
- **Conflitos**: o PR 5 (#578) entra **antes** e mexe em `page.tsx`, `match-hero.tsx` e `app/actions/bet-slip.ts`: este PR rebaseia sobre ele e reconfere as linhas. O PR 4 mexe em `/apostas` (com o próprio §3, que este plano não toca). O #580 (ao vivo) vem depois e usa o encaixe.
- **Custo**: nenhuma chamada nova à Odds API (o refresh continua `PAGE_LIVE_MARKETS`, 1X2 + total 2,5) nem à IA. A aba Dados busca o provider de esportes como hoje (eager), agora uma vez em vez de duas.
- **Legal**: nenhum texto que a ADR 0048 (com as referências da 0053) ou o report 11 marca como adotado sai da tela: o §3 do registro de apostas fica, o rodapé fica, a linha de análise fica (uma por análise aberta), o `PALPITE_DISCLAIMER` fica. Sai só a repetição (§3 do Seu palpite, linha por cartão de análise).

## Questões (resolvidas na revisão; padrão aceito salvo onde indicado)

1. `PALPITE_DISCLAIMER` fica no palpite? **Sim** (aceito), uma linha: é rótulo de conteúdo da ADR 0031 §5 e o mesmo do `/p`.
2. O rodapé passa a trazer o §3 completo em todas as telas? **Não (trocado pela opção mais segura).** O §3 completo fica no painel Suas apostas (e no celular abaixo da grade/abas), como hoje; o rodapé fica com a frase curta. Motivo: a ADR 0048 D4, com as referências atualizadas pela 0053 item 7, e a 0034 §12 ("inegociável") põem o §3 completo no registro de aposta; trocar por uma linha curta tiraria "nunca para recuperar perdas" e "procure ajuda" da tela de máxima intenção, e no celular a folha modal esconde o rodapé na hora de registrar. Ver A4 item 7.
3. Uma linha `ANALYSIS_RISK_DISCLAIMER` na análise completa? **Sim** (aceito), com um ajuste de lugar: **logo antes do primeiro mercado**, não no fim (compliance §3: "perto da recomendação"; no fim ficaria até ~2.000px abaixo da primeira recomendação). Nenhuma por mercado.
4. Aba na URL? **Sim** (aceito), `?aba=` com `replaceState`, padrão Mercados; nenhuma navegação de servidor.
5. Tour troca de aba ou só destaca o botão? **Troca** (aceito); ao fechar, a aba fica onde parou. Mecanismo corrigido em B6 (evento fora de efeito).
6. Tablist fixa no topo no celular? **Sim** (aceito), `sticky top-14`, com `scroll-mt-28` nos painéis.
7. Chance do mercado sem a margem: onde? **Uma linha de rodapé por mercado** (aceito), com margem e idade; não na célula.
8. Aba Dados carrega só ao abrir? **Não** (aceito): carrega junto, como hoje.
9. Seu palpite em jogo não analisável: aba com uma linha ou some? **Aba com uma linha** (aceito), copy corrigida em B4.
10. "Análises anteriores" dentro da análise completa? **Uma divulgação no fim** (aceito).
11. Aba padrão em jogo encerrado? **Mercados** (aceito).
12. Painel Suas apostas visível em todas as abas no desktop? **Sim** (aceito).
13. `/apostas` e bolão com o §3 duplicado até o PR 4? **Some a questão**: o rodapé não muda, então não há duplicação nova; `/apostas` fica como está até o PR 4, que aplica a mesma regra da ADR 0057.

## Critério de saída

- Nenhum `lg:hidden`/`hidden lg:block` em `page.tsx`/`loading.tsx` (teste de fonte), nos dois PRs. Mesma ordem em 390px e 1440px.
- A probabilidade de uma seleção aparece em **um** lugar na aba Mercados (a tabela); a análise completa mostra a da análise.
- Nenhum `OddsCard`/`MatchModelReading` no código. Tudo que eles mostravam está na tabela: odd, chance do mercado sem margem, margem, "há X", "odds antes do jogo", fonte, JEV e "calculado há" (do modelo usado), placares mais prováveis, aviso de odds indisponíveis com "fonte: the-odds-api". Única perda aceita: a chance crua do Dixon-Coles em mercado já analisado (B1).
- Tudo o que a página mostra hoje continua alcançável (mapa na revisão): ações do palpite (Analisar com IA, Analisar de novo, Gerar/Refazer só o palpite, Compartilhar/Copiar/Parar, Contexto extra), "criar bolão", "o que você acrescentou", cenários e fatores de cada mercado, análises anteriores, Seu palpite com a última análise, recibo de liquidação e aviso de jogo não analisável, e todos os blocos de Dados.
- Avisos na página do jogo: §3 verbatim uma vez por tela visível no registro (painel; celular também abaixo da grade/abas), `PALPITE_DISCLAIMER`, uma linha de análise na análise aberta, rodapé como hoje. Guardas verdes.
- Tour percorre palpite → Mercados → Seu palpite → Dados com spotlight nos dois tamanhos, alvo sem ficar sob as barras fixas; `/como-usar` cita os rótulos reais (testes verdes).
- Teclado: Tab chega na tablist, setas trocam de aba, Tab entra no painel ativo; leitor de tela anuncia "aba, 1 de 3, selecionada"; cada célula da tabela tem nome acessível com os três números rotulados.
- `pnpm test && pnpm lint && pnpm typecheck && pnpm build` verdes; prints 390/1440 claro e escuro no PR com a medida.

## Arquivos

PR A: `app/(app)/match/[id]/page.tsx`, `app/(app)/match/[id]/loading.tsx`, `components/match-hero.tsx`, `components/back-link.tsx`, `components/bet-slip.tsx`, `components/bet-slip-section.tsx`, `components/seu-palpite.tsx`, `components/seu-palpite-section.tsx`, `components/palpites/palpite-hero.tsx`, `components/palpites/palpite-area.tsx` (novo), `components/full-analysis.tsx` (novo), `components/market-analysis-section.tsx`, `components/previous-analyses.tsx`, `lib/view/match-availability.ts`, `lib/user-palpite/analysis-context.ts` (dois avisos), `lib/tour/steps.ts`, `components/tour/guided-tour.tsx` (comentário), `app/(app)/como-usar/como-usar-content.tsx`, `__tests__/page-header-coverage.test.ts` (comentário), `docs/decisions/0057-avisos-da-pagina-do-jogo-um-por-tela.md` (novo), `DESIGN.md`; testes citados em A2–A5. **Fora** (versão anterior previa): `components/site-footer.tsx`, `lib/view/bet-slip.ts` (`RISK_LINE_SHORT`).

PR B: `lib/view/bet-slip.ts`, `lib/bets/analysis-probs.ts`, `lib/db/queries/reference-odds.ts`, `lib/model-base/model-scoreline.ts` + `lib/quant/match-model.ts` (`baseCheckedAt`), `lib/odds/` (função pura da margem), `lib/view/match-tabs.ts` (novo), `lib/view/odds.ts`, `components/ui/tabs.tsx` (novo), `components/match-tabs.tsx` (novo), `components/bet-slip/{bet-slip-provider,market-table,slip-panel,slip-mobile-bar,risk-notice}.tsx` (novos; `components/bet-slip.tsx` e `components/bet-slip-bridge.tsx` saem), `components/seu-palpite.tsx`, `components/match-sections.tsx`, `components/match-sections-auxiliary.tsx`, `components/data-empty-line.tsx` (novo), `components/analysis-scenarios.tsx`, `components/odds-card.tsx`/`match-odds-cards.tsx`/`match-model-reading.tsx` (saem), `components/skeletons/match-sections-skeleton.tsx`, `components/tour/guided-tour.tsx`, `lib/tour/steps.ts`, `app/(app)/match/[id]/page.tsx`, `app/(app)/match/[id]/loading.tsx`, `app/(app)/como-usar/como-usar-content.tsx`, `DESIGN.md`; testes citados em B1–B6.

## Revisão do plano

Revisão adversarial contra o código em `7f059b9` (`main`), com CLAUDE.md, DESIGN.md, ADRs 0030, 0031, 0034, 0036, 0048, 0053, 0055 e 0056, `docs/ops/05-legal-compliance.md` §3, report 11, PLAN-574/575/578 e o texto "Página do jogo" da revisão de design. Correções já aplicadas no corpo acima; aqui o resumo e o que fica de risco.

### O que estava errado (e foi corrigido)

1. **Linhas de `page.tsx`** deslocadas em ~9 (`:392-445` → `:383-436`, `:502-768` → `:493-759`, `:779-799` → `:770-790`, as seis de capacidade). As de `bet-slip.tsx`, `seu-palpite.tsx`, `palpite-hero.tsx`, `site-footer.tsx` e `como-usar-content.tsx` batiam.
2. **Ordem com o PR 5 invertida.** O plano dizia "este entra antes; o PR 5 rebaseia". É o contrário: o #578 entra antes e mexe em `page.tsx` (`teams` → `displayTeams`, escudo no hero), `match-hero.tsx:46` (`TeamCrest`) e `app/actions/bet-slip.ts`. Nota no topo e em Riscos.
3. **`<h1>` no `MatchHero` quebraria o `page-header-coverage.test.ts`** (terceiro caso: só `PageHeader` e `PageHeading` podem ter h1 em `components/`). O h1 sr-only vai em `page.tsx`.
4. **Legal: o plano tirava texto que a ADR 0048 marca.** A 0053 item 7 atualizou as referências da 0048 D4 para o §3 completo do `bet-slip.tsx`; a 0034 §12 o chama de inegociável na tela de máxima intenção. Trocar por `RISK_LINE_SHORT` e mover o §3 para o rodapé (que some atrás da folha modal no celular) é exatamente o que o pedido de conservadorismo veta. Agora: §3 fica no painel e abaixo da grade no celular; rodapé não muda; saem só o §3 do Seu palpite (emenda 0055 D10) e a linha por cartão de análise (fica uma). ADR 0057 encolhe e só emenda a 0055 D10.
5. **Margem da dupla chance em dobro.** "margem = Σ1/odd − alvo" dá ≈10% para um board de 5%. Fórmula corrigida: `Σ(1/odd) ÷ alvo − 1`. A chance do mercado (alvo 2, somando 200%) já batia com o `evaluate-slip.ts`.
6. **"calculado há" da fonte errada.** A grade usa `resolveSlipModel`, que recusa base velha, de outra versão ou de jogo começado e cai no cálculo na hora; a Leitura do modelo mostra a última base sem filtro. Rótulo agora sai do modelo usado (`baseCheckedAt`).
7. **`flushSync` dentro de efeito não é confiável.** O tour disparava o evento de aba no efeito de troca de passo; o React não garante `flushSync` de dentro de um efeito. O evento sai de `goTo(i)`, chamado pelos handlers (Próximo, Voltar) e pelo timer de partida.
8. **`data-[state=inactive]:hidden` não é visível no jsdom** e os testes do tour simulam visibilidade pelo atributo `hidden`. Trocado pelo atributo `hidden`, que entra pelo `{...contentProps}` que o Radix espalha depois do `hidden={!present}` dele.
9. **Teste de rótulos do `/como-usar` não varre `lib/`.** "Mercados", "Dados" e "Seu palpite" em `lib/view/match-tabs.ts` não seriam achados; o teste confere contra `MATCH_TABS`.
10. **Strings esquecidas:** `CONTEXT_APPLIED_NOTICE`/`CONTEXT_NO_EFFECT_NOTICE` (`lib/user-palpite/analysis-context.ts:157-160`) mandam o usuário a "ver análise por mercado", que deixa de existir no PR A; `/como-usar:221-224` descreve mercados usados e fontes "embaixo" do palpite, que ficam escondidos no modo compacto.
11. **Árvore do PR A** sem a `BetSlipBridgeProvider` envolvendo grade e Seu palpite; `aria-labelledby="mercados"` apontava para um `<span>` que chega por streaming.
12. **Árvore do PR B** punha `hidden lg:block`/`lg:hidden` em `page.tsx`, contra o próprio `single-tree.test.ts`: as classes vão para `components/bet-slip/*`. `data-tour` vai nos `TabsContent` (fora do `Suspense`); sai o `data-tour="suas-apostas"` sem passo e o `data-tour="seu-palpite"` duplicado.
13. **Detalhes:** `matchMedia` precisa de `?.` duplo (jsdom); a barra fixa e o painel convivem no DOM do teste; o `match-availability.test.ts` já existe; largura da coluna principal ≈610px, não 650; copy da aba Seu palpite em jogo fechado não usa "registrar"; frase de instrução da grade não pode sumir; célula precisa de nome acessível; chip "IA" com `Badge` e fundo `edge-soft` (contraste sobre a célula marcada); `scroll-mt-28` nos painéis (barras fixas cobriam o alvo do tour).

### Cortado

- Rodapé com o §3 em todas as telas e `RISK_LINE_SHORT` (decisão legal acima; também tirava o PR do escopo da página do jogo).
- Destaque `ring` de 1,5s no painel do desktop ao adicionar pelo Seu palpite (a mensagem do próprio Seu palpite basta).

### Nada fica inalcançável: o que a página mostra hoje → onde vai

| Hoje | PR A | PR B |
|---|---|---|
| Voltar "jogos", "criar bolão" | `MatchTopBar` (bolão só se `caps.pool`) | igual |
| Cabeçalho (times, liga, hora, contagem, placar final/parcial, ao vivo) | `MatchHero` (com `TeamCrest` do PR 5) | igual |
| Palpite: veredito, placar provável, confiança, recibo Acertou/Errou | `PalpiteHero` compacto | igual |
| Narrativa inteira, "a partir de:", ficha de dimensões, fontes | `PalpiteHero` ao abrir "Ler análise completa" (narrativa em 2 linhas fechado) | igual |
| Analisar com IA, Gerar só o palpite, Analisar de novo, Refazer só o palpite, Compartilhar/Copiar link/Parar de compartilhar, Contexto extra, avisos de erro/contexto | `PalpiteHero`, sempre visíveis | igual |
| `PALPITE_DISCLAIMER` | fim do `PalpiteHero` | igual |
| "ver análise por mercado" (acordeão de acordeões) | "Ler análise completa", um nível | igual |
| O que você acrescentou | topo do `FullAnalysis` | igual |
| Análise por mercado (odd, vantagem, stake, cenários, fatores, rodapé técnico) | `FullAnalysis`, aberta, cabeçalho por mercado | igual |
| Linha de risco da análise (×N) | uma, antes do primeiro mercado | igual |
| Análises anteriores | um `MatchCollapsible` no fim do `FullAnalysis` | igual |
| Aviso de jogo não analisável | `NotAnalyzableNotice` | igual |
| Odds atuais / antes do jogo, idade, chance normalizada, overround, "?", "Odds indisponíveis · fonte: the-odds-api" | `OddsCard` (como hoje) | aba Mercados: título/rodapé da tabela e rodapé por mercado |
| Leitura do modelo: chance, odd justa, placares mais prováveis, fonte, JEV, "calculado há", estado vazio | `MatchModelReading` (como hoje) | aba Mercados: célula (chance + justa), linha de placar exato, rodapé da tabela; chance crua de mercado já analisado sai (perda aceita) |
| Grade de registro, placar exato, outro placar, "ou digite sua aposta" | `BetSlip` (uma instância) | aba Mercados (`MarketTable`) |
| Painel Suas apostas, combinada, avaliação | ao lado da grade (desktop) / folha (celular) | coluna fixa (desktop) / folha (celular), fora das abas |
| §3 do registro | painel + abaixo da grade no celular | painel + abaixo das abas no celular |
| Seu palpite + última análise do seu palpite | depois da grade | aba Seu palpite (linha "fica aberto até o apito" em jogo fechado) |
| §3 do Seu palpite | **sai** (ADR 0057) | — |
| Forma, H2H, classificação, desfalques, escalações | `MatchSections` + `MatchAuxiliarySections`, uma vez | aba Dados; bloco vazio vira uma linha |
| Rodapé global | sem mudança | sem mudança |
| Tour (palpite, seu palpite, suas apostas, odds, números) | mesmos alvos, texto do passo palpite | palpite → Mercados → Seu palpite → Dados, trocando de aba |

### Conferido e correto

- O split em 2 PRs se sustenta: o PR B precisa do painel fora do `BetSlip`, que só é seguro com uma instância. Ponto de corte opcional para um PR C anotado.
- O §3 verbatim, o `PALPITE_DISCLAIMER` e o `ANALYSIS_RISK_DISCLAIMER` (prop `showRiskDisclaimer` já existe, precedente do fan-out).
- A chance do mercado da dupla chance com `impliedSumTarget` 2 bate com `evaluate-slip.ts:132-162`; `aiPick` por `legMarketPin(...).selectionKey` evita o `home_draw` × `home_or_draw`.
- `getReferenceOddsForMatch` só lê banco; o `ensureOddsSnapshotsFresh` continua o único gatilho (sem custo novo).
- Streaming: cada `Suspense` passa a existir uma vez; o PR B só junta a Leitura do modelo à espera do refresh de odds, que a grade já tinha.
- Próxima ADR livre: **0057** (as decisões vão até 0056; a 0057 do PLAN-565 é migration, outra numeração). O PR 5 não cria ADR (só nota na 0056). A ADR do ao vivo (#580) fica com a 0058. Reconferir no commit: quem mergear primeiro leva o número.

### Riscos que continuam

- **Desvio da revisão de design aprovada:** o painel mostra o §3 inteiro, não "uma linha curta", e o rodapé não vira o aviso fixo. É deliberado (legal); o dono pode reabrir com ADR nova, sabendo que mexe em 0034 §12/0036 D8/0053 item 7/0048 D4.
- **Rebase sobre o PR 5** em `page.tsx` e `match-hero.tsx`: diff grande em cima de diff grande. Fazer o PR A logo depois do merge do #578 e reconferir as linhas citadas.
- **`hidden` vs Radix:** depende de o `{...contentProps}` vir depois do `hidden` no `TabsContent` do `radix-ui@1.4.x` instalado. Se mudar, envolver o conteúdo num `div hidden` próprio.
- **Tamanho do PR B** (provider + tabela + abas + tour + Dados + remoções, com goldens saindo): revisar com cuidado a paridade da tabela com o que os cartões mostravam (margem, idade, "antes do jogo") antes de apagar `odds-card-parity.golden.test.tsx`.
- **Tour no celular:** spotlight de alvo alto sob cabeçalho + tablist sticky depende do `scroll-mt`; só se prova na tela (390px).
- **Medidas** são estimativas a partir do print; conferir com o mesmo script no fim de cada PR.
