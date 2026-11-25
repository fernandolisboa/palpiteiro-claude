# PLAN-683 — "O que pesou" no palpite

Issue: #683. Snapshot de 2026-11-25, conferido no branch `claude/project-thread-3gxnu3` (HEAD `a8a544d` = `origin/main`, já com a C1 do #672). Arquivo histórico, não spec viva (ver `docs/plans/README.md`).

Desenho aprovado: `/mnt/project-files/destaque-fatores/v6/` (`proposta-v6.md`, `v6-arcos-baixos.html`, `v6-c-raciocinio-vira.html`, prints `v6-arcos-baixos-*-mobile.png` e `v6-c-raciocinio-*-mobile.png`). Achados de dado das rodadas anteriores em `../proposta.md` e `../v2..v5/proposta-*.md`. Os scripts do mock (`scratchpad/fx/calc.ts`, `v6-new.cjs`, `build-v5.cjs`) são referência de geometria e de conta; o código do app reescreve a lógica em funções puras tipadas.

## 0. Sanity-check (faz sentido?)

Sim. Desde o #668 (ADR 0072) o palpite é decidido em código, então "por que deu Boca?" tem resposta exata: a base (mercado sem margem ou Dixon-Coles) mais os multiplicadores de cada fator. Hoje essa resposta não aparece em lugar nenhum. O "Ver raciocínio" fala dos fatores em palavras, mas não diz quanto cada um mexeu, nem se algum virou o resultado. O custo é baixo: nenhuma chamada paga, nenhuma migration, sem mudança de prompt. O risco está na regra de firewall (% no HERO e no /p), que precisa de emenda de ADR explícita (§9).

Três fatos do código que mudam o que a issue supõe:

1. **O clamp de ±15% por time nunca corta com os pesos de hoje.** Cada λ recebe 4 fatores (`lib/ai/judgments/apply.ts`, `FACTOR_EFFECT`): ataque próprio (−6%), defesa do adversário (+6%), rodízio próprio (−5%) e peso do jogo próprio (+3%). O produto fica sempre entre 0,94 × 0,95 = 0,893 e 1,06 × 1,03 = 1,092, dentro de [0,85; 1,15]. Mesmo assim o corte proporcional entra (§3.3): os pesos são código versionado (`JUDGMENT_WEIGHTS_VERSION`) e podem mudar. O teste usa multiplicadores sintéticos.
2. **Notícia já é origem de fator.** Na C2 do #672, `predict.ts` passa a gravar `judgments.news.evidence` e o λ da análise reflete JEV ∨ notícia ∨ usuário, combinados por MÁXIMO (PLAN-672 §6/§7). O tipo `PredictionJudgments.news?: { evidence }` já existe na `main` (`lib/ai/engine/types.ts`). A atribuição de origem deste plano lê esse campo desde já, então a C2 chega sem mudança aqui. Até ela entrar o campo vem vazio, e nenhum fator sai como "notícia".
3. **O valor final de cada pergunta é o máximo entre as fontes, e o multiplicador gravado já é o desse máximo.** `judgments.multipliers.{home,away}.factors[questionId]` traz o multiplicador aplicado, com tudo já combinado. A origem é quem deu o máximo: a mesma regra do `claimEffect` (`lib/user-palpite/evidence.ts`) e do `applyNewsClaims` (`lib/match-news/apply.ts`).

## 1. Escopo

**Entra**
- O cálculo puro do efeito de cada fator, em sequência sobre o λ base, gravado em `headline.pick.weighed` (jsonb, sem migration). Calculado nas duas bases: `market` e `dc_jev`.
- O view model puro do bloco, em `lib/view/`. Leitura do jsonb com Zod, raias, barra, listras, arcos, resumo, texto para leitor de tela e filtro público.
- O bloco no HERO (`palpite-hero.tsx`), no "Ver raciocínio" (`reasoning-dialog.tsx`) e no `/p` (`public-palpite.tsx`), sem os fatores do contexto do usuário.
- CSS e animação em `app/globals.css`: bolinhas nas raias e nos arcos em sequência, listras andando e regra própria de movimento reduzido.
- Emendas das ADRs 0030 §3, 0065 §2, 0035 §2(d) e 0072 §9, e o ajuste dos guards de `%` nos testes.

**Não entra**
- Palpite ao vivo (`generateLivePalpites`, `palpites_live_v2`): sem `pick`, sem bloco.
- Palpite do v13 (LLM escolhe, sem fonte de λ): sem `pick`, sem bloco.
- Sets antigos sem `pick.weighed`: sem bloco, sem backfill.
- Imagem OG (`og-palpite-image.tsx`) e prévia da landing: sem bloco.
- Prompt e cartuchos: o bloco não vai ao LLM. O `model-pick.ts` monta o `pick` do prompt campo a campo (`outcome, score, firstHalfScore, firstToScore, probs`), então `weighed` nunca entra na mensagem. Sem bump de cartucho, sem quebra de cache.
- Caminho "fresco" da action (`app/actions/predictions.ts:1175`): o HERO ignora a view devolvida pela action em sucesso, porque o revalidate traz `heroPalpite` do servidor (comentário em `palpite-hero.tsx:~212`). Sem `teams` ali, a view sai sem `weighed`. Ficar fora evita conflito com a C2, que mexe em `analyzeBestBet`.

## 2. Forma do dado (`headline.pick.weighed`)

Novo módulo puro `lib/ai/palpites/weighed.ts`:

```ts
export const PALPITE_WEIGHED_VERSION = "palpite_weighed_v1" as const;

export type OutcomeTriple = { home: number; draw: number; away: number };

// Origem de quem deu o MÁXIMO na pergunta. Gravada como string: o leitor (lib/view)
// aceita origem desconhecida (cai em rótulo neutro) e o /p esconde tudo o que não está
// na lista pública.
export type WeighedOrigin = "jev" | "news" | "user";

export type WeighedFactor = {
  key: string;            // JudgmentQuestionId hoje ("attack_weakened_home"); chave da frase
  lambdaSide: "home" | "away"; // qual λ ele multiplica (o lado em multipliers.{side}.factors)
  origin: string;         // WeighedOrigin
  value: number;          // noul de quem deu o máximo, 2 casas (força: forte/moderado, conferido)
  multiplier: number;     // efetivo, depois do corte proporcional do clamp, 6 casas
  pp: OutcomeTriple;      // efeito cru em pp, 2 casas (soma ≈ 0)
  pts: OutcomeTriple;     // inteiro, soma 0; Σ fatores = finalPts − basePts (por resultado)
};

export type PalpiteWeighed = {
  version: typeof PALPITE_WEIGHED_VERSION;
  baseProbs: OutcomeTriple;   // P(1X2) da matriz base (sem fator), pp 2 casas
  baseOutcome: MatchOutcome;  // mostLikelyOutcome(base), mesma regra do pick
  basePts: OutcomeTriple;     // inteiros, soma 100 (maior resto)
  finalPts: OutcomeTriple;    // inteiros, soma 100 (maior resto sobre o P final do pick)
  factors: WeighedFactor[];   // na ordem em que foram aplicados (§3.2); [] = nada mexeu
  clamped: { home: boolean; away: boolean };
};
```

`PalpitePick` (`lib/ai/palpites/pick.ts`) ganha `weighed?: PalpiteWeighed | null`:
- ausente nos sets anteriores;
- `null` quando não deu para decompor (§3.5);
- objeto quando deu.

A view lê só `pick.weighed` (e `pick.outcome`/`pick.source`), sempre por Zod (§4.1).

**Por que `pts` e não `moves[]`** (a issue sugere `moves: [{from,to,pts}]`). As raias saem de `pts` por uma regra determinística de apresentação: quem perdeu manda para quem ganhou, o destino mais perto primeiro (`movesOf`, §4.2). Gravar as duas formas duplicaria o dado e abriria espaço para incoerência. Gravando `pts`, a regra das raias muda sem bump de versão. Se a revisão preferir `moves` gravado, é só acrescentar o campo: o leitor ignora campo extra.

**Tolerância a origem nova.** `origin` é `string` no jsonb e `z.string()` no leitor. O mapa de rótulos tem fallback neutro ("ajuste do modelo"). O `/p` usa lista branca (`jev`, `news`) e trata o resto como não público (§6). Uma origem futura (por exemplo "escalação") entra sem quebrar sets.

## 3. Algoritmo (`lib/ai/palpites/weighed.ts`, puro)

### 3.1 Entrada: fatores e origens de cada análise

`weighedFactorInputs(judgments: PredictionJudgments | null | undefined): WeighedInputs | null`, onde
`WeighedInputs = { factors: { key, lambdaSide, multiplier, origin, value }[]; applied: Pair; product: Pair }`.

- Só `engine === "code_jev"` com `multipliers` presentes. Sem isso → `null` (sem fator).
- Para cada lado `s` e cada `[key, m]` de `multipliers[s].factors`, entra o fator com `m !== 1`. O lado vem da posição: `defense_weakened_away` aparece em `home.factors` porque multiplica o λ do mandante. Não duplica a tabela `FACTOR_EFFECT`.
- **Origem.** Com `jev = answers?.[key]?.value ?? 0`, `news = news?.evidence?.[key] ?? 0` e `user = userContext.evidence[key] ?? 0`:
  - `user` quando `user > max(0.5, jev, news)`;
  - senão `news` quando `news > max(0.5, jev)`;
  - senão `jev`.
  - `value` é o da origem escolhida.
  - Empate fica com a fonte anterior (JEV antes de notícia, notícia antes de usuário): é a regra do `claimEffect` (o usuário só move com noul estritamente maior) e do `applyNewsClaims`.
- **`userContext` ilegível** (`PredictionUserContextSchema.safeParse` falha): devolve `null`, e o bloco não aparece. É a mesma prudência do `synthesisFactorPhrases` (#565): na dúvida, nenhum fator.
- **Fator com `value ≤ 0.5` e `m ≠ 1`** (linha anterior à regra unilateral do `factorMultiplier`): entra como está. Se a soma não bater, quem barra é a conferência do §3.5.

`AnalysisJudgmentsModel` (`lib/ai/palpites/synthesis-input.ts`) ganha `factors?: WeighedInputs | null`, preenchido em `judgmentsModelOf` por uma linha: `factors: weighedFactorInputs(j)`. Vale nos dois caminhos (em memória e histórico), porque os dois passam por `summarizeSources`.

### 3.2 Ordem

Fixa, para ser determinística e invariante à ordem das análises:
1. por origem: `jev` → `news` → `user` (desconhecida por último, ordem alfabética);
2. dentro da origem, ordem canônica `JUDGMENT_FACTORS` × (`home`, `away`), a mesma de `judgmentFactorPhrases`.

Com isso, "você contou" é o efeito marginal do contexto sobre o modelo, que é a leitura natural. O mock usa a mesma ordem.

**Alternativa considerada e não adotada:** Shapley (média sobre as ordens; com até 8 fatores são 256 matrizes). É justo e não depende de ordem, mas a issue pede sequencial e o achado da v1 (`proposta.md` §2) mediu diferença ≤ 0,1 pt contra tirar um por vez. Fica como acompanhamento se aparecer caso real com ordem relevante.

### 3.3 Corte do clamp, proporcional em log

Por lado `s`, com os fatores `F_s` daquele λ:
- `L_s = Σ ln m_i`, `A_s = ln(applied_s)`, onde `applied_s` = `multipliers[s].applied` gravado.
- Se `|L_s − A_s| ≤ 1e-12`: `m_i' = m_i`, sem corte.
- Senão: `c_s = A_s / L_s` e `m_i' = exp(c_s · ln m_i)`; `clamped[s] = true`.
- Garantia: `Π m_i' = applied_s`.

Dentro de [0,85; 1,15], o produto só sai do intervalo na direção do sinal de `L_s`, então `c_s ∈ (0, 1)` e todos os fatores encolhem na mesma proporção, sem trocar de sinal. Com pesos de hoje isso nunca acontece (§0.1).

### 3.4 Sequência sobre a matriz

Entrada: `base: Pair` (o `PalpiteBase.base`: fit do mercado ou `judgments.lambda.base`), `rho`, os fatores ordenados com `m'` e o `P` final cru do pick.

```
λ = base; p_0 = p1X2(scorelineMatrix(λ.home, λ.away, { rho }))
para cada fator i: λ[lambdaSide_i] *= m_i'; p_i = p1X2(matriz(λ)); Δ_i = (p_i − p_{i−1}) × 100
```

- `baseProbs` = `p_0` (pp, 2 casas); `baseOutcome` = `mostLikelyOutcome(p_0)`.
- **Conferência:** `|p_último − p_pick| < 1e-6` por resultado, onde `p_pick` é o cru de `pickFromBase`. Garante que a decomposição fecha com o palpite exibido. A soma dos `Δ` é telescópica, igual a `p_final − p_0`.

### 3.5 Quando não decompor

`weighed: null`, com `console.warn` `{scope:"palpite_weighed", reason}`, quando:
- a conferência do §3.4 falha;
- `Π m_i'` difere de `pick.multipliers` (= `adjusted/base`) em mais de 1e-6 relativo, num lado;
- há multiplicadores no pick mas a análise de origem não tem `factors`.

A análise de origem é a de `predictionId === pick.basePredictionId`: `match_result` na base de mercado, a de `runJudgmentsFromAnalyses` na `dc_jev`. É a mesma de onde `multipliersOf` tirou o agregado.

Sem multiplicadores (JEV falhou, motor LLM no 1X2): `factors: []` e o bloco mostra a base e "nenhum ajuste" (§4.4).

### 3.6 Arredondamento (maior resto)

1. `basePts` = maior resto de `p_0 × 100` para somar 100. `finalPts` = idem sobre `p_final`.
2. Alvos por resultado: `T_o = finalPts_o − basePts_o`, com `T_home + T_draw + T_away = 0`.
3. Colunas `home` e `away`, cada uma em separado: distribui `T_o` entre os fatores a partir de `Δ_{i,o}` com `apportion(raws, target)`.
   - Começa com `round(raw)`.
   - Enquanto `Σ ≠ target`, soma ±1 no item de maior erro na direção que falta (`raw − atual`).
   - Desempate pelo índice. Determinístico.
4. Coluna `draw`: `pts_{i,draw} = −(pts_{i,home} + pts_{i,away})`. Cada fator soma 0, e a coluna do empate fecha sozinha: `Σ draw = −(T_h + T_a) = T_d`.

As três colunas batem com a barra, inclusive as raias para o empate do "não vira". O empate de um fator pode ficar a ±1 do cru: é o "arredondamento" já aceito nas v2–v4.

O maior resto é monotônico dentro do mesmo inteiro, então a barra nunca inverte a ordem de dois resultados. Fica no máximo empatada, e o resumo diz "por pouco" (§4.4).

Helper `largestRemainder(values, total)` e `apportion(raws, target)` em `lib/quant/apportion.ts` (puro, testado à parte). Não há helper parecido no repo (procurado).

### 3.7 Integração em `pick.ts` (mudança pequena)

- `PalpiteBase` ganha `factors: WeighedInputs | null`, preenchido em `marketBaseFromAnalyses` (de `mr.judgmentsModel?.factors`) e em `dcJevBaseFromAnalyses` (de `run.judgmentsModel.factors`).
- O `Summary` de `pick.ts` já lê `judgmentsModel`, então não muda.
- `pickFromBase` calcula o pick como hoje e, no fim: `weighed: weighPick({ base: base.base, rho, inputs: base.factors, multipliers: base.multipliers, finalRaw: raw })`.
- `pickFromBase` continua puro e determinístico. Custo: até 9 matrizes 11×11 a mais por palpite.

## 4. View model (`lib/view/palpite-weighed.ts`, puro, seguro no cliente)

### 4.1 Leitura

`toWeighedView(rawPick: unknown, teams: WeighedTeams, opts: { audience: "owner" | "public" }): PalpiteWeighedView | null`
- `teams = { home: { name, short }, away: { name, short } }` (de `teamPair`).
- Zod sobre `{ outcome, source, weighed }`: `.passthrough()` no pick, `origin: z.string()`.
- Rejeita (→ `null`) quando:
  - `version` é desconhecida;
  - as somas não fecham: `Σ basePts = Σ finalPts = 100`, cada `pts` soma 0, `Σ_i pts_i = finalPts − basePts`;
  - algum inteiro está fora de [0, 100].
- Não importa `@/lib/ai*`. O tipo vem de `import type` de `weighed.ts`, mesmo padrão de `PalpiteHeadline` em `db/schema.ts`.

### 4.2 Peças puras (todas testadas)

- `movesOf(pts: OutcomeTriple): Move[]`: porta de `build-v5.cjs:movesOf`. Quem perdeu manda para quem ganhou, destino mais perto primeiro (empate antes do outro time). Com 3 resultados dá no máximo 2 raias (1 perdedor e 2 ganhadores, ou 2 perdedores e 1 ganhador).
- `laneSlots(rows)`: numera as raias de cima para baixo (`slot` 0..), `dots = min(pts, 4)`, posições `--to = 18 − i × 5,5 px` e atrasos `i × 0,09 s`, como no mock. Os arcos continuam a numeração (`q0 = nº de raias`). O slot é limitado a 7 (keyframes 0..7).
- `barGeometry(basePts, finalPts)`: porta de `geometry5/geometry6`, tudo em **pontos (0–100)**, nunca em `%`.
  - `slices` (largura de cada fatia).
  - `hatches` (`left`, `width`, `tint`, `dir`). Tiras de saída na ponta de quem perdeu, repartidas por destino. Tira de chegada no começo de quem ganhou. O empate não ganha listra, como no mock.
  - `flows` (`x0` no meio da tira de saída e destinos com `x`, `pts`, `key`, `slot`). O destino do empate é o centro da fatia.
  - Os fluxos da barra são os **líquidos** (`movesOf(finalPts − basePts)`), não a soma das raias: no "não vira" as raias têm CAM→BOC e BOC→CAM que se anulam.
- `fanArcs(flows, widthPx, labelWidth)` (`lib/view/palpite-weighed-arcs.ts`): porta do `FLOW_SCRIPT_V6`, sem DOM.
  - Snap de meio pixel; leque por lado de cada origem, o mais perto por dentro.
  - Altura 22 px com um destino por lado e 32 px com dois.
  - `HOP 8 / LOW 14 / HIGH 24,5`, raios 5/9/12; caminho `arch(...)` com dois quartos de elipse e trecho reto; ponta triangular.
  - Posição das etiquetas: a de dentro acima do salto, a de fora no trecho que é só dela (`on-line`). Ficam presas à largura com `labelWidth(n)` estimado (dígitos mono 7 px + " pt/pts" + 8 px de padding).
  - Devolve `{ height, paths: [{ d, tint, tip, label: {x, y, onLine}, dots, slot }], origins: [{ cx, cy, tint }] }`.
- `startLine(base, source, teams)`:
  - prefixo "Ponto de partida, os preços do jogo:" (`market`) ou "Ponto de partida, o modelo de força dos times:" (`dc_jev`);
  - folga = `basePts[fav] − segundo maior`: ≤ 2 dá "jogo parelho"; de 3 a 12, "{Time} um pouco à frente"; ≥ 13, "{Time} bem à frente";
  - favorito empate: "o empate um pouco à frente";
  - limiares numa constante, para afinar.
- `factorText(key, teams, "short" | "long")`: frases novas, **num arquivo novo**. Não tocam `_narrator/labels.ts`, onde a C2 mexe.
  - `attack_weakened`: "{T} sem peça no ataque" / "Desfalques ou titulares poupados tiram do {T} uma peça ofensiva central".
  - `defense_weakened`: "Defesa do {T} desfalcada" / "Desfalques ou titulares poupados atingem a defesa do {T}".
  - `rotation_risk`: "{T} vai poupar titulares" / "O {T} tende a escalar um time poupado".
  - `high_stakes`: "Jogo de peso pro {T}" / "Jogo de peso na tabela para o {T}".
  - Chave desconhecida → linha some do bloco, e as raias somam a uma linha neutra "Outro ajuste" para a conta fechar (§6).
- `originLine(origin, value)` (diálogo):
  - `jev`: "contexto do jogo (JEV) · sinal forte|moderado", com `value ≥ 0,8`. É o mesmo limiar do `STRONG_SIGNAL` do narrador, que não é exportado. Vira uma constante local com comentário apontando para ele, sem tocar `labels.ts` (conflito com a C2);
  - `news`: "segundo o ge (não conferido)" ou "(confirmado pelos nossos dados)" quando `value ≥ NEWS_NOUL.confirmed`;
  - `user`: "você contou (não conferido)" / "você contou (conferido)" por `USER_NOUL`;
  - desconhecida: "ajuste do modelo".
  - O HERO só mostra a etiqueta "você contou" (e "notícia" para `news`, mesmo estilo tracejado).
  - **Desvio da v6:** o mock tem "forte/médio/leve" sem regra no dado. Fica a escala de 2 níveis que o narrador já usa, para não haver duas escalas de força no produto.
- `tinyRow`: fator com `pts` todo zero continua na lista com "mexeu menos de 1 pt" esmaecido, sem raia e sem slot. Esconder seria desonesto: ele pesou, só arredondou para zero.
- `summary(view)`: versão curta (HERO) e longa (diálogo); textos no §4.4.
- `alsoReadLine(source, newsCount, hasNewsFactor)` (só no diálogo):
  - "Também lido, sem mexer na conta: forma recente, confrontos e tabela (já estão nos preços)";
  - com `dc_jev`, "(já estão no modelo)";
  - e, quando `headline.sources` tem N itens e nenhum fator é notícia: "e N notícias do ge (entram só no texto)".
  - Com a C2 pode haver fator de notícia: aí sai o "entram só no texto".
- `srText(view)`: a descrição em palavras, sem `%`.
  - por raia: "Atlético-MG sem peça no ataque: 2 pontos do Atlético-MG para o Boca Juniors";
  - barra: "Chances do palpite, em pontos de 100: Atlético-MG de 37 para 33, empate 30, Boca Juniors de 33 para 37".

### 4.3 Tipo exposto

```ts
export type PalpiteWeighedView = {
  winner: "home" | "draw" | "away";      // cor da fatia forte (data-winner no CSS)
  start: { prefix: string; text: string };
  rows: Array<{
    key: string; short: string; long: string;
    tag: "user" | "news" | null;         // etiqueta do HERO
    originLine: string;                   // linha do diálogo
    tiny: boolean;
    lanes: Array<{ from: K; to: K; pts: number; slot: number; dots: { to: number; delay: number }[]; sr: string }>;
  }>;
  hasDrawLane: boolean;                   // --dstw 37px
  bar: { slices: {key: K; pts: number; before: number | null; strong: boolean}[]; hatches: Hatch[]; flows: Flow[]; q0: number };
  labels: Record<K, { short: string; full: string }>;
  summary: { kind: "flip" | "same" | "none"; short: string; long: string };
  alsoRead: string | null;
  sr: string;
};
```

### 4.4 Textos do resumo

`fav = baseOutcome` e `out = pick.outcome`. "por pouco" quando a folga final, em pp crus, entre `out` e o segundo é < 5.

| Caso | Curto (HERO) | Longo (diálogo) | Ícone |
|---|---|---|---|
| `out ≠ fav` | "Virou pro {X}[, por pouco]" / "Virou pro empate" | "{Os preços viam\|O modelo via} o {fav} {um pouco\|bem} à frente. Os ajustes viraram pro {X}[, por pouco]." | `Repeat2`, cor forte |
| igual, `\|Δfav\| ≤ 2` | "Continua {fav}: os ajustes quase se anulam" | "… Os ajustes quase se anulam e o palpite fica com ele." | `Equal` |
| igual, `Δfav ≥ 3` | "Continua {fav}: os ajustes reforçaram" | "… Os ajustes reforçaram e o palpite fica com ele." | `Equal` |
| igual, `Δfav ≤ −3` | "Continua {fav}, com menos folga" | "… Os ajustes tiraram folga, mas o palpite fica com ele." | `Equal` |
| sem fator | "Nenhum ajuste mexeu: vale {os preços\|o modelo}" | idem | `Equal` |

`Δfav = finalPts[fav] − basePts[fav]`. Todo texto passa por `containsValueLanguage` em teste. "preços" é permitido (ADR 0072, PLAN-668 S7); "odd/cotação/edge" não.

### 4.5 Ligação na view da manchete

- `PalpiteHeadlineView` (`lib/view/palpites-headline.ts`) ganha `weighed?: PalpiteWeighedView`.
- `toPalpiteHeadlineView(source)` ganha `source.teams?: WeighedTeams` e `source.audience?`. Sem `teams`, nada de `weighed`.
- `toPalpiteHeadlineViewFromSet(set, opts?: { teams?, audience? })` repassa.
- Chamadores:
  - `app/(app)/match/[id]/page.tsx:285`: passa `teamPair(match.homeTeam, match.awayTeam, leagueToKey(...))`, com os mesmos `name`/`short` do cabeçalho. Basta calcular o par antes do `heroPalpite`.
  - `app/p/[id]/load-shared-palpite.ts:65`: `audience: "public"` e `teams` do `row.match`.
  - `app/actions/underdog.ts:173`: não muda (não renderiza o bloco).

## 5. Componentes (só renderizam)

- **`components/palpites/palpite-weighed.tsx`** (sem diretiva: renderiza no servidor e no cliente). `PalpiteWeighed({ view, variant: "hero" | "dialog" })`, com a marcação da v6:
  - `div.pesou` (hero) ou `section.pesou.pesou-dialog`, com `data-winner={view.winner}` e `data-pesou`;
  - `ol.pesou-steps` com a linha da balança (`Scale`) e uma `li.pesou-step` por fator;
  - raias `span.pesou-lane` (src, `trk.pesou-q{slot}` com `<i>` por bolinha, dst, número), com `aria-hidden` no visual e `<span class="sr-only">{lane.sr}</span>`;
  - `.pesou-chart` com `<WeighedFlows>`, `.pesou-bar` e a linha de % com antes→depois;
  - `.pesou-summary`; no diálogo, `alsoRead`;
  - etiqueta "você contou" com `UserRound` (tracejada, como no mock) e "notícia" com `Newspaper`;
  - no diálogo, `pesou-row-long` (raia embaixo da frase no celular).
- **Sem `%` no HTML fora dos rótulos.** Larguras e posições usam variáveis sem unidade (`style={{"--w": 33}}`, `--l`, `--x`), e o CSS faz `calc(var(--w) * 1%)`. As cores ficam em `.pesou[data-winner=…]` no CSS, nunca em `color-mix(… 60%, …)` inline. Assim o único `%` no HTML é o dos rótulos `span[data-pesou-pct]`, o que mantém o guard de teste simples (§8).
- **`components/palpites/weighed-flows.tsx`** (`"use client"`):
  - mede a largura com `ResizeObserver` e chama `fanArcs`;
  - renderiza o `<svg>` (caminhos, pontas e origens), as etiquetas "N pts" e as bolinhas `i.pesou-fly.pesou-q{slot}` com `offset-path: path(...)`;
  - no SSR (largura desconhecida) sai só a caixa com a altura certa: os arcos entram após a hidratação, sem salto de layout;
  - `aria-hidden`.
- **`palpite-hero.tsx` (`PopulatedHero`)**: `{view.weighed && <PalpiteWeighed view={view.weighed} variant="hero" />}`.
  - Fica entre o bloco veredito+placar e o `div#detailId` da narrativa, sempre visível (inclusive compacto), como no print.
  - Dentro do `WarmShell` (`section[aria-label=palpite]`), o que exige a emenda da ADR 0030.
- **`reasoning-dialog.tsx`**: nova prop `weighed?: PalpiteWeighedView`, renderizada antes da `<ol>` das etapas.
  - A descrição troca para "O que pesou no palpite e as etapas que rodaram nesta análise." quando há bloco.
  - O `PalpiteHero` passa `heroPalpite?.weighed` só quando `!showLive`. Durante um run, as etapas são as ao vivo, e o bloco do palpite anterior não pode aparecer junto delas.
- **`public-palpite.tsx`**: depois do placar e antes da narrativa, `{view.weighed && <PalpiteWeighed variant="hero" … />}`. A view já vem filtrada pelo loader.

## 6. `/p` e o contexto do usuário (mesma regra do #565)

- `audience: "public"` em `toWeighedView`. Lista branca de origens públicas: `jev` e `news`. A notícia é pública (PLAN-672 §8.3). O contexto do dono não sai, nem origem desconhecida.
- Os fatores escondidos saem da lista, e as somas das raias deles juntam-se numa linha neutra: **"Outro ajuste de quem fez o palpite"**. Sem frase, sem etiqueta, sem força. Raias e barra continuam batendo.
- **Decisão D1 (tomada pelo dono em 2026-11-25, reversível): bloco inteiro some no `/p`.** Nenhuma versão do "o que pesou" vai para a página pública, com ou sem fator do usuário. Com isso caem a lista branca de origens, a linha neutra "Outro ajuste de quem fez o palpite" e o `audience` do view model (ver "Revisão do plano", R2). As alternativas antigas (linha neutra agregada; tirar e aceitar a conta aberta; esconder só quando há fator do usuário) ficam registradas como não adotadas.
- O resumo usa os totais e não muda. O `/p` não leva `alsoRead` (é do diálogo).
- O raciocínio continua fora do `/p` (`delete mapped.reasoning`).
- `unsafeForPublic` não muda: guarda texto livre (verdict/narrative). O bloco é texto de código.
- **Decisão D2 (consequência da D1): bloco inteiro some no `/p`, sem emenda da ADR 0035.** A §2(d) ("FORA, sempre: … %") fica intacta: o `/p` nunca mostra `%` nem pontos. A emenda da 0035 sai do §9, e a emenda da 0030 registra numa frase que o bloco é só da superfície do dono (HERO e "Ver raciocínio").

## 7. CSS e animação (`app/globals.css`, seção nova "o que pesou (#683)")

Porta do `STYLE_V6`, com estas trocas:
- **Cores por classe:** `.pesou[data-winner=home|draw|away]` define `--c-home/draw/away` (fatias) e `--t-*` (tons claros de raia e arco).
  - O mock só tinha dark mode, com `color-mix(…, white)`. No tema claro, misturar com branco apaga o tom.
  - Usar `color-mix(in oklch, var(--x) 60%, var(--foreground))` no claro e `white` no escuro, conferindo contraste ≥ 3:1 do número da raia (texto `text-meta`) nos dois temas.
- **Posições:** `.pesou-bar > span { flex: var(--w) 0 0 }`; `.pesou-bar > i { left: calc(var(--l) * 1%); width: calc(var(--w) * 1%) }`.
- **Tempos:** `T = 5,4 s`, `SLOT0 0,2`, `SLOT_GAP 0,4`, `LANE_TRAVEL 0,75`, `ARC_TRAVEL 1,4`, `FADE 4,5–4,9`, 8 slots.
  - Keyframes `pesou-lane-0..7` e `pesou-arc-0..7` escritos estáticos no CSS: 16 regras geradas uma vez por script e coladas, com comentário de como regenerar.
  - Listras: `pesou-hatch` 1,35 s, `background-position` andando `var(--dir) × 6px`.
- **Movimento reduzido.** Regra própria, com especificidade maior que a global (`*:not(.mascot-motion…)`, (0,1,0)).
  - A global só encurta para 0,01 ms. Com `both`, a bolinha da raia terminaria no keyframe 100% (`opacity: 0`) e sumiria.
  - `.pesou .pesou-lane .trk i { animation: none !important }`: a bolinha fica parada no destino, porque o estilo base já tem `translateX(var(--to))` e opacidade 1.
  - `.pesou .pesou-fly { display: none !important }`.
  - `.pesou .pesou-bar > i { animation: none !important }`.
- **Sem `offset-path`:** `@supports not (offset-path: path("M0,0")) { .pesou-fly { display: none } }`. Sem suporte, a bolinha ficaria parada no canto da caixa.
- Os tokens `--palpite-*`, `--muted-fg-2` e `--surface` (definido no bloco) já existem.

## 8. Firewall e guards de `%`

- **HERO** (`components/__tests__/palpite-hero.test.tsx`): o `leaksValue(html)` de hoje (`containsValueLanguage || /%/`) passa a ser `leaksValueOutsideWeighedBar(html)`.
  - Remove os `<span data-pesou-pct="">\d{1,3}%</span>` e então exige zero `%` e zero termo de valor no resto.
  - Exige também `containsValueLanguage(html) === false` no HTML inteiro, sem tirar nada.
  - Helper compartilhado em `components/__tests__/firewall-helpers.ts`, usado também por `public-palpite.test.tsx` e `palpite-area.test.tsx`.
  - O `palpite-area.test.tsx:215` (`shell.textContent` sem `%`) passa a tirar o bloco `[data-pesou]` antes de conferir. O teste do azarão fora da casca continua valendo como está.
- **Confiança:** segue palavra. O teste "rende a PALAVRA da confiança e nenhum dígito/%" passa a olhar o chip, não o HTML inteiro.
- **Etapas do raciocínio:** `run-progress.ts:106`, que derruba linha de etapa com `%`, **não muda**. O bloco não é linha de etapa.
- **Público:** `unsafeForPublic` não muda. O teste do `/p` usa o mesmo helper e exige que nenhum texto de fator do usuário apareça.

## 9. Emendas de ADR (commit `docs:` próprio, primeiro)

- **ADR 0030 §3:** o HERO pode mostrar as chances 1X2 do palpite decidido em código (antes→depois, inteiros, `%` só nos rótulos da barra) e os pontos movidos por fator, no bloco "o que pesou". São chances do modelo, não números de valor. Odd, edge, EV, stake, Yield, R$ e nome de casa seguem fora. A confiança segue palavra. "preços do jogo" é permitido como palavra, nunca o número da odd.
- **ADR 0065 §2:** o diálogo abre com o bloco "O que pesou no palpite" (mesmo dado e mesmo firewall da emenda 0030). As linhas das etapas seguem sem `%`.
- **ADR 0035 §2(d)** (D2): o `/p` mostra o bloco sem os fatores do contexto do dono (agregados numa linha neutra, D1). `%` só nos rótulos gerados por código. Texto livre segue no `unsafeForPublic`. A imagem OG não leva o bloco.
- **ADR 0072 §9:** `headline.pick.weighed` (versão `palpite_weighed_v1`) e "a view lê só `pick.weighed`, por Zod; λ, base, ajuste e resíduos seguem fora da view". Atualizar o comentário de `PalpiteHeadline.pick` em `db/schema.ts` ("a view NÃO lê" → "a view lê só `weighed`").

## 10. Acessibilidade

- O bloco é uma `ol` com `aria-label="o que pesou no palpite"`. Cada linha tem a frase visível mais o `sr-only` da raia ("2 pontos do Atlético-MG para o Boca Juniors"); o desenho da raia é `aria-hidden`.
- A barra, os arcos e as listras são `aria-hidden`. Um `<p class="sr-only">` com `view.sr` descreve antes→depois em palavras, sem `%`. Os rótulos visíveis de % ficam `aria-hidden` para não ler duas vezes.
- O resumo é texto normal. O ícone é `aria-hidden`.
- Nenhuma informação depende só da animação ou da cor: o número está em cada raia e em cada fatia.
- Movimento reduzido: estático, com as bolinhas das raias no destino (§7).
- Contraste dos tons de raia nos dois temas (§7), conferido no print.
- O foco do diálogo não muda.

## 11. Testes

**Núcleo**
- `lib/quant/__tests__/apportion.test.ts`:
  - `largestRemainder` soma o total e é monotônico (nunca inverte a ordem);
  - `apportion` com alvo positivo, negativo, zero e fora do arredondado (±2);
  - determinismo nos empates.
- `lib/ai/palpites/__tests__/weighed.test.ts`:
  - **Origem:** JEV puro; notícia acima do JEV; usuário acima dos dois; empate JEV = usuário fica JEV; usuário 0,7 com JEV 0,8 fica JEV; `userContext` ilegível dá `null`; `news.evidence` ausente.
  - **Lado:** `defense_weakened_away` multiplica o λ do mandante.
  - **Ordem:** jev → news → user e, dentro de cada uma, a canônica; invariância à ordem das chaves do jsonb.
  - **Clamp sintético** (multiplicadores 1,10 × 1,10 com `applied` 1,15): `Π m' = applied`, proporção preservada, `clamped`.
  - **Telescópica:** `Σ Δ = p_final − p_0` (1e-9); a conferência barra multiplicadores incoerentes (`weighed: null`).
  - **Inteiros:** soma 0 por fator; colunas = `finalPts − basePts` nas três; `basePts`/`finalPts` somam 100; `|pts − pp| ≤ 1` em casa/visitante.
  - **Propriedade:** 200 casos com λ, ρ e nouls aleatórios, invariantes acima.
  - **Determinismo:** dez chamadas iguais.
- `lib/ai/palpites/__tests__/pick.test.ts`:
  - `weighed` presente em `market` e em `dc_jev`;
  - `Π m'` = `pick.multipliers`;
  - sem julgamentos → `factors: []`;
  - análise de origem sem `factors` → `null`.
  - **Regressão com os cenários do mock** (`calc.ts`): Galo x Boca "vira" (odds 2,45/3,15/3,05, O/U 2,5 a 2,20/1,68; JEV ataque 0,9, defesa 0,8, peso do jogo do visitante 0,85; usuário rodízio 0,7) e "não vira" (1,85/3,50/4,60). O teste fixa resultado, `basePts`, `finalPts` e pts por fator **com os números do motor real**: os do mock eram ilustrativos.
- `synthesis-input.test.ts`: `judgmentsModel.factors` nos dois caminhos (memória e histórico), com origens.

**View**
- `lib/view/__tests__/palpite-weighed.test.ts`:
  - `movesOf`: divisão em duas raias, mais perto primeiro, dois perdedores;
  - slots e bolinhas: teto de 4 bolinhas e de slot 7;
  - `barGeometry` dos dois cenários (listras e fluxos iguais ao `data-flows` do mock: vira `x0 35 → x 65, n 4`);
  - `startLine` nos limiares; `summary` nos cinco casos; `tinyRow`;
  - público: usuário vira "Outro ajuste", origem desconhecida escondida, `news` mantido;
  - Zod: jsonb malformado ou soma que não fecha → `null`;
  - nenhum texto com linguagem de valor; `sr` sem `%`.
- `lib/view/__tests__/palpite-weighed-arcs.test.ts`: altura 22/32; o de dentro antes do de fora; etiquetas dentro de [0, W]; snapshot dos `d` nos dois cenários a 330 px.
- `palpites-headline.test.ts`: `weighed` só com `teams` e pick válido; set antigo sem campo.

**Componentes**
- `palpite-hero.test.tsx`: bloco presente; "você contou" com fator de usuário; ausente em set antigo e no v13; firewall pelo helper novo; `data-winner`; nenhum `style` com `%`.
- `reasoning-dialog` (novo teste ou dentro do do HERO): bloco no topo quando não está rodando; some durante o run.
- `public-palpite.test.tsx` e `app/p/__tests__/load-shared-palpite.test.ts`: sem frase de fator do usuário, sem "você contou", linha neutra presente, `%` só nos rótulos.
- `og-palpite-image.test.tsx`: sem mudança (confere que o bloco não entra).
- CSS: um teste barato que lê `app/globals.css` e confere as três regras de movimento reduzido do `.pesou` e os 8 keyframes de cada tipo. Ele protege a regra mais fácil de perder num refactor.

**Fim a fim (manual, no PR):** prints celular 390 e desktop, claro e escuro, com e sem movimento reduzido, nos dois cenários, contra os PNG da v6.

## 12. Commits (um PR)

1. `docs(adr): % do palpite no bloco "o que pesou" (emendas 0030 §3, 0065 §2, 0035 §2d, 0072 §9)` + comentário de `db/schema.ts`.
2. `feat(quant): maior resto e rateio inteiro` (`lib/quant/apportion.ts` + testes).
3. `feat(palpite): efeito de cada fator gravado em headline.pick.weighed`: `weighed.ts`, `synthesis-input.ts` (`factors` em `judgmentsModelOf`), `pick.ts` (`PalpiteBase.factors`, `pickFromBase`) e testes. Sem prompt, sem migration.
4. `feat(view): view model do "o que pesou"`: `palpite-weighed.ts`, `palpite-weighed-arcs.ts`, `palpites-headline.ts` (`teams`/`audience`) e testes.
5. `feat(palpite): bloco "o que pesou" no HERO e no Ver raciocínio`: componentes, `globals.css`, `page.tsx` (`teams`), helper de firewall e testes do HERO e da área.
6. `feat(share): /p mostra o que pesou sem o contexto do dono`: loader, `public-palpite.tsx` e testes.

Cada commit com build/lint/typecheck/test verdes.

## 13. Conflitos com a C2 do #672 (outro thread)

| Arquivo | C2 mexe em | Este plano mexe em | Risco |
|---|---|---|---|
| `lib/ai/palpites/synthesis-input.ts` | `synthesisRationale`, `synthesisFactorPhrases` (origem notícia, `modelAnswersOf`) | 1 campo em `AnalysisJudgmentsModel` + 1 linha em `judgmentsModelOf` | baixo, hunks separados |
| `lib/ai/palpites/pick.ts` | nada previsto | `PalpiteBase.factors`, fim de `pickFromBase` | nenhum |
| `lib/ai/palpites/index.ts` | `resolveMatchNews` | **nada** (o `weighed` viaja dentro do `pick`) | nenhum |
| `lib/ai/markets/_narrator/labels.ts` | `UserFactorOrigins` com notícia, rótulos | **nada** (frases curtas/longas num arquivo novo) | nenhum |
| `app/actions/predictions.ts` | `analyzeBestBet` (~813) | **nada** (caminho fresco fora, §1) | nenhum |
| `lib/ai/engine/types.ts` | grava `news` | só lê o tipo | nenhum |
| `components/palpites/reasoning-dialog.tsx`, `lib/ai/progress/*` | passo de notícias em `steps.ts`/`details.ts` | só o diálogo (prop nova) | baixo |

Quem fizer merge por último roda os testes de origem com uma predição que tenha `news.evidence` (já cobertos com fixture aqui).

## 14. Riscos

1. **Regra de firewall/regulatória:** `%` e pontos no HERO e no `/p` mexem em três ADRs, e a 0035 §2(d) não estava na issue (D2). Sem o OK do dono, o `/p` fica sem bloco.
2. **Decomposição que não fecha com o palpite** (linhas antigas com regra simétrica, multiplicadores inconsistentes, pick de mercado com multiplicadores de outra análise): fail-closed com `weighed: null` + `console.warn`, mais testes de propriedade. O custo é o bloco faltar em alguns sets.
3. **Arcos dependem de medida em px:**
   - SSR sem arcos até hidratar, com a altura reservada e sem salto;
   - etiqueta estimada pode encostar com o empate muito estreito (ressalva da v6);
   - `offset-path` sem suporte esconde as bolinhas dos arcos.
4. **Contraste e tema claro:** o mock é dark-only, e os tons de raia misturados com branco somem no claro. Tem de conferir nos dois temas, senão o número da raia fica ilegível.
5. **Ordem e atribuição:** o sequencial depende da ordem fixa e da origem por máximo; um fator de usuário que empata com o JEV aparece como JEV. É coerente com o `claimEffect`, mas pode surpreender quem digitou. No `/p`, a linha neutra revela que houve contexto do dono (D1).
6. Altura do HERO: o bloco fica sempre visível, até no compacto, e o HERO cresce ~200–250 px no celular. Foi aprovado no print, mas empurra "Ler análise completa" para baixo.
7. Movimento: a regra global de movimento reduzido só encurta. Sem a regra própria, as bolinhas somem (coberto por teste de CSS).

## 15. Acompanhamentos

- Shapley no lugar do sequencial, se aparecer caso com ordem relevante.
- Bloco no palpite ao vivo (`pickFromMatrix`, com fatores em jogo).
- `moves` gravado, se a revisão preferir.
- Encurtar o ciclo de 5,4 s (ressalva da v6).

## Revisão do plano

Revisão de olhos frescos, 2026-11-25, sobre `175093f`. Conferido contra o código: `lib/ai/palpites/pick.ts`, `lib/ai/judgments/apply.ts`, `lib/ai/palpites/synthesis-input.ts`, `lib/ai/engine/types.ts`, `lib/user-palpite/evidence.ts` e `types.ts`, `lib/match-news/apply.ts` e `model-answers.ts`, `lib/quant/scoreline-model.ts`, `lib/ai/predict.ts` (`toPredictionJudgments`), `lib/ai/palpites/cartridges/model-pick.ts`, `lib/calibration/palpite-confidence.ts`, `lib/view/palpites-headline.ts`, `app/p/[id]/load-shared-palpite.ts`, `components/palpites/palpite-hero.tsx` e `reasoning-dialog.tsx`, `app/globals.css`, ADRs 0030/0035/0065/0072, PLAN-672 e a v6 (`proposta-v6.md`, print do "vira").

**O que se confirmou:**
- O clamp nunca corta com os pesos de hoje: por λ, o produto fica em [0,893; 1,092].
- O `lambda.adjusted` gravado é `base × applied` (`toPredictionJudgments`). Logo, `adjusted/base` do pick = `Π m` (clampado).
- A matriz é renormalizada (Σ = 1), então cada Δ soma 0 entre os três resultados.
- O `model-pick.ts` monta o pick do prompt campo a campo, e a manchete nunca volta a prompt nenhum: system prompts e cache intactos (ADR 0071).
- A calibração lê `pick: z.unknown()`, então o campo novo não a quebra.
- Custo de CPU desprezível: até 9 matrizes 11×11; o ajuste ao mercado por bisseção custa mais.
- Lógica em `lib/`, componentes só renderizam, nenhum nome de casa: OK.

### Must-fix

**R1 (must-fix). Na base de mercado, o "antes→depois" é o edge por resultado, só sem a palavra.** O `basePts` da fonte `market` é o 1X2 do mercado sem margem (a matriz ajustada aos preços). Os pontos de cada fator, somados, dão `finalPts − basePts` = chance do modelo − chance do mercado, por resultado. É exatamente o que a ADR 0030 §3 tira do HERO ("nenhum número de valor cruza a fronteira do HERO"). Não há odd, EV nem a palavra edge, mas o número está lá. O texto da emenda no §9 ("são chances do modelo, não números de valor") não descreve isso direito.
- **Correção:** a emenda da 0030 §3 diz isso com todas as letras: "na base de mercado, o antes é a chance do mercado sem margem, e a diferença antes→depois é a distância entre o modelo e o mercado, em pontos inteiros, por resultado". Justificativa: o palpite é o resultado mais provável, não uma escolha por valor; o número é chance e nunca odd, EV ou stake; só a superfície do dono mostra (D1).
- Pedir o OK explícito do dono **para essa frase** antes do commit 1. Se ele recusar, a mitigação possível é mostrar só a base `dc_jev` ou a base em palavras, mas os pontos das raias continuam somando a diferença, então na prática o recurso cai.

**R2 (must-fix). O `/p` precisa de corte explícito, não da ausência de `teams`.** Com a D1, o plano ainda descreve `audience`, a lista branca, a linha neutra, o bloco em `public-palpite.tsx`, a emenda da 0035 e o commit 6.
- **Correção:**
  - tirar `audience` de `toWeighedView`, `toPalpiteHeadlineView` e `toPalpiteHeadlineViewFromSet`;
  - tirar o §6 (exceto D1/D2), o bloco de `public-palpite.tsx` e a emenda 0035 do §9 e do título do commit 1;
  - o commit 6 vira uma linha em `load-shared-palpite.ts`, `delete mapped.weighed`, ao lado do `delete mapped.reasoning` (defesa em profundidade: amanhã alguém passa `teams` no loader e o bloco vaza);
  - teste em `load-shared-palpite.test.ts` (fixture com `pick.weighed` válido → view sem `weighed`) e em `public-palpite.test.tsx` (HTML sem `data-pesou` e sem `%`);
  - `components/landing/palpite-preview.tsx` não muda.

**R3 (must-fix). A direção do fator precisa bater com a frase.** O §3.1 aceita "fator com `value ≤ 0.5` e `m ≠ 1`" (linhas da regra simétrica antiga). Lá um "não" (noul 0,2) em `attack_weakened_home` dá `m = 1,036`, **aumenta** o ataque, e a linha sairia "Atlético-MG sem peça no ataque" com pontos indo **para** o Atlético. A conta fecha (telescópica), mas o texto mente. O caminho "Gerar só o palpite" lê a análise mais recente de cada mercado, que pode ser antiga.
- **Correção:** para todo fator com `m ≠ 1`, exigir `value > 0.5` e `sign(m − 1) === sign(factorMultiplier(factor, 1) − 1)`. Esse teste dá o sinal esperado sem duplicar `FACTOR_EFFECT`, e não quebra se os pesos mudarem. Se falhar → `weighed: null`, `reason: "factor_direction"`.
- Teste com uma linha simétrica sintética.

**R4 (must-fix). JEV falho vira "sem bloco" em vez de "nenhum ajuste".** Com o JEV falho e sem contexto, `applyJudgments(null)` grava `multipliers: null`. Mesmo assim, `judgmentsModel` existe (`engine === "code_jev"`), e `multipliersOf` devolve `{1, 1}`, não `null`. Pelo §3.1, `weighedFactorInputs` → `null`. Pelo §3.5 ("há multiplicadores no pick mas a análise não tem `factors`"), o resultado é `weighed: null`. O §3.5 queria mostrar "nenhum ajuste" nesse caso.
- **Correção:**
  - `weighedFactorInputs` devolve `{ factors: [], applied: {1,1}, product: {1,1} }` para `code_jev` com `multipliers === null`;
  - `null` fica reservado ao `userContext` ilegível;
  - no §3.5, multiplicador do pick com `|m − 1| ≤ 1e-9` conta como "sem multiplicador".
- Teste: JEV falho sem contexto → `factors: []` e resumo "Nenhum ajuste mexeu".

**R5 (must-fix). O invariante de arredondamento do §11 é falso, e o rateio pode contradizer o sinal.**
- *Erro > 1.* Base 37,45/30,30/32,25 → maior resto 38/30/32. Final 35,55/30,60/33,85 → 35/31/34. Com um fator só, `pts_home = T = −3` contra `Δ = −1,90`: erro 1,1. O teste "`|pts − pp| ≤ 1` em casa/visitante" falha no teste de propriedade. O limite certo é `< 2`. O empate, que é o resto, pode errar mais que ±1, ao contrário do que diz o §3.6.
- *Sinal trocado.* Base 37,55/30,80/31,65 → 37/31/32. Final 37,45/31,25/31,30 → 38/31/31. A barra mostra "37→38" para um resultado que **caiu** 0,1. Com um fator "sem peça no ataque", o rateio dá +1 ao próprio time.
- **Correção:**
  - `apportion` passa a respeitar o sinal nas colunas casa/visitante: o resíduo ±1 só vai para um item cujo `raw` tem o mesmo sinal (ou é zero);
  - se nenhum item serve, `weighed: null` com `reason: "rounding_conflict"`. Isso só acontece quando a própria barra contradiz o Δ, que é o caso raro acima;
  - o teste de propriedade confere as somas exatas, a ausência de sinal trocado em casa/visitante, `|pts − raw| < 2`, e mede a taxa de `null` (esperada perto de 0; o teste falha se passar de 1%);
  - corrigir o texto do §3.6 sobre o empate ("arredondamento", sem prometer ±1).

**R6 (must-fix, com saída para o dono). Animação em loop infinito no HERO.** Ciclo de 5,4 s, automático e sem fim, ao lado de outro conteúdo: falha na WCAG 2.2.2 (Pause, Stop, Hide, nível A) para quem não ligou o movimento reduzido. E ainda gasta bateria com duas instâncias (HERO e diálogo).
- **Correção:**
  - `animation-iteration-count: 2` (ou 1) nas raias, arcos e listras, terminando no estado parado, o mesmo do movimento reduzido: bolinhas das raias no destino, as dos arcos escondidas;
  - opcional: tocar de novo ao tocar ou passar o mouse no bloco;
  - o teste de CSS do §11 confere que nenhuma regra `.pesou` usa `infinite`;
  - se o dono quiser manter o loop, registrar a exceção na emenda da 0030 e na PR.

### Should-fix

**R7 (should-fix). Origem: usar o helper único e corrigir a promessa do "efeito marginal".**
- O PLAN-672 (ajuste 4, "um helper só") manda todo leitor usar `modelAnswersOf(judgments)` como "o que o número já tinha".
  - **Correção:** a regra do usuário fica `user > max(0.5, modelAnswersOf(j)?.[q]?.value ?? 0)` (a semântica do `claimEffect`), e a da notícia `news > max(0.5, answers?.[q]?.value ?? 0)`. Sem um terceiro jeito de combinar.
- O §3.2 diz que "você contou" é "o efeito marginal do contexto sobre o modelo". Isso só vale quando o JEV estava neutro. Com JEV 0,6 e usuário 0,7, a linha carrega o fator inteiro `m(0,7)`, não `m(0,7)/m(0,6)`.
  - **Correção:** reescrever como "a linha mostra o fator inteiro; a etiqueta diz quem o levou ao valor final".
  - A separação JEV/incremento entra em §15 como acompanhamento. Hoje o caso é raro: o usuário só move com 0,7 ou 0,85.

**R8 (should-fix). Altura dos arcos no view model, para o SSR reservar a caixa.** O §5 promete "no SSR sai só a caixa com a altura certa", mas no §4.2 a altura sai de `fanArcs(flows, widthPx, …)`, que só roda no cliente.
- **Correção:**
  - `bar.arcsHeight` (0, 22 ou 32) no `PalpiteWeighedView`, calculado dos fluxos (1 ou 2 destinos por lado), sem largura;
  - `fanArcs` recebe a altura pronta;
  - `WeighedFlows` mede com `useLayoutEffect` (React 19, sem aviso no SSR) e com `ResizeObserver` para recalcular no resize (a v6 não recalculava);
  - teste de render no servidor: a caixa sai com a altura e sem `<path>`.

**R9 (should-fix). Contraste e tema.**
- O "2 pts", a sigla de destino e os rótulos de `%` são **texto** pequeno, então pedem 4,5:1 (AA). O 3:1 do §7 vale só para raia, arco e listra (não texto).
  - **Correção:** texto com os tokens que já existem (`--palpite-strong-fg`, `--muted-fg-2`, `--foreground`); misturas de cor só no gráfico.
- O tema escuro do app é a classe `.dark` (`@custom-variant dark`), não a media query.
  - **Correção:** seletores `.dark .pesou[data-winner=…]`.
- `--surface` não existe (há `--surface-2` e `--surface-3`).
  - **Correção:** usar `--surface-2`, sem criar token.

**R10 (should-fix). Paridade memória × histórico (regra M3 do #668), com teste.** O jsonb do Postgres reordena chaves (as mais curtas primeiro), então `multipliers.{s}.factors` chega em ordem diferente pelos dois caminhos.
- O §3.2 já ordena, mas a soma `Σ ln m` do clamp também depende da ordem em ponto flutuante.
  - **Correção:** ordenar canonicamente **antes** de qualquer soma.
- Teste em `pick.test.ts`: as mesmas predições por `summarizeAnalysesForSynthesis` e por `summarizeSavedAnalysesForSynthesis` (com as chaves do jsonb embaralhadas) dão `weighed` profundamente igual.

**R11 (should-fix). Leitura com Zod: faixa dos inteiros.** O §4.1 rejeita "inteiro fora de [0, 100]", mas `pts` é negativo por natureza.
- **Correção:** `basePts` e `finalPts` em `int` [0, 100]; `pts` em `int` [−100, 100]; `value` em [0, 1]; `multiplier` > 0 e finito.

**R12 (should-fix). Resumo quando todo fator é minúsculo.** Com fatores, mas todos com `pts` zero, cai em "os ajustes quase se anulam", o que não é verdade: eles não se anularam, foram pequenos.
- **Correção:** um caso próprio, "Os ajustes mexeram menos de 1 pt: vale {os preços|o modelo}", com teste.

**R13 (should-fix). Conflito com a C2 do #672: copy e arquivos a mais na tabela do §13.**
- O `originLine` da notícia tem de usar as mesmas palavras do passo da C2 (PLAN-672 §8.1: "segundo o ge (não conferido com os nossos dados)" / "(confirmado pelos nossos dados)"). O mesmo diálogo mostra os dois.
  - **Correção:** quem fizer merge por último troca a string local pela constante da C2, se ela exportar uma.
- Acrescentar à tabela:
  - `lib/match-news/model-answers.ts` (só leitura, R7);
  - `app/globals.css` e `palpite-hero.tsx`: o sinal de notícia no azarão (`underdog_calc_v2`) pode mexer no teaser abaixo do HERO. Risco baixo, hunks separados.
- O `palpites_v15` da C2 mexe em cartuchos e `index.ts`; este plano não toca neles, então nada muda ali.

**R14 (should-fix). Limpeza do plano pela D1.**
- §1 "Entra": sem `/p`.
- §8: o helper de firewall serve ao HERO e à área. No `/p`, o teste passa a ser "zero `data-pesou`".
- §11: troca os testes públicos pelos de R2.
- §12: o commit 6 encolhe (R2).
- §14: os riscos 1 e 5 perdem a parte do `/p`.

### Nits

- **R15 (nit). Clamp em log.** A conta está certa: com o clamp ativo, `c ∈ (0,1)`, nenhum fator troca de sinal e `Π m' = applied` exato. Mas é caminho morto com os pesos de hoje. Uma alternativa mais simples: `clamped` → `weighed: null` (fail-closed) até um bump de pesos precisar disso. As duas servem; se ficar, que seja depois da ordenação (R10).
- **R16 (nit). `pp` gravado** é redundante (sai de `baseProbs` e da sequência). Manter só se a auditoria usar; se ficar, documentar que a view não lê.
- **R17 (nit). Nome repetido:** o componente `PalpiteWeighed` e o tipo `PalpiteWeighed` (`weighed.ts`). Renomear o componente para `WeighedBlock`.
- **R18 (nit). Desempate do `movesOf`.** Quando o empate perde para os dois times, "o destino mais perto" não decide (os dois são vizinhos). Fixar: mandante primeiro.
- **R19 (nit). Slot limitado a 7.** Com muitos fatores, várias raias animam juntas no slot 7. Aceitável, mas vale dizer no comentário do CSS.
- **R20 (nit). "Preços do jogo"** é a matriz ajustada ao mercado (resíduo de até 1 pp na divisão), não o 1X2 sem margem cru. Dizer isso numa linha na emenda (R1).
- **R21 (nit). O `alsoRead` conta `headline.sources`** (notícias citadas), não as lidas. Ajustar a frase ("e N notícias do ge citadas") ou ler a contagem certa depois da C2.

### Decisões D1/D2

Resolvidas pelo dono (2026-11-25, reversível): **bloco inteiro some no `/p`**, ADR 0035 §2(d) intacta, sem emenda da 0035 (texto do §6 atualizado).

## Ajustes pós-revisão

Fechamento da revisão antes do código (2026-11-25). Regra geral: aceito a correção do revisor, salvo onde o código mostra outra coisa. Decisões do dono nesta rodada:

- **/p:** o bloco inteiro some (R2 como escrito). ADR 0035 intacta.
- **Animação:** toca **2 ciclos** quando o bloco entra na tela (`IntersectionObserver` na parte cliente) e termina no estado parado final. Com `prefers-reduced-motion`, parado desde o início (R6).
- **R1:** a emenda da ADR 0030 §3 diz com todas as letras que, na base de mercado, o antes→depois é a chance do modelo menos a chance do mercado (a diferença que a ADR 0030 mantinha fora do HERO), e que isso agora é permitido porque o app não move dinheiro, o bloco não tem palavra de valor/odd/edge e explica o palpite. O OK explícito do dono está pendente num cartão de decisão: a emenda vai como proposta, num commit só dela (o primeiro depois deste), para poder ser revertida sozinha.

| Item | Decisão | Como |
|---|---|---|
| R1 | aceito | Emenda da 0030 §3 em commit próprio, com a frase do dono e a nota da R20 (a base é a matriz ajustada aos preços, resíduo de até 1 pp). Bloco só na superfície do dono (HERO e "Ver raciocínio"). |
| R2 | aceito | Sem `audience`, sem lista branca, sem linha neutra, sem bloco no `public-palpite.tsx`, sem emenda da 0035. O loader do `/p` faz `delete mapped.weighed` ao lado do `delete mapped.reasoning`. Testes: loader com `pick.weighed` válido → view sem `weighed`; HTML público sem `data-pesou` e sem `%`. |
| R3 | aceito | Todo fator com `m ≠ 1` precisa de `value > 0,5` e `sign(m − 1) = sign(factorMultiplier(fator, 1) − 1)`; senão `weighed: null`, `reason: "factor_direction"`. Teste com linha simétrica sintética. |
| R4 | aceito | `code_jev` com `multipliers === null` → `{ factors: [], applied: {1,1}, product: {1,1} }`. `null` só para `userContext` ilegível. Multiplicador do pick com `|m − 1| ≤ 1e-9` conta como "sem multiplicador". Teste: JEV falho → "Nenhum ajuste mexeu". |
| R5 | aceito | `apportion` com sinal: o ±1 só vai para item com `raw ≠ 0` cujo novo valor não troca de sinal (fica 0 ou no sinal do `raw`). Sem candidato → `weighed: null`, `reason: "rounding_conflict"`. Empate (coluna do meio) é o resto: "arredondamento", sem promessa de ±1. Teste de propriedade: somas exatas, sem sinal trocado em casa/visitante, `|pts − raw| < 2`, taxa de `null` ≤ 1%. |
| R6 | aceito, com a decisão do dono | Estado parado por padrão (bolinhas das raias no destino, as dos arcos escondidas, listras paradas). A parte cliente põe `data-play` no `.pesou` ao entrar na tela (uma vez) e tira depois de 2 ciclos. Raias e arcos com `animation-iteration-count: 1.83` (para no descanso do 2º ciclo, antes do fade), listras com 8 voltas (= 2 ciclos). Nenhuma regra `infinite` no `.pesou` (teste de CSS). Movimento reduzido: o cliente não liga `data-play` e o CSS tem a regra própria (as três linhas do §7) contra a regra global. |
| R7 | aceito | Usuário: `user > max(0,5, modelAnswersOf(j)?.[q]?.value ?? 0)`; notícia: `news > max(0,5, answers?.[q]?.value ?? 0)`; senão JEV. O §3.2 passa a dizer: "a linha mostra o fator inteiro; a etiqueta diz quem o levou ao valor final". Separar JEV e incremento do usuário vai para §15. |
| R8 | aceito | `bar.arcsHeight` (0, 22 ou 32) no view model; `fanArcs` recebe a altura; `WeighedFlows` mede com `useLayoutEffect` + `ResizeObserver`. Teste de SSR: caixa com a altura e sem `<path>`. |
| R9 | aceito | Tema escuro por `.dark .pesou[data-winner=…]`. Texto ≥ 4,5:1 nos dois temas: origem da raia em `--muted-foreground`; destino e número no tom de quem recebeu, com tons escolhidos por tema e conferidos (claro: `--palpite-strong-fg`, `--muted-foreground` e borda misturada com `--foreground`; escuro: os tons da v6 misturados com branco; todos ≥ 5:1 no HERO e no diálogo, conta no comentário do CSS). Sem token global novo: o fundo do bloco é uma variável local `--pesou-surface` (a mesma mistura da v6), usada também nas listras, separadores e pílulas, para casarem com o fundo de verdade. `--surface-2` não casaria com o fundo quente do HERO. |
| R10 | aceito | Fatores em ordem canônica antes de qualquer soma (`Σ ln m` incluso). Teste em `pick.test.ts`: memória × histórico com chaves do jsonb embaralhadas → `weighed` igual. |
| R11 | aceito | Zod: `basePts`/`finalPts` int [0, 100]; `pts` int [−100, 100]; `value` [0, 1]; `multiplier` finito > 0. |
| R12 | aceito | Caso próprio: "Os ajustes mexeram menos de 1 pt: vale {os preços\|o modelo}". |
| R13 | aceito | `originLine` da notícia com as palavras da C2: "segundo o ge (não conferido com os nossos dados)" / "segundo o ge (confirmado pelos nossos dados)", em constante local com comentário para quem fizer merge por último trocar pela da C2. Tabela do §13 ganha `lib/match-news/model-answers.ts` (só leitura), `app/globals.css` e `palpite-hero.tsx` (hunks separados do azarão). |
| R14 | aceito | §1, §8, §11, §12 e §14 leem-se com a D1: nada de bloco no `/p`; o helper de firewall serve ao HERO e à área; no `/p`, "zero `data-pesou`"; o commit 6 é só o loader e os testes. |
| R15 | mantido | Corte proporcional em log, depois da ordenação (R10), com teste sintético. É barato e evita bloco sumindo no dia em que um peso mudar. |
| R16 | mantido, documentado | `pp` fica no jsonb para auditoria (e para o "mexeu menos de 1 pt"); a view não lê. |
| R17 | aceito | Componente `WeighedBlock`. |
| R18 | aceito | `movesOf` desempata pelo destino: mandante antes. |
| R19 | aceito | Comentário no CSS: a partir do slot 7 as raias animam juntas. |
| R20 | aceito | Uma linha na emenda da 0030 (ver R1). |
| R21 | aceito | "e N notícias do ge citadas (entram só no texto)": a contagem é de `headline.sources`, as citadas. |

Outros ajustes de leitura do código:

- "por pouco" usa a folga final em pontos inteiros (`finalPts`, < 5), não `pick.probs`: a view lê só `pick.weighed`, `pick.outcome` e `pick.source`.
- A bolinha de raia usa `--to` sem unidade e `animation-delay` inline em segundos; nenhum `style` com `%`.
- O bloco no "Ver raciocínio" vem do `heroPalpite.weighed`, só quando `!showLive` (§5).

Ordem dos commits: este ajuste; emenda da 0030 §3 (sozinha); emendas 0065 §2 e 0072 §9 + comentário do `db/schema.ts`; rateio (`lib/quant/apportion.ts`); cálculo (`weighed.ts`, `synthesis-input.ts`, `pick.ts`); view model; componentes + CSS + HERO + diálogo; `/p` (loader).
