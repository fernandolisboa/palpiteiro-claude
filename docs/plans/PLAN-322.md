# PLAN — #322: de-slop do Dashboard (agregado + detalhe + grade) — fatia 3

> Plano de implementação (artefato histórico, snapshot 2026-06-18). Fatia 3 do épico **#320**.
> Herdeiro da fundação #321 (ADR 0029, MERGED, PR #327) e da #246 (match page, MERGED, referência
> viva). Adota tokens/primitivas que a fundação criou; **não re-deriva nem cunha token** (banido
> pela ADR 0029). Derivado de exploração read-only + síntese + review adversarial de 4 lentes
> (Escopo/Paridade · Token/ADR · Teste/Golden · A11y/Coerência), com as ressalvas dobradas aqui.
> **Dashboard-only.** Registra as decisões finais, incluindo desvios conscientes do texto da issue.

## Princípio

Só **apresentação**, zero mudança funcional, **paridade de dados** (KPIs, segmentos, CLV, bankroll,
tabela) preservada, sem regressão. Conduzido via `/impeccable`. A fundação (#321) é a fonte da
verdade do tipo/tracking/largura/motion no `@theme` de `app/globals.css`; aqui só **roteamos
classes** pros tokens e **consumimos** as primitivas. Onde a issue conflita com um comentário de
código que documenta intenção funcional, o código ganha — mas se o conflito for com um **critério de
aceite escrito**, o owner decide (ver "Questões em aberto pro owner").

## Escopo (allowlist — os ÚNICOS arquivos que podem mudar)

`app/dashboard/page.tsx` · `app/dashboard/error.tsx` · `app/dashboard/loading.tsx` ·
`app/dashboard/[predictionId]/loading.tsx` · `components/dashboard/kpi-cards.tsx` ·
`components/dashboard/market-segments.tsx` · `components/dashboard/predictions-table.tsx` ·
`components/dashboard/dashboard-filters.tsx` · `components/dashboard/prediction-detail.tsx` ·
`components/dashboard/bankroll-chart.tsx` + este plano (`docs/plans/PLAN-322.md`).

**NÃO tocar (consumir/referência):** `app/dashboard/[predictionId]/page.tsx` (server puro, zero
violação visual); `components/ui/*` (Badge, Table, Callout, Select, Label, Card, Separator…),
`components/empty-state.tsx`, `components/back-link.tsx`, `app/globals.css`, `components/team-avatar.tsx`.
Editar `ui/badge.tsx`/`card.tsx`/`separator.tsx`/`team-avatar.tsx`/`ui/table.tsx` **vazaria** no golden
`components/__tests__/odds-card-parity.golden.test.tsx` — a tríade tem que ficar verde **SEM**
re-snapshot. **Cunhar token novo é banido** (ADR 0029; `--text-display-xs` e `--color-chart-profit`
explicitamente rejeitados, §"Alternativas").

**Deferido pro #323 (público/home — NÃO tocar aqui):** `date-range-tabs.tsx`, `league-tabs.tsx`,
`match-row.tsx`, `upcoming-matches-desktop.tsx`, `upcoming-matches-mobile.tsx`,
`desktop-status-cell.tsx`, `recent-pred-card.tsx`. A issue lista esses na linha "Rotas/componentes",
mas o owner ratificou o escopo dashboard-only nesta sessão; os goldens deles foram congelados pela
#246. `recent-pred-card.tsx:37` (`text-edge-fg`) é só **referência** (token canônico de edge a
copiar) — nunca editar. O fix `[color-scheme:dark]` e a sombra compartilhada do segmented-control
vivem em date-range/league-tabs (home) → **movidos pro #323** (confirmado: zero `color-scheme`/input
de data no escopo dashboard). A ÚNICA sombra ad-hoc num arquivo de dashboard é
`dashboard-filters.tsx:75`.

## Vocabulário herdado (referência rápida — NÃO cunhar nada)

Tipografia (font-size only, leading herda → byte-idêntico): `text-eyebrow-xs`(9) `text-eyebrow`(10)
`text-meta`(11) `text-body-sm`(12) `text-body`(13) `text-label`(14) `text-display-sm`(18)
`text-display-md`(26) `text-display-lg`(32). Tracking: `tracking-label`(0.14em, eyebrow/badge mono
uppercase — absorve 0.14/0.12/0.1/0.08em ad-hoc), `tracking-eyebrow`(0.18em, section-label/marca),
`tracking-tight` (stock, absorve a banda negativa -0.035/-0.02/-0.01). Raio: `rounded-sm/md/lg/xl`
(`--radius`=10px → `rounded-sm`=6px, `rounded-md`=8px, `rounded-lg`=10px; `rounded-[Npx]` banido).
Largura: `max-w-content`(1040) `max-w-narrow`(480) `max-w-reading`(640, colapsa 680) `max-w-form`(380).
Cor semântica (ADR §"Mapa semântico de cor"): `edge-fg`/`edge-soft`/`edge-border` (ganho/over/
profit+), `destructive` (perda/−), `warn-fg`/`warn-soft`/`warn-border` (amostra pequena/aviso),
`accent-fg`/`accent-strong-fg` (accent/link), `muted-foreground`/`muted-fg-2` (secundário/terciário).
Série de gráfico: `var(--chart-1..5)` — **o token CRU, não o alias `--color-chart-N`** (ver decisão 1).
Foco visível: `focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50`
(+`rounded-sm` onde couber). Primitivas a consumir: `Badge` (eixo `size="xs"` = `h-[18px] px-2
text-eyebrow`, aditivo), `EmptyState` (override `className="py-6"` quando aninhado em card; base é
`max-w-narrow`=480 + `py-12`).

## Decisões globais (cross-file) e micro-decisões resolvidas

1. **bankroll-chart `#a78bfa` → `var(--chart-1)`** (linha 88 `stroke`, linha 91 `activeDot.fill`).
   - **CORREÇÃO CRÍTICA do review (Lens A11y, confirmada na CSS compilada):** usar **`var(--chart-1)`**,
     o token CRU emitido em `:root`/`.dark` — **NÃO** `var(--color-chart-1)`. O `globals.css` usa
     `@theme inline`, então o Tailwind v4 **inlina** os aliases `--color-*` dentro das classes
     utilitárias e **não os publica** como custom properties em runtime. Verificado contra
     `.next/static/css/f7e8dc2de7c0a7df.css`: `--color-chart-1` = **0** ocorrências; `--chart-1` =
     **2** (`:root` + `.dark`). A "prova" do rascunho ("linhas 64/80/83 usam `stroke=currentColor`,
     logo `var()` resolve") era falaciosa — `currentColor` é palavra-chave CSS-wide, não custom
     property; não prova nada sobre `--color-chart-1` existir na cascata. Com `var(--color-chart-1)`
     a linha renderizaria com stroke vazio/inválido (sem cor), matando o entregável inteiro.
     `var(--chart-1)` resolve via cascata a partir de `:root`/`.dark` (mesma cascata que
     `stroke="currentColor"` já usa nas linhas 64/80/83 — esse fato continua válido como prova de que
     atributos de apresentação SVG resolvem na cascata; só o nome do token estava errado). **NÃO**
     precisa de `getComputedStyle`/ref/className. Implementação: `stroke="var(--chart-1)"` e
     `activeDot={{ r: 3, fill: "var(--chart-1)" }}`.
   - **Hue (análise inalterada — os valores são do `--chart-1`):** `#a78bfa` = oklch(0.709 0.159
     **293.5**), um violeta. `--chart-1` **dark** = oklch(0.488 0.243 **264.376**) — o violeta que a
     tarefa nomeia ("violeta ~hue 263"); `--chart-1` **light** = oklch(0.646 0.222 **41.116**) —
     laranja-avermelhado. **Escolha = `chart-1`, por IDENTIDADE, não por hue mais próximo** (correção
     do framing, Lens Token): no dark, `--chart-4`(303.9) é geometricamente MAIS próximo do violeta
     fonte (Δ10.4 vs Δ29.2 do chart-1), mas (a) a tarefa nomeia exatamente o violeta do `chart-1`
     dark (264 ≈ 263); (b) `chart-4` no **light** vira oklch(... 84.4) = **amarelo** (Δ150.9 do
     fonte) — pior perda de identidade que o laranja do chart-1 (Δ107.6); (c) convenção shadcn: série
     única de linha usa o slot primário `chart-1`. Ambos os tokens "flipam" hue entre temas (a paleta
     de chart é genérica multi-série, não single-hue de marca). **Mudança consciente:** o hex fixo
     renderizava violeta nos DOIS temas; ao tokenizar, o dark fica azul-violeta (264, perto do alvo,
     preservado no tema **default** — `defaultTheme="dark"`, confirmado `app/layout.tsx`) e o light
     fica quente. ADR §B manda "série de gráfico sempre tokenizada, nunca hex" e rejeitou cunhar
     `--color-chart-profit` (Alternativa 7) — a regra é reusar série existente. **`/impeccable`
     valida light E dark** e deve **A/B chart-1 vs chart-4 NO DARK** (tema dominante; nenhum é
     pixel-match do violeta antigo, owner pode preferir o hue mais próximo). Se o flip de light for
     inaceitável, a saída sancionada pela ADR é outro slot `chart-N` (nunca hex/token novo).
   - **Empty-state (linhas 53-58):** mantém `h-[260px]` (paridade de CLS com o skeleton de
     loading.tsx:15 `h-[260px]`); só tokeniza o texto (ver matriz de empty-states). Copy verbatim:
     "Sem predições liquidadas ainda — o bankroll aparece após os jogos."

2. **predictions-table `UNDER` tone (linha 34) `text-sky-500` → `text-accent-fg`.** `sky` não tem
   token no mapa (ADR §"Mapa semântico" só tem edge/destructive/warn/accent; ADR:34 lista `sky-500`
   como outlier de 1 uso a remover). OVER (linha 33) mapeia pra `edge-fg` porque over = lado
   "edge/profit-positivo" por convenção da tela. UNDER é o **outro rótulo categórico de mercado** (par
   binário over/under), não lucro/prejuízo — então NÃO pode virar `destructive` (leria "under =
   perda", falso) nem `edge-fg` (colidiria com OVER, apagando a distinção categórica que o sky dava).
   `accent-fg` é o cobalt frio da app: mantém um **hue frio distinto** de `edge-fg` (verde),
   preservando "over vs under = dois rótulos contrastantes" sem inventar semântica de profit.
   PASS continua `text-muted-foreground`; tokens novos (1X2) caem no `text-foreground` via `recClass()`
   (inalterado). **Nota pro /impeccable (Lens Escopo):** `accent-fg` passa a fazer dupla função no
   dashboard (link da ação do empty + `bg-accent-fg/60` do progress-fill graduando + agora tom UNDER) —
   confirmar que a leitura categórica não confunde com "link".

3. **page.tsx h1 `text-[28px] lg:text-[32px]` (linha 54): manter 28px como outlier comentado +
   `lg:` → `lg:text-display-lg`(32).** 28 não tem degrau (gap display-md 26 → display-lg 32).
   `loading.tsx:8` usa `h-8 w-44` **fixo** (sem token de texto) → **zero acoplamento de CLS** nas duas
   opções. Escolha = **menor mudança visual**: colapsar 28→26 ENCOLHERIA o título base (contra a regra
   ADR "unificar pra cima, nunca encolher") e achataria contra o `lg:32`. Então: `text-[28px]` fica
   como arbitrário **comentado in-file** (espelha a política heroic-display da #246, ADR:162-166 —
   22/30px ficam `text-[Npx]` comentados, sem token), e o `lg:32` vira `lg:text-display-lg` (degrau
   exato). Também: `tracking-[-0.035em]`→`tracking-tight`, `leading-[1.05]`→`leading-none` (ADR §A.1).
   `/impeccable` confirma. (Se o owner preferir achatar no /impeccable, vira
   `text-display-md lg:text-display-lg` — mas a entrega base preserva 28.)

4. **market-segments valores numéricos não-stepping: 15px (ClvMetric) e 16px (StakeBands) → `text-label`(14).**
   Gap label(14)→display-sm(18); 15/16 ficam 1-2px acima de label. **Colapsar pra `text-label`**, não
   sancionar como outlier: (a) o delta de 1-2px é imperceptível por review (filosofia do colapso de
   meio-pixel da ADR); (b) são **valores de métrica secundária** densos (tabular-nums leading-none),
   não números-herói — sem justificativa heroic-display (a ADR reservou pro placar/odd da match page);
   (c) os scores 15px do match-row foram **DEFERIDOS pro #323** → não há lockstep cross-surface a
   manter. Sancionar mintaria dois arbitrários sem degrau e sem papel heroico. Colapso pra text-label
   nos dois. **Nota:** o `marketLabel` `text-[14px]` (market-segments) é swap byte-idêntico 14→14
   (`text-label`), entra no passo 2 (tokenização pura), não nesta decisão.

5. **dashboard-filters sombra (linha 75) `shadow-[0_1px_2px_rgb(0_0_0/0.4)]` → `shadow-sm`** + raio
   (linha 73) `rounded-[5px]` → `rounded-sm`. `shadow-sm` é stock Tailwind (já usado no Card) — eleva a
   pill ativa do segmented-control sem sombra ad-hoc calibrada só pro dark. **Flag /impeccable (Lens
   Token):** `rounded-[5px]`→`rounded-sm` é **+1px real** (5→6px; sem degrau menor: `rounded-md`=8px) —
   julgar no antes/depois da pill ativa junto com o swap de sombra. Os gêmeos em date-range-tabs:65 /
   league-tabs:87 são **deferidos pro #323**, que vai **espelhar esta decisão** (shadow-sm + rounded-sm).

6. **Matriz de EmptyState (4 estados divergentes).** Critério #246/ADR:171: empty "de página/seção
   solta" → primitivo `EmptyState`; empty "aninhado em card" → primitivo com override `className="py-6"`;
   empty que é só um `<p>` curto dentro de card já estruturado → **tokenizar o `<p>`**. **Copy
   preservada verbatim** (paridade de dados).
   - **page.tsx (linhas 62-81), Card-style com ícone Inbox+título+desc+ação:** → **`EmptyState`**
     primitivo embrulhado em `<Card>`. `icon={<Inbox className="size-10" strokeWidth={1.25} />}`,
     `title="Você ainda não tem predições"`, `description="Gere uma análise num jogo pra começar a
     trackear seu yield."`, `action={<Link href="/" className="…">Ver próximos jogos →</Link>}`.
     - **Geometria 380→preservada em 380 (CORREÇÃO do review, Lens Escopo):** o `<div>` interno hoje é
       `max-w-[380px]`; a base do `EmptyState` é `max-w-narrow`=**480** (+100px). Em vez de deixar o
       primitivo widenizar silenciosamente (o rascunho dizia "o primitivo resolve", inconsistente com a
       decisão 10 que listava `max-w-form` só como fallback), **preservar 380** passando
       `className="max-w-form py-6"` ao EmptyState. `cn`/twMerge resolve consumer-wins: `max-w-form`(380)
       sobrepõe o `max-w-narrow` base **e** `py-6` sobrepõe o `py-12` base (carve aninhado do #246, pra
       o py-12 shell-grade não somar com o padding `py-16` do Card). Resultado: largura byte-idêntica
       (380=380), padding aninhado correto. Decisão consciente registrada (não é widening não-flagado).
     - **Bump consciente de tipo (de-slop aceito, vem do primitivo):** título 15px→`text-label`(14) e
       desc 13px→`text-body-sm`(12) (ADR confirma: EmptyState renderiza título `text-label`+
       `tracking-tight`, desc `text-body-sm`+muted). O ring de foco do `action` Link entra via decisão 11.
   - **predictions-table (linhas 49-54), `<div>` cru:** → **`EmptyState`** primitivo (sem card — é o
     slot da tabela). `title="Nenhuma predição com esses filtros."`, sem ícone/desc/ação (paridade: hoje
     é uma frase só). Some o `text-[13px]`/`rounded-xl`/`border`/`bg-card` ad-hoc; o primitivo centraliza.
     **Conscious (Lens Escopo):** isto REMOVE o frame de card (`rounded-xl border bg-card`) que hoje
     emoldura a área vazia da tabela — é restruturação visual real (copy intacta, paridade de dado OK).
     `/impeccable` confirma que a área vazia sem moldura fica coerente; se o owner quiser o frame, embrulhar
     em `<Card>` (sem `py-6`, é slot solto) — entrega base é sem card.
   - **bankroll-chart (linhas 53-58), `<div>` cru com `h-[260px]`:** → **manter `<div>` tokenizado**
     (NÃO primitivo). O `h-[260px]` é **paridade de CLS** com o skeleton (loading.tsx:15) — o primitivo
     centraliza vertical mas não trava 260px; trocar arriscaria CLS. Só tokeniza o texto
     `text-[13px]`→`text-body`; mantém `h-[260px]` + `rounded-xl`(válido) + `border` + `bg-card`. Copy
     verbatim.
   - **market-segments (linha 151), `<p>` in-card:** → **tokenizar o `<p>`** (`text-[12.5px]`→
     `text-body-sm`). Frase curta dentro de um card já estruturado (`MarketSegmentCard`); o teste
     `market-segments.test.tsx` pina `toContain("Sem apostas resolvidas ainda")` → copy **byte-idêntica**,
     só muda o tamanho. Forçar EmptyState aqui seria peso sem ganho.

7. **Badge (consumir o primitivo, NÃO editar ui/badge.tsx).**
   - **market-segments "graduado" pill (linha 26):** hand-rolled (`bg-emerald-500/15 … rounded-[5px]
     text-[10px] tracking-[0.1em] text-emerald-500`, font-mono) → `<Badge variant="outline" size="xs"
     className="border-edge-border bg-edge-soft text-edge-fg tracking-label">graduado</Badge>`. Tom
     edge (ganho) pela semântica "graduou = bom". `size="xs"` traz `h-[18px] px-2 text-eyebrow` do
     primitivo (some o `text-[10px]`/`rounded-[5px]`); `tracking-[0.1em]`→`tracking-label`. **Flag
     consciente (Lens Token):** a pill hoje é `font-mono`; o Badge primitivo é **sans** → mudança de
     família mono→sans no texto "graduado". Aceita como de-slop (alinha com os Badges da app);
     `/impeccable` confirma. **Texto "graduado" verbatim** (teste `toContain("graduado")` verde; o ramo
     graduando não renderiza a pill → `not.toContain("graduado")` verde, "graduando" ≠ substring de
     "graduado" — divergem no char index 6).
   - **predictions-table liga badge (linha 102):** já é `<Badge variant="outline">` com classes
     hand-rolled (`h-[18px] rounded-full px-2 text-[9.5px] uppercase tracking-[0.1em]
     text-muted-foreground`) → adotar o eixo `size="xs"`: `<Badge variant="outline" size="xs"
     className="uppercase tracking-label text-muted-foreground">`. `size="xs"` dá `h-[18px] px-2
     text-eyebrow`; some `h-[18px]`/`text-[9.5px]`/`rounded-full` (base do Badge já é rounded-full);
     `tracking-[0.1em]`→`tracking-label`. **Micro de-slop consciente (3 lentes):** 9.5px→`text-eyebrow`(10)
     é crescimento de 0.5px (não o 9.5→9 que a regra de meio-pixel daria) — `/impeccable` confirma que a
     liga **não estoura** a coluna "liga". (A regra de meio-pixel cede pro eixo de tamanho da fundação:
     `size="xs"` é a fonte canônica do tamanho de badge.)
   - **progress-fill (linha 39)** `graduation.graduated ? "bg-emerald-500"` → `"bg-edge-fg"`
     (preenchimento da régua graduada = semântica edge). `bg-accent-fg/60` (ramo graduando) já é token —
     fica.

8. **ClvLine-vs-empty hierarchy (market-segments linhas 84-101 / 149-160): MANTER a ordem atual —
   ✅ RESOLVIDO PELO OWNER (2026-06-18): manter a ordem (CLV acima do placeholder); o critério de
   aceite escrito do #322 é corrigido pra refletir que a ordem é intencional. NÃO gatear ClvLine.** A issue lista "hierarquia ClvLine↔empty
   corrigida" no **Critério de aceite** (não só como achado de corpo). O comentário de código (linhas
   84-86) documenta a ordem como **deliberada**: CLV vive FORA do gate `empty` porque aparece assim que
   há closing line capturada, **antes** de qualquer aposta liquidar — esse é o ponto do CLV (valor de
   linha de fechamento é informativo pré-settlement). E `ClvLine` retorna `null` quando
   `clvOddsRatio.n === 0`. Logo um segmento `empty` SEM closing line não mostra nada de ClvLine; o
   cenário que a issue teme só ocorre com closing line capturada mas ainda não liquidada — o caso legítimo
   que o comentário defende. **Refino do rationale (Lens Escopo):** reordenar é mudança **só de ordem**
   (os mesmos dois blocos — CLV e placeholder — renderizariam, em ordem visual diferente), NÃO de
   qual-dado-renderiza; logo é data-safe nos dois sentidos. O argumento NÃO é "reordenar muda paridade";
   é "o comentário documenta a hierarquia atual como prioridade semântica deliberada". **Mérito favorece
   manter** — mas um plano não pode sobrepor um critério de aceite ESCRITO sem o owner. Por isso isto vai
   pra "Questões em aberto pro owner" (Lens A11y), não pra execução autônoma. Default proposto: **manter a
   ordem** (comentário ganha); alternativa, se o owner quiser o critério literal, é gatear ClvLine atrás de
   `!segment.empty`.

9. **predictions-table tabela 10 colunas (linhas 49-155): NÃO adicionar `overflow-x-auto` — só
   verificar (CORREÇÃO do review, Lens A11y).** A premissa da issue ("sem overflow-x") é **imprecisa**:
   `components/ui/table.tsx:7-10` já embrulha TODO `<table>` em `<div data-slot="table-container"
   className="relative w-full overflow-x-auto">`. Logo a tabela de predições **já rola horizontalmente**
   dentro do card hoje. Adicionar `overflow-x-auto` ao `<div>` externo (`rounded-xl border bg-card`,
   linha 58) criaria scroll context aninhado e faria a **borda arredondada rolar junto** com o conteúdo
   (pior UX) ou seria redundante. **Resolução: NÃO mexer no wrapper externo.** `/impeccable` confirma que
   o `table-container` interno já rola as 10 colunas no mobile com a borda fixa. Se for julgado
   insuficiente, a saída é `min-w-` na `<table>` (não overflow no wrapper com borda) — mas verificar o
   comportamento do primitivo PRIMEIRO. `max-w-[220px]` na célula jogo (linha 91) é clamp funcional de
   conteúdo, fica. **Colapsar/esconder coluna seria mudança de informação, barrada por paridade.**

10. **Tokens de container (lockstep obrigatório):**
    - `page.tsx:52` `max-w-[1040px]` → `max-w-content` ⟷ **lockstep** com `loading.tsx:7`
      `max-w-[1040px]` → `max-w-content` (byte-idêntico, 1040=1040, sem geometria).
    - `prediction-detail.tsx:71` `max-w-[680px]` → `max-w-reading` ⟷ **lockstep** com
      `[predictionId]/loading.tsx:7` `max-w-[680px]` → `max-w-reading`. **Mudança de geometria real
      (pequena): 680→640px** (−40px de largura de leitura — racional/fatores refluem um pouco mais
      estreitos), sancionada pela ADR (colapso documentado 680→640). Os dois TÊM que mover juntos senão o
      skeleton diverge do live (CLS).
    - `error.tsx:23` `max-w-[480px]` → `max-w-narrow` (byte-idêntico, 480=480).
    - `page.tsx:64` `max-w-[380px]` → **preservado em 380 via `EmptyState className="max-w-form py-6"`**
      (decisão 6; geometria byte-idêntica, não vira 480).

11. **Focus rings (a11y, ADR:114) — adicionar
    `focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50` (+`rounded-sm`
    onde apto) em todo controle interativo custom de dashboard:**
    - `dashboard-filters.tsx:68` — o `<Link>` dentro de `options.map` renderiza **TODAS** as pills
      (ativa + inativas). **CORREÇÃO do review (Lens A11y):** o ring vai no `cn(...)` **compartilhado**
      (linhas 72-77), NÃO no ramo ativo-only (linha 75) — senão pills inativas ficam sem foco visível.
      +`rounded-sm` (combina com o raio que a pill ganha na decisão 5).
    - `predictions-table.tsx:92` Link do título do jogo — +`rounded-sm`.
    - `predictions-table.tsx:140` Link do chevron (`aria-label="Abrir predição"`) — +`rounded-sm`.
    - `prediction-detail.tsx:36` **`<summary>`** (RawPayload, `cursor-pointer select-none`) — controle
      focável por teclado, hoje só com outline default. **NOVO (Lens A11y):** adicionar
      `focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 rounded-md` (raio
      casa com o `rounded-lg` do `<details>` container). prediction-detail já está em edição → custo zero.
    - `page.tsx` Link de ação do empty-state — entra via `action={<Link className="… focus-…">}` do
      EmptyState; +`rounded-sm`. `href="/"` preservado.
    - `error.tsx:42` Link "Início" — +`rounded-sm`.
    - `error.tsx:39` `<Button>` é `ui/button` (ring via cva) → **nada a fazer**.
    - `prediction-detail.tsx:72` `<BackLink>` (back-link.tsx) **já tem** o ring (`rounded-sm
      focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50`, verificado) →
      **nada a fazer**, só confirmar.

## Pares de skeleton em lockstep (anti-CLS) — mapeados

- `loading.tsx` (container) ⟷ `page.tsx` (container): `max-w-[1040px]`→`max-w-content` nos dois, **no
  mesmo passo**. Estruturas já alinhadas (grid-cols-2 lg:grid-cols-4, chart h-[260px]); alturas fixas
  `h-8`/`h-4`/`h-[120px]`/`h-[260px]`/`h-[340px]` são sizing de skeleton, **ficam** (deferral anti-CLS
  da ADR). O h1 de page.tsx vira 28(outlier)/display-lg(32) mas o skeleton é `h-8` fixo → sem divergência.
- `[predictionId]/loading.tsx` (container) ⟷ `prediction-detail.tsx` (container): `max-w-[680px]`→
  `max-w-reading`(640) nos dois, **no mesmo passo** (a geometria 680→640 muda nos dois juntos). O `px-6
  py-8` casa nos dois — fica.

## Ordem de execução (passos, do menor risco pro maior)

> Cada passo é um diff coeso. Nenhum toca arquivo fora da allowlist. Os pares de container andam SEMPRE
> no mesmo passo.

1. **Containers em lockstep (mecânico, baixo risco):** `page.tsx:52`+`loading.tsx:7`→`max-w-content`;
   `prediction-detail.tsx:71`+`[predictionId]/loading.tsx:7`→`max-w-reading` (anota a geometria 680→640);
   `error.tsx:23`→`max-w-narrow`.
2. **Token swaps de tipo/tracking puros (sem cor/primitiva), leaf, sem golden:**
   - `error.tsx`: 27 `text-[18px]`→`text-display-sm`; 30 `text-[13px]`→`text-body`; 33 `text-[11px]`→
     `text-meta`; 44 `text-[13px]`→`text-body`.
   - `kpi-cards.tsx`: 10/38/90/106 `text-[10px]`→`text-eyebrow`; 38/90 `tracking-[0.14em]`→
     `tracking-label`; 46/99 `text-[26px]`→`text-display-md`; 46/100 `tracking-[-0.02em]`→`tracking-tight`;
     111 `text-[11px]`→`text-meta`. (Confirmar: `leading-none` em 46/100 fica.)
   - `prediction-detail.tsx`: 17/27 `text-[10px]`→`text-eyebrow` + `tracking-[0.14em]`→`tracking-label`;
     20 `text-[13px]`→`text-body`; 36 `text-[11px]`→`text-meta` + `tracking-[0.12em]`→`tracking-label`;
     39 `text-[11px]`→`text-meta` (`leading-relaxed`/`max-h-[420px]`/`overflow-auto` ficam); 74
     `text-[22px]`→**outlier comentado** (heroic-display, espelha #246: detail é título-herói da tela;
     gap 18→26) `tracking-[-0.02em]`→`tracking-tight`; 77 `text-[11px]`→`text-meta`; 112 `text-[13px]`→
     `text-body`; 119 `text-[13.5px]`→`text-body`(13, meio-pixel colapsa; `leading-relaxed` fica); 122
     `text-[12.5px]`→`text-body-sm`(12); 153 `text-[13px]`→`text-body`; 185 `text-[12.5px]`→`text-body-sm`.
   - `market-segments.tsx` (só os de tipo/tracking neutros): `text-[10px]`/`text-[11px]` →
     `text-eyebrow`/`text-meta` nos eyebrows/section-labels; `tracking-[0.14em]`→`tracking-label`; o
     `text-[9.5px]`→`text-eyebrow-xs` + `tracking-[0.1em]`→`tracking-label`; `tracking-[0.1em]`→
     `tracking-label`; `marketLabel` `text-[14px]`→`text-label` (byte-idêntico); o section-label
     `text-[10.5px]`→`text-eyebrow` + `tracking-[0.18em]`→`tracking-eyebrow` (espelha page.tsx:90).
   - `page.tsx`: 54 h1 (28 outlier comentado + `lg:text-[32px]`→`lg:text-display-lg`,
     `tracking-[-0.035em]`→`tracking-tight`, `leading-[1.05]`→`leading-none`); 57 `text-[13.5px]`→
     `text-body` (`tracking-tight` fica); 90/93 `text-[10.5px]`→`text-eyebrow`, 90 `tracking-[0.18em]`→
     `tracking-eyebrow`.
   - `predictions-table.tsx` (tipo/tracking): 77 `text-[9.5px]`→`text-eyebrow-xs` + `tracking-[0.12em]`→
     `tracking-label`; 107/111/124 `text-[11.5px]`→`text-meta`; 115/118/121/129 `text-[12px]`→`text-body-sm`.
   - `dashboard-filters.tsx`: 61 `text-[9.5px]`→`text-eyebrow-xs` + `tracking-[0.14em]`→`tracking-label`;
     73 `text-[11.5px]`→`text-meta` (`leading-6` fica).
   - `bankroll-chart.tsx:40` ChartTooltip `text-[11px]`→`text-meta` (`rounded-md`/`shadow-sm` válidos,
     ficam).
   - **Clamps de conteúdo funcionais que FICAM (sizing, não token de escala):**
     `predictions-table.tsx:91` `max-w-[220px]`, `prediction-detail.tsx:39` `max-h-[420px]`, e as alturas
     `h-[120px]/h-[260px]/h-[340px]` dos skeletons.
3. **Cor semântica (mapa ADR §"Mapa semântico"):**
   - `error.tsx:24` `text-amber-500`→`text-warn-fg`.
   - `kpi-cards.tsx`: 11 `text-amber-500`→`text-warn-fg`; 101 `text-emerald-500`/`text-red-500`→
     `text-edge-fg`/`text-destructive`.
   - `market-segments.tsx`: ClvMetric tone `text-emerald-500`/`text-red-500`→`text-edge-fg`/
     `text-destructive`; `text-amber-500`→`text-warn-fg` (ClvMetric e StakeBands); valores 15/16px→
     `text-label` (decisão 4); `tracking-[-0.01em]`→`tracking-tight`.
   - `predictions-table.tsx`: 22 `text-emerald-500`→`text-edge-fg`; 23 `text-red-500`→`text-destructive`;
     33 OVER `text-emerald-500`→`text-edge-fg`; 34 UNDER `text-sky-500`→`text-accent-fg` (decisão 2);
     133-134 profit `text-red-500`/`text-emerald-500`→`text-destructive`/`text-edge-fg`.
   - `prediction-detail.tsx`: 57-62 `clvTone` + 63-68 `resultClass` `text-emerald-500`/`text-red-500`→
     `text-edge-fg`/`text-destructive`; **137/138** lucro `text-red-500`/`text-emerald-500`→
     `text-destructive`/`text-edge-fg` (o bloco `cn` da Row de lucro vai de 135 a 139; 136 é a condição,
     137 o ramo `-`, 138 o ramo `+` — citação confirmada contra o arquivo).
4. **Raio/sombra:** `dashboard-filters.tsx:73` `rounded-[5px]`→`rounded-sm`; `:75` `shadow-[…]`→
   `shadow-sm` (decisão 5; flag +1px no /impeccable); `market-segments.tsx:26` `rounded-[5px]` resolvido
   pela troca pra Badge (passo 6).
5. **Foco visível (a11y):** rings em `dashboard-filters.tsx:68` (className COMPARTILHADO, não ativo-only),
   `predictions-table.tsx:92,140`, `prediction-detail.tsx:36` (`<summary>`), `error.tsx:42`, e no `action`
   Link do EmptyState de page.tsx (decisão 11). Confirmar BackLink do prediction-detail (já tem) e Button
   do error.tsx (cva, já tem).
6. **Primitivas — Badge:** `market-segments.tsx:26`+`:39` (pill graduado + progress-fill) e
   `predictions-table.tsx:102` (liga badge) (decisão 7).
7. **Primitivas — EmptyState (maior diff estrutural):**
   - `page.tsx:62-81` Card-style → `<Card className="px-8 py-16 text-center"><EmptyState
     className="max-w-form py-6" icon={…} title=… description=… action={<Link …/>}/></Card>` (decisão 6;
     **largura 380 preservada via `max-w-form`**). Import de `EmptyState`; `Card`/`Inbox`/`Link` seguem
     usados (Card no wrapper, Inbox no ícone, Link no action) → **sem import órfão**; mas o `pnpm lint`
     pós-edit é o guarda (improvement Lens Teste/A11y).
   - `predictions-table.tsx:49-54` `<div>` → `<EmptyState title="Nenhuma predição com esses filtros." />`
     (decisão 6; sem card, perde o frame — conscious).
   - `bankroll-chart.tsx:53-58` `<div>` → mantém `<div>`, só `text-[13px]`→`text-body` (decisão 6).
   - **NÃO** adicionar `overflow-x-auto` na tabela (decisão 9 — o primitivo `ui/table.tsx` já dá).
8. **bankroll-chart cor de série:** `:88` stroke + `:91` `activeDot.fill` `#a78bfa`→**`var(--chart-1)`**
   (decisão 1 — token CRU, não `--color-chart-1`).

## Testes (auditados — baixa fragilidade; NENHUM re-snapshot)

- `components/__tests__/odds-card-parity.golden.test.tsx` — importa só OddsCard/MatchRow/
  UpcomingMatchesDesktop; **NÃO cobre nenhum arquivo de dashboard**. Como **não tocamos** `ui/badge.tsx`/
  `card.tsx`/`separator.tsx`/`team-avatar.tsx`/`table.tsx`, o golden fica **byte-idêntico** — tem que
  passar SEM update.
- `components/__tests__/market-segments.test.tsx` — `renderToStaticMarkup` + `toContain` em texto/dado,
  zero classe pinada. Verde porque a **copy é preservada verbatim**: `toContain("graduado")` (Badge mantém
  o texto literal como child, não aria-label/ícone), `not.toContain("graduado")` no ramo graduando (a pill
  não renderiza; "graduando" ≠ substring de "graduado"), `toContain("Sem apostas resolvidas ainda")` (o
  `<p>` só muda de tamanho), `"32 / 30 resolvidas"`/`"1u"/"2u"/"3u"/"+5%"/"+12%"`. **Sem update esperado.**
- `components/__tests__/dashboard-filters.test.ts` — testa só `buildDashboardHref` (função pura, sem
  render). **Imune** a qualquer edição de classe.
- Sem testes importando `bankroll-chart`/`kpi-cards`/`predictions-table`/`prediction-detail`.

## Verificação

Tríade + build, nesta ordem exata, TODAS verdes:
`pnpm typecheck && pnpm lint && pnpm test --no-file-parallelism && pnpm build`. `--no-file-parallelism`
é **obrigatório** local (flake do pglite em 8-core; vitest 4 rejeita o antigo
`--poolOptions.forks.maxForks`). CI roda a mesma tríade em 2-core sem o flag. Guardas extras:
- **Golden sem churn:** `pnpm test odds-card-parity.golden` → **0 diff**, sem update.
- **Grep anti-resíduo (Lens A11y/Teste):** nos arquivos in-scope pós-edit, procurar qualquer
  `text-[Npx]`/`tracking-[Nem]`/`rounded-[Npx]`/`shadow-[..]`/`emerald-`/`red-`/`amber-`/`sky-`/`#hex`
  remanescente, **exceto** os dois outliers comentados (page.tsx h1 28px, prediction-detail h1 22px) e os
  clamps funcionais (`max-w-[220px]`, `max-h-[420px]`, skeleton `h-[..]`). **E grep por `var(--color-`** —
  qualquer `var(--color-*)` cru fora de classe utilitária é referência que NÃO resolve (dado o
  `@theme inline`); a série de chart tem que estar `var(--chart-1)`.
- **CSS rebuild check:** após o build, `grep '--chart-1'` na CSS gerada deve achar o token em `:root`/
  `.dark` e a linha do bankroll deve renderizar o oklch violeta no dark.

Visual: dashboard é session-gated (`force-dynamic` + auth) → o owner faz o `/impeccable` antes-vs-depois no
**preview Vercel logado**, light/dark + mobile/desktop, validando: (a) a linha do bankroll em ambos os temas
(decisão 1 — confirmar o violeta em dark, **A/B chart-1 vs chart-4 no dark**, julgar o flip em light);
(b) over/under com hues distintos na tabela (e accent-fg não confundir com link); (c) a tabela rolando
horizontal no mobile pelo `table-container` interno do primitivo, com as 10 colunas e a **borda fixa**
(decisão 9); (d) o h1 28/32; (e) o reflow 680→640 do detail; (f) a liga badge (9.5→10) sem estourar a
coluna; (g) graduado mono→sans; (h) +1px da pill ativa (rounded 5→6 + shadow-sm); (i) o foco visível em
toda pill (ativa e inativa) e no `<summary>`; (j) Radix sheet/popover ainda montam sob
`prefers-reduced-motion` (herdado do bloco global #321). Diff tem que ser **apresentação-only**.
**"Fecha #322" PT-BR não auto-fecha** → fechar manual após merge verde.

## Desvios conscientes do texto da issue

- **`overflow-x-auto` NÃO é adicionado** (decisão 9): a issue diz "sem overflow-x", mas `ui/table.tsx`
  JÁ embrulha a tabela em `overflow-x-auto`. Adicionar de novo (no wrapper externo com borda) seria
  regressão de UX. Só verificamos o comportamento existente.
- **`#a78bfa` → `var(--chart-1)`** (token CRU, não `--color-chart-1`), com flip de hue consciente em light
  (decisão 1): tokeniza conforme a ADR (nunca hex), preservando o violeta no tema default (dark); o light
  fica quente — `/impeccable` julga.
- **h1 28px (page) e título 22px (detail) ficam como outliers comentados** (decisões 3 e passo 2):
  espelham a política heroic-display da #246 (ADR:162-166), sem cunhar token, em vez de colapsar pra
  display-md.
- **page.tsx empty preserva 380px** via `EmptyState className="max-w-form py-6"` (decisão 6/10): evita o
  widening silencioso pra 480 que a base do primitivo traria; geometria byte-idêntica.
- **Escopo dashboard-only:** a issue lista date-range-tabs/league-tabs/match-row/upcoming-*/desktop-status-
  cell/recent-pred-card em "Rotas/componentes", mas o owner ratificou dashboard-only nesta sessão → esses
  (+ o fix `[color-scheme:dark]` e a sombra do segmented-control da home) vão pro **#323**.

## Questões em aberto pro owner — ✅ TODAS RESOLVIDAS → ready-to-implement

- **Hierarquia ClvLine↔empty (market-segments, decisão 8): ✅ RESOLVIDO (owner, 2026-06-18) = MANTER a
  ordem atual.** O CLV-antes-de-liquidar é deliberado (sinal pré-jogo é o ponto do CLV) e ClvLine já
  retorna `null` em `n===0`. Reordenar/gatear seria contraproducente; gatear atrás de `!segment.empty`
  seria mudança FUNCIONAL fora do guard-rail "só apresentação". **Ação:** o texto do critério de aceite
  do #322 foi corrigido pra registrar que a ordem é intencional (não há "hierarquia a corrigir" aqui).

## Fora de escopo (NÃO fazer)

Qualquer mudança de query/cálculo (yield/CLV/edge/bankroll)/filtro/rota. Editar `ui/*` (incl. `table.tsx`),
`empty-state.tsx`, `back-link.tsx`, `team-avatar.tsx`, `globals.css`. Cunhar token (tipo/cor/sombra) —
incl. `--text-display-xs` e `--color-chart-profit` (ambos rejeitados pela ADR). Tocar qualquer arquivo da
home/público (#323), admin (#324), perfil (#325), shell, ou `[predictionId]/page.tsx`. Re-snapshot do
golden. Adicionar `overflow-x-auto` na tabela. Usar `var(--color-chart-N)` (não resolve em runtime).
