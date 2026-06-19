# PLAN — #351 página do jogo palpite-first (HERO do palpite + análise como detalhe)

> Plano de implementação (snapshot pré-issue/PR, arquivo histórico). Fonte da verdade
> viva = ADR 0030 + a issue #351. Aterrado no código real em `2026-06-19`.

## 1. Decisão & escopo (confirmado com o dono)

Inverter a hierarquia da página do jogo: a **manchete sintetizada (palpite)** vira o HERO
no topo; as análises por mercado viram **detalhe recolhível**. Um botão "Analisar com IA"
dispara fan-out → síntese → hero.

**Posture (escolha do dono): "Replace outright + go live".** Palpite-first é a ÚNICA layout
pra todos — sem dark/flag de apresentação. O fluxo single-market `AnalysisPanel` primário é
removido da página.

**Dial de calor (escolha do dono): "More friend's-voice" (D-leaning).** A manchete lê como
um palpite falado de amigo ("Pra mim vai dar Palmeiras — acho 2 a 1"); kicker "O PALPITE";
presença terracota mais quente; placar tecido na frase. **Guardrails do dial (lente firewall):**
confiança é SÓ palavra-chip (nunca pip/meter/%), placar sempre enquadrado como "placar"
(nunca odd), e QA de copy mantém a voz longe do slop de tipster (sem emoji-stuffing, sem
"LOCK"/urgência, sem linguagem de aposta/valor).

### `enableBestBetFanOut` vira kill-switch (não gate de layout)

`analyzeBestBet` (a fonte de dado do HERO) JÁ é gated server-side por `enableBestBetFanOut`
(`predictions.ts:362` → "Recurso indisponível" antes de qualquer spend; DB-flip-only, default
OFF, sem UI admin). Decisão:

- **#351 remove o gate de LAYOUT** (palpite-first renderiza sempre, independente da flag).
- **Mantém o gate server-side em `analyzeBestBet`** como kill-switch de spend (o teto de
  rate-limit 20/dia NÃO foi rederivado pro multiplicador do fan-out — `predictions.ts:404`,
  princípio 3 do handoff). Reversível (`SET = false`).
- **Go-live = o dono flipa a flag** (`UPDATE ai_config SET enable_best_bet_fan_out = true
  WHERE id=1`) — ação documentada no PR, NÃO no código (preserva o kill-switch default-safe).
- O HERO trata os dois caminhos de indisponibilidade (ver §6): flag-off-no-load → aviso suave
  (sem botão que erra); erro em runtime (`ok:false`) → Callout retryable.

**Custo do go-live (documentar no PR, não-bloqueante — dono escolheu go-live):** cada
"Analisar com IA" = até `MAX_FANOUT_MARKETS` (6) predict() PAGOS + até `MAX_ADDITIONAL_FETCHES`
créditos de odds + 1 síntese (Haiku), tudo em 1 slot de rate-limit (20/dia). Pior caso
~140 chamadas LLM/dia. Aceitável p/ solo + círculo pequeno.

## 2. Design confirmado (resumo do /impeccable shape)

Direção vencedora do painel (4 direções × 3 juízes): **"Veredito editorial" (base A,
firewall+craft) quente com a voz de amigo (D, brand)**, enxertos B (warm-fill + costura
cromática) e C (recibo de liquidação). Dial final: **D-leaning**.

- **Tipografia carrega.** Veredito = headline `display-lg` / `lg:text-[40px]`, `text-balance`,
  `max-w-reading`. O calor (`palpite-*`, hue 40) entra como identidade (casca quente, kicker,
  chip), não como inundação de casino.
- **Placar provável** tecido junto do veredito como mono (warm, mas enquadrado "placar
  provável" — NUNCA terracota-como-odd, NUNCA lido como preço).
- **Confiança = palavra-chip** ("confiança média"), `aria-label` como palavra. SEM meter/pip/%.
- **Narrativa** = prosa conversacional, `text-body`, `muted-foreground`, `max-w-reading`.
- **citedMarkets** = linha meta mono "a partir de: resultado · over 2.5 gols" (só nomes).
- **Costura cromática (enxerto B):** o colapsável de detalhe é cromaticamente NEUTRO
  (`border-subtle`/`bg-card`, nunca quente) — a fronteira quente/fria É a fronteira
  opinião/valor.
- **"só por diversão" é DROPADO** (mente sobre um track-record liquidável; as linhas fun
  red_card/corners não são mais geradas — #353).

## 3. Arquitetura (server-first + 1 botão cliente)

A página (`app/match/[id]/page.tsx`) é Server Component. HERO e detalhe são renderizados a
partir do ESTADO PERSISTIDO; o botão dispara a server action + `revalidatePath` que re-renderiza
tudo. (Espelha como o resto da página já funciona — análises via history + revalidate.)

### 3.1 Caminho de dado server-side do HERO

Novo mapper em `lib/view/palpites-headline.ts` (mirror VERBATIM da lógica inline em
`predictions.ts:504-511`, lendo do set persistido em vez do generate fresco):

```ts
export function toPalpiteHeadlineViewFromSet(
  set: PalpiteSetWithLines,
): PalpiteHeadlineView | null {
  const headline = set.palpiteSet.headline;            // PalpiteHeadline | null (jsonb)
  const scoreLine = set.palpites.find((p) => p.type === "exact_score");
  if (!headline || !scoreLine?.params) return null;    // sets antigos pré-#353 → null
  return toPalpiteHeadlineView({
    headline,
    probableScore: scoreLine.params,                   // {home,away} da linha exact_score
    outcome: scoreLine.outcome,                        // {result} | null → badge won/lost/null
  });
}
```

Na página: `const sets = await getPalpiteSetsForMatch(match.id, session.user.id)` (já existe);
`const heroPalpite = sets[0] ? toPalpiteHeadlineViewFromSet(sets[0]) : null`. Passado ao HERO.
`PalpiteHeadlineView` é dado puro serializável SEM número de valor (firewall já no tipo) → cruzar
a fronteira server→client é seguro.

> NOTA p/ plan-gate: `getPalpiteSetsForMatch` busca o histórico COMPLETO. O HERO só usa `sets[0]`.
> Mínimo overhead; aceitável (espelha o interim panel). Se virar gargalo, uma query "latest-only"
> é um follow-up — NÃO neste slice.

### 3.2 `<PalpiteHero/>` — client component (novo)

`components/palpites/palpite-hero.tsx`, `"use client"`. Props:
`{ heroPalpite: PalpiteHeadlineView | null, matchId: string, analyzable: boolean,
fanOutEnabled: boolean }`. Usa `useActionState(analyzeBestBet, null)`. Renderiza TODOS os
estados (§6) ramificando por `pending` / `state?.ok` / `heroPalpite` / `analyzable` /
`fanOutEnabled`. O botão "Analisar com IA" é um `<form action={formAction}>` com
`<input hidden name="matchId">` (espelha o `BestBetPanel` atual). Em sucesso, `revalidatePath`
(já dentro de `analyzeBestBet`) re-renderiza a página → o HERO server-fed mostra o palpite novo;
o componente cliente usa `state.ok===false` só pro caminho de erro.

> `analyzeBestBet` NÃO é modificado (preserva o contrato pinado por `predictions-best-bet.test.ts`:
> `{ok, view, palpite}`). O HERO ignora `view` (o detalhe vem do `sections` revalidado); usa
> `palpite`/`ok`/`error` só pra erro/UX. O `view` retornado fica sem renderer na página — aceito
> (cleanup do BestBet é follow-up; ver §5).

### 3.3 Detalhe recolhível ("ver análise por mercado")

`<MatchCollapsible>` (chrome NEUTRO) envolvendo `<MarketAnalysisSections sections={sections} />`
em modo **read-only** (SEM `analyzable`/`matchId` → sem footer de reanálise; o 1 botão re-roda
tudo). `sections` = `toMarketAnalysisSections(history)` (já computado). Renderiza só quando
`sections.length > 0`. `<PreviousAnalyses items={previousAnalyses} />` dentro do mesmo detalhe.
Números de valor (edge/EV/stake/odd) são CONTEÚDO LEGÍTIMO do detalhe (firewall só barra o HERO).

### 3.4 Odds → zona neutra (firewall)

Os `OddsCard` (odds/preços = dado de valor, firewall-adjacente) saem da proeminência ao lado do
palpite e descem pra zona neutra de valor (acima/dentro do detalhe). "Palpite não lê como
recomendação de valor" (PRODUCT.md). Decisão de apresentação — validada no /impeccable audit +
browser.

### 3.5 Reordenar AMBOS os branches

Mobile (`MobileMatch`, `lg:hidden`, `page.tsx:263-354`) E desktop (`DesktopMatch`,
`hidden lg:block`, `:356-448`). Nova ordem (ambos): header → `MatchHero` (identidade, fica) →
`<PalpiteHero/>` (proeminente) → zona neutra { OddsCard(s) + `<MatchCollapsible>` detalhe } →
`MatchSections`/`MatchAuxiliarySections` (Suspense, inalterados). DESKTOP: o HERO ocupa a coluna
principal; o grid `[1fr_320px]` atual (hero|odds) é repensado — odds descem pra zona neutra.

## 4. Lista de mudanças (arquivos)

**Novos:**
- `components/palpites/palpite-hero.tsx` — o HERO client (todos os estados, ambos os branches via
  classes responsivas como o `MatchHero`).
- `lib/view/palpites-headline.ts` — +`toPalpiteHeadlineViewFromSet` (mapper server-side).
- `components/__tests__/palpite-hero.test.tsx` — **guard de firewall de UI** (§5) + estados.
- `lib/view/__tests__/palpites-headline.test.ts` — +casos do novo mapper (sets[0]→view, headline
  null→null, exact_score ausente→null, outcome→badge).

**Modificados:**
- `app/match/[id]/page.tsx` — lê `getPalpiteSetsForMatch`→`heroPalpite`; reordena ambos os branches;
  remove uso de `PalpitesPanel`/`BestBetPanel`/`AnalysisPanel`; monta o detalhe colapsável read-only.
  Mantém `bestBetEnabled` (passa como `fanOutEnabled` ao HERO).

**Removidos (page-only, cleanly dead — verificado por grep):**
- `components/palpites/palpites-panel.tsx` (interim) + `palpite-row.tsx` + `previous-palpites.tsx`
  **SE** sem outros consumidores (verificar). **`palpite-badges.tsx` FICA** (o HERO reusa
  `SettleableBadge`). Ajustar/realocar `palpite-row.test.tsx` (testa row+previous+badges) → manter
  cobertura do `SettleableBadge`.
- `components/best-bet-panel.tsx` (o `best-bet-panel.test.tsx` importa `best-bet-results`, não este
  → seguro). **`best-bet-results.tsx` + teste FICAM** por ora (o action ainda retorna `view`;
  remoção = follow-up).

**DECISÃO p/ plan-gate (delete-now vs defer):** `analysis-panel.tsx` + `new-analysis-form.tsx`
(page-only após a remoção) + seus 2 testes. Deletar agora é bounded; OU follow-up de dead-code.
**NÃO** deletar `analyzeMarkets` (pode ser referenciado pela cadeia de dispatch do `MarketAnalysisSections`
mantido) — fica pro follow-up. Default do plano: **deletar os 2 componentes + 2 testes** (bounded),
manter `analyzeMarkets`.

## 5. Firewall UI guard (critério de saída inegociável)

`components/__tests__/palpite-hero.test.tsx` renderiza `<PalpiteHero heroPalpite={POPULATED}/>`
(via `renderToStaticMarkup`) e:
- **assert: o DOM NÃO casa `/R\$|%|\bEV\b|stake|odd|edge|lucro|retorno/i`** e não tem classe `edge-*`
  (espelha o descarte de `lib/view/palpites.ts:79` na camada de apresentação — defense-in-depth).
- assert: badge settled ship com a PALAVRA (acertou/errou), nunca cor sozinha (a11y).
- assert: confiança renderiza só a palavra (sem dígito/%).
- cobre estados: empty (botão), populated, settled won/lost, error.

## 6. Matriz de estados (HERO, ambos os branches)

| Condição | Render |
|---|---|
| `pending` | Skeleton espelhando o populated (sem reflow) + status em PALAVRAS "lendo os mercados e montando o palpite… (pode levar um minuto)" + `Loader2`. `aria-busy`. SEM dígito de tempo. |
| `state.ok===false` + `heroPalpite` | populated + `Callout` de erro inline (palpite anterior sobrevive). |
| `state.ok===false` sem `heroPalpite` | empty + erro inline. Mensagem = `state.error` (ex.: "Recurso indisponível", rate-limit). |
| `heroPalpite` settled (badge≠null) | populated + `SettleableBadge` (acertou/errou) + recibo "placar provável N–M · placar real X–Y". Botão ghost "Analisar de novo" se `analyzable`. |
| `heroPalpite` pendente (badge=null) | populated (veredito/placar/conf/narrativa/citedMarkets). Botão ghost "Analisar de novo" se `analyzable`. |
| sem `heroPalpite`, `analyzable && fanOutEnabled` | **empty**: casca quente (quieter, `bg-palpite-soft/30`), kicker "O PALPITE", teaser `display-md` ("E aí, quem leva esse jogo?"), 1 linha de ensino, botão primário quente "Analisar com IA" (Sparkles). |
| sem `heroPalpite`, `analyzable && !fanOutEnabled` | aviso suave "temporariamente indisponível" (kill-switch) — SEM botão que erra. |
| sem `heroPalpite`, `!analyzable` (encerrado/cancelado) | aviso "jogo encerrado, sem palpite" (espelha `FinishedNotice`). |

## 7. Copy (PT-BR, D-leaning — QA de voz no review)

- Kicker: **"O PALPITE"** (mono, chip quente).
- Confiança: "confiança baixa/média/alta" (chip; `aria-label="confiança média"`).
- Botão: "Analisar com IA" (idle) / "Montando o palpite…" (pending) / "Analisar de novo" (ghost).
- Empty: título "E aí, quem leva esse jogo?" + "A IA lê os dois times, os números e o mercado e crava
  um palpite — quem ganha, o placar provável e o porquê."
- Detalhe: "ver análise por mercado".
- Settled recibo: "placar provável N–M · placar real X–Y".
- Sem "só por diversão". Sem emoji-stuffing/LOCK/urgência/odd/aposte.

## 8. Plano de teste

- `pnpm typecheck` + `pnpm lint` + `pnpm test --no-file-parallelism` (flake pglite em 8-core; CI 2-core).
- Novos: `palpite-hero.test.tsx` (firewall + estados), `palpites-headline.test.ts` (+mapper).
- Verificar verdes os pinados: `predictions-best-bet.test.ts` (contrato inalterado), `palpites-headline.test.ts`,
  `best-bet.test.ts`, synthesis/generate tests (intocados).
- Testes deletados: os dos componentes deletados (ajustar, não só apagar — manter cobertura do `SettleableBadge`).
- **Verificação no app real (browser, ambos os viewports):** empty → press → loading → populated;
  settled won/lost; erro (flag off → aviso; runtime → callout); `prefers-reduced-motion`; dark+light;
  contraste ≥4.5:1 na casca quente.

## 9. Riscos / pontos pro plan-gate (3 lentes)

1. **Voz da síntese vs. dial D-leaning.** O `verdict`/`narrative` vêm do cartucho `palpites_v2`
   (#353, MERGED). Se a saída ao vivo ler flat demais pro D-lean, um bump de prompt
   (`palpites_v2.1`, `prompt:`) é FOLLOW-UP — não amplia o #351 (UI). Verificar no browser; só
   incluir bump se claramente necessário e baixo-risco.
2. **Blast-radius de deleção** (§4): confirmar delete-now vs defer de `analysis-panel`/`new-analysis-form`.
   Não quebrar a cadeia de import do `MarketAnalysisSections` mantido.
3. **Placar tecido na frase** pode ler como odd (caução da lente firewall). Manter enquadramento
   "placar provável" load-bearing; mono neutro/quente-cuidadoso, nunca verde edge-*.
4. **`view` retornado sem renderer** + `best-bet-results` órfão: aceito agora (não tocar no contrato
   #353); follow-up de cleanup.
5. **Odds na zona neutra** — confirmar que não some informação que o usuário espera; validar no audit.
6. **Desktop grid** — o `[1fr_320px]` atual (hero|odds) precisa de novo layout (HERO full-width).

## 10. Fora de escopo (follow-ups)

- Cleanup de dead-code do fluxo single-market (`analyzeMarkets` + cadeia) se não deletado aqui.
- Remoção de `best-bet-results`/`BestBetView`-`view` do contrato `analyzeBestBet`.
- Bump de voz do cartucho de síntese (`palpites_v2.1`) se a verificação ao vivo pedir.
- Query "latest-only" pro HERO (se `getPalpiteSetsForMatch` virar gargalo).
- Model-override no botão de fan-out (o `BestBetPanel` nunca expôs; #351 não adiciona).

## 11. Resoluções do plan-gate (3 lentes — AUTORITATIVO p/ o implementador)

Veredito: **3× GO-WITH-FIXES** (arquitetura server-first, mapper e revalidate VALIDADOS).
Refinamentos folded-in (sobrepõem qualquer ambiguidade acima):

1. **Firewall gap REAL — adicionar `retorno` ao guard de DADO (in-scope, aditivo).**
   `lib/ai/palpites/value-language-guard.ts` (`VALUE_LANGUAGE_PATTERNS`) NÃO tem `retorno`
   (termo de valor real: "retorno esperado", `analysis-result.tsx:142`). Adicionar
   `/\bretornos?\b/i` ao array + atualizar o golden `value-language-guard.test.ts`. Defense-in-depth:
   o guard de DADO (#353) e o teste de UI (§5) passam a casar o mesmo conjunto. Baixo risco (aditivo).
2. **page.tsx — mudanças EXPLÍCITAS de import/wiring:** `+import { getPalpiteSetsForMatch } from
   "@/lib/db/queries/palpites"`; `+import { toPalpiteHeadlineViewFromSet } from
   "@/lib/view/palpites-headline"`; adicionar `getPalpiteSetsForMatch(match.id, session.user.id)` ao
   `Promise.all` (~:90); `const heroPalpite = sets[0] ? toPalpiteHeadlineViewFromSet(sets[0]) : null`;
   `+heroPalpite: PalpiteHeadlineView | null` no tipo `Common`; passar a ambos os branches.
   **REMOVER junto:** o `import { PalpitesPanel }` (:15) + as DUAS invocações `<PalpitesPanel/>`
   (:311 mobile, :401 desktop) ANTES de deletar o arquivo (import+uso são acoplados — deletar o
   arquivo sem remover os usos quebra o build).
3. **Layout DESKTOP concreto** (não deferir): dropar o grid `grid-cols-[1fr_320px]` hero|odds
   (`:385`). MatchHero (compacto) + `<PalpiteHero/>` empilhados FULL-WIDTH (narrativa em
   `max-w-reading`). Abaixo, a **zona neutra**: `OddsCard(s)` + `<MatchCollapsible>` detalhe —
   default empilhado full-width; um right-rail `[1fr_320px]` (detalhe | odds) é opcional se ler
   melhor (validar no browser). Mobile: igual hoje, só reordenado (HERO sobe, odds+detalhe descem).
4. **Cobertura do `SettleableBadge` MIGRA pro HERO.** `palpite-hero.test.tsx` (§5) inclui casos de
   badge settled won/lost (palavra+tint, a11y nunca-cor-sozinha) — herda a asserção do
   `palpite-row.test.tsx`. Deletar `palpite-row.tsx`/`previous-palpites.tsx` (verificar grep:
   page-only via `palpites-panel`) → deletar `palpite-row.test.tsx` JUNTO. **`palpite-badges.tsx`
   FICA** (HERO reusa `SettleableBadge`). Render dos testes via `renderToStaticMarkup` (espelha
   `palpite-row.test.tsx`/`best-bet-panel.test.tsx` existentes).
5. **`analyzeMarkets` órfão = OK.** Deletar `analysis-panel.tsx` + `new-analysis-form.tsx` + seus 2
   testes orfana `analyzeMarkets` da UI, MAS `predictions-multi-market.test.ts` o testa DIRETO
   (verde). `MarketAnalysisSections`/`SectionFooterDispatch` usa `analyzeMatch` (NÃO `analyzeMarkets`)
   → cadeia do detalhe read-only intacta. Remoção total de `analyzeMarkets` + `market-multi-select`
   etc. = follow-up. **Confirmar por grep** que `analysis-panel`/`new-analysis-form` são page-only
   antes de deletar.
6. **`best-bet-panel.tsx` deletar; `best-bet-panel.test.tsx` FICA** (importa `best-bet-results`, não
   o panel → verde sem o panel). `best-bet-results.tsx` + `view` retornado = órfãos aceitos (não
   tocar no contrato #353; cleanup = follow-up). Comentar em `page.tsx` por que `view` é ignorado.
7. **`red_card`/`corners`: "não são mais GERADAS"** (enum de pé — Tier 3, ADR 0030). Linguagem do §2
   já correta; nenhuma mudança de schema.

**Sem REWORK.** Demais itens das 3 lentes = concerns de implementação já cobertos por §3/§5/§6/§8
(skeleton sem reflow, costura cromática neutra do colapsável, score "placar provável" load-bearing,
odds na zona neutra validadas no browser, voz D-leaning verificada ao vivo — bump `palpites_v2.1` só
se a saída ler flat).
