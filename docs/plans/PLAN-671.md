# PLAN-671: Chances do azarão (advogado da zebra com revisor adversarial)

Issue: #671 (PR B de 3; A = #670/PR #674, C = #672). Proposta aprovada: `/mnt/project-files/azarao-e-noticias/proposta.html` (seção 1, "O botão"). Este plano é um snapshot de 2026-11-21, conferido no branch `claude/project-thread-dcg9ic`, que já contém o PR #674. É arquivo histórico, não spec viva.

---

## 0. Pontos em que o pedido ou a proposta conflitam com o código (decidir antes de implementar)

1. **"Toda chamada de LLM passa por `lib/ai/predict.ts`" (CLAUDE.md e o pedido) contra o precedente.** O `predict.ts` grava `predictions` e faz o fan-out de mercados. As chamadas que não produzem predição já usam uma **segunda porta**: o seam `AIProvider` (`getProviderForModel`), com log próprio em `ai_calls`, `persistAiCallError` e `servedModel`. Exemplos: `lib/ai/bet-slip-explain/explain.ts` (ADR 0063 §5), `lib/ai/user-palpite/narrate.ts` e `extract.ts` (ADR 0055 §8), `bet-parse` (ADR 0036). **Recomendação:** seguir esse precedente e registrá-lo no ADR novo. Passar pelo `predict.ts` exigiria uma predição falsa.
2. **`lib/ai/prompts/` não existe.** Os cartuchos ficam junto do módulo (`lib/ai/bet-slip-explain/cartridge.ts`, `lib/ai/user-palpite/narrate-cartridge.ts`). Vale o mesmo aqui: `lib/ai/underdog/*-cartridge.ts`, com constante de versão.
3. **Não existe `/admin/settings`.** As flags vêm do registro `lib/config/admin-flags.ts` e aparecem em `/admin/ia` ou `/admin/motor` conforme a `area`. A flag nova entra com `area: "ia"`, ao lado de `enableBetSlipExplain`.
4. **O firewall da ADR 0030 proíbe `%` dentro do PalpiteHero.** `components/__tests__/palpite-hero.test.tsx` usa `leaksValue = containsValueLanguage(html) || /%/.test(html)` sobre `section[aria-label="palpite"]`. O mockup põe o botão "26%" dentro do cartão do palpite, e isso quebra o firewall. **O bloco do azarão tem de ser IRMÃO do HERO** dentro do `PalpiteArea`, colado logo abaixo do cartão, como o "Ler análise completa" já é. O "45% pelo modelo" do mockup também não existe no código: a confiança é só a palavra (ADR 0069).
5. **"Base Dixon-Coles".** `match_model_snapshots.probabilities` e `lambdaHome/Away` são **pós-JEV**. É o mesmo número da tabela de Mercados e do seam `getMatchModelScoreline`. O `lambdaSource` também pode ser `heuristic`. Use o número da row (pós-JEV), que é o que o usuário vê no resto da página. No texto, só diga "Dixon-Coles" quando `lambdaSource === "dixon_coles"`; nos outros casos, "modelo simplificado".
6. **`topScorelines` guarda só os 5 placares mais prováveis no total.** Os placares de vitória do azarão quase nunca estão entre eles. É preciso refazer a matriz com `scorelineMatrix(lambdaHome, lambdaAway, {rho})`, como a proposta já diz.
7. **"Favorito poupa titulares, −15% de λ".** O peso máximo de `rotation_risk` é só 5% (`JUDGMENT_WEIGHTS`, `lib/ai/judgments/apply.ts`). Os −15% são o piso **do produto de todos os fatores** (`TEAM_MULTIPLIER_MIN = 0.85`). **Recomendação:** usar `λ_fav = lambdaBase_fav × TEAM_MULTIPLIER_MIN` e a etiqueta honesta "{Fav} com desfalques e rodízio no limite do modelo". Pular o cenário se o λ pós-JEV já estiver nesse piso ou abaixo dele.
8. **"Azarão" já tem outra regra no produto.** A ADR 0070 §7 e `lib/view/match-tags.ts` (`underdogSide`, `LONGSHOT_MAX_PCT = 20`) chamam de azarão o lado com menos de 20%. A regra nova (diferença ≥ 8 pp) é outra. **Não reusar o nome `underdogSide`**: a função nova se chama `findUnderdog`, em `lib/underdog/gate.ts`. As duas regras convivem: a etiqueta do /jogos é mais restrita que o botão.
9. **"Reabrir não cobra" vale só dentro da mesma base.** Sai row nova de snapshot quando o fingerprint muda: refit diário do Dixon-Coles (λ na 6ª casa), JEV novo ou escalação. O heartbeat mantém o mesmo id. O texto guardado fica velho pelo menos uma vez por dia. Ver §6.3.
10. **#668 (palpite decidido em código) segue aberto.** O resultado do palpite pode vir da matriz do próprio run (com o "Contexto extra" do usuário), não da base. Por isso a "porta de coerência" da §3: se o placar provável do palpite der a vitória ao lado que a base chama de azarão, o botão não aparece.
11. **Notícias.** A issue diz que os sinais de notícia aparecem só com o C (conferidos). O pedido permite usar notícias no B. **Recomendação:** chamar só o RSS do ge (`getNewsViaTeamFeeds`, grátis e sem LLM), **nunca** o fallback de web search (custa uma chamada a mais). As notícias entram como fato **não conferido** para a IA e para o revisor. A lista de sinais feita em código não ganha linha de notícia (o código não sabe se a matéria favorece o azarão). A tela mostra só as notícias **citadas pelas frases que sobreviveram** (título e link, como já faz o `headline.sources`).
12. **Modelo do advogado.** O mockup diz "Sonnet", mas a issue diz "família do usuário". Usar `resolveUserRunModelId(userId, isAdmin)`, como o #614. O revisor é sempre `MODEL_REGISTRY[UTILITY_MODEL_ID]` (Haiku 5.5) com `UTILITY_EFFORT`.
13. **Nome dos arquivos de componente.** O CLAUDE.md pede PascalCase, mas o repositório usa kebab-case (`palpite-area.tsx`, `seu-palpite-section.tsx`). Seguir o repositório.

---

## 1. Escopo

**Dentro (v1):**
- Teaser grátis abaixo do palpite: "Chances do azarão · {Azarão} vence · 26%". Só pré-jogo, com base fresca, diferença ≥ 8 pp e flag ligada.
- Clique: um portão grátis, depois 1 unidade do limite de palpites, depois um painel com:
  - chance, empate e favorito;
  - os 3 placares de vitória do azarão mais prováveis;
  - 3 cenários calculados em código;
  - os sinais a favor, com a origem de cada um;
  - o texto do advogado da zebra, revisado pelo Haiku, com o contraponto.
- Persistência por (usuário, base). Reabrir com a mesma base não cobra.
- Flag `enable_underdog_view` (default ON), ADR 0073, migration 0067.

**Fora:**
- Ao vivo. Não é trivial: o azarão muda com o placar, a base não serve de chave de persistência (o estado muda a cada minuto) e os cenários perdem o sentido. Fica para depois.
- Notícia como fator conferido (é o C).
- Botões "Adicionar às suas apostas" a partir dos placares.
- Compartilhar o texto entre usuários (ver Alternativas).

---

## 2. Fluxo de dados

```
page.tsx (Promise.all) ── loadUnderdogTeaser({match, userId, now})   [só leitura do banco, nunca lança]
   ├─ getEnableUnderdogView()
   ├─ getLatestMatchModelSnapshotWithKickoff(matchId) → modelScorelineFromSnapshot (portões de versão/idade/apito)
   ├─ findUnderdog(p1X2) → null ou {side, winPct, favPct, drawPct}
   └─ getLatestUnderdogView(userId, matchId) → row guardada (de qualquer base) + storedIsCurrent
→ porta de coerência com heroPalpite.probableScore
→ <PalpiteArea underdog={teaser ? <UnderdogPanel teaser=…/> : null}>

UnderdogPanel (cliente) ── clique ──► app/actions/underdog.ts: openUnderdogView(formData{matchId})
   portões grátis: sessão → acesso → flag → jogo pré-jogo → base atual válida → azarão claro
   → row (user, snapshotAtual) existe? devolve SEM cobrar
   → checkPalpitesRateLimit(userId, {failClosed: !isAdmin})
   ── a partir daqui nada falha ──
   computeUnderdogFacts(snapshot)            [puro: placares, cenários]
   + fetchUnderdogSignals(match, snapshot)   [form/H2H/desfalques do provider com cache, RSS do ge; cada um degrada sozinho]
   → buildFactsBlock (ids P#/S#/C#/F#/N# + números permitidos)
   → generateUnderdogCase (lib/ai/underdog/generate.ts)
        advogado (família do usuário) → guardas por frase → revisor (Haiku) → merge → template se preciso
        2 rows em ai_calls (underdog_advocate_v1, underdog_review_v1)
   → insertUnderdogView (ON CONFLICT (user_id, model_snapshot_id) DO NOTHING → relê)
   → toUnderdogView → cliente
```

---

## 3. Porta de exibição e limiares

Tudo em `lib/underdog/gate.ts` (puro) e `lib/underdog/constants.ts`:

- `UNDERDOG_MIN_GAP_PP = 8`.
- `findUnderdog({home, draw, away})`:
  - `side = away < home ? "away" : "home"`;
  - `gap = |home − away|`;
  - `gap < 8` → null. Empate exato também dá null.
  - O empate não entra na regra: 25/45/30 tem gap 5 e esconde o botão; 26/29/45 tem gap 19 e mostra.
- A base precisa valer, com os mesmos portões de `getMatchModelScoreline`:
  - `modelVersion === MATCH_MODEL_VERSION`;
  - `now − checkedAt ≤ MATCH_MODEL_MAX_AGE_MS` (24h);
  - `kickoffAt > now`.
- O jogo precisa estar em pré-jogo e analisável. Na página: `phase.kind === "pre" && caps.analyze`. Na action: `match.status === "scheduled" && kickoffAt > now`, o mesmo predicado de predict e explain.
- Coerência com o palpite (§0.10): se existe `heroPalpite`, o seu `probableScore` não está liquidado e o resultado dele (casa/fora) é o lado azarão → esconder. Palpite de empate não esconde.
- Flag desligada → nada aparece (nem a row guardada) e a action recusa.

**Refactor pequeno:** extrair de `getMatchModelScoreline` (`lib/model-base/model-scoreline.ts`) uma função pura exportada `modelScorelineFromSnapshot(snapshot, kickoffAt, now): ModelScoreline | null`, e fazer a função atual delegar para ela. O loader e a action usam a função pura porque também precisam da row (λ base, `judgments`, id).

---

## 4. Matemática (código, nunca LLM), em `lib/underdog/`

Versão `UNDERDOG_CALC_VERSION = "underdog_calc_v1"`, gravada na row.

**4.1 Chances.** `p1X2(matrix)` sobre a matriz refeita (dá o mesmo que `snapshot.probabilities.match_result`). Na tela, inteiros. "Mais ou menos 1 jogo em cada N" com `N = round(100/p)`, só quando 5 ≤ p ≤ 50.

**4.2 Placares de zebra** (`scorelines.ts`): as células `h<a` (ou `h>a`, conforme o lado) da matriz, ordenadas por p, as 3 primeiras, com `pct` em 1 casa.

**4.3 Cenários** (`scenarios.ts`), todos com `inPlayScoreline(pre, state)` de `lib/quant/in-play.ts`:
- **A. "{Azarão} abre o placar até os 30'"**: `state = {statusShort:"1H", elapsed:30, extra:null, score: azarão 1×0, red:null}`. É um limite inferior conservador (gol mais cedo dá chance maior), então a etiqueta diz "faz 1 × 0 e chega aos 30' na frente", ou "até os 30'" com nota de que a conta usa os 30'.
- **B. "{Favorito} com um a menos desde os 60'"**: mistura sobre o placar aos 60'. `P(h,a aos 60') = Pois(h; λH·(1−r60))·Pois(a; λA·(1−r60))`, com `r60 = remainingFraction({2H, 60})`. Para cada célula com p > 1e-5: `P(azarão vence | placar, 60', red = favorito 1)`. Pondera e normaliza pela massa coberta. **Por que a mistura:** condicionar em 0×0 aos 60' já muda a chance sozinho (o mockup "26% → 32%" mistura os dois efeitos). Conferência no código e em teste: a mesma mistura com `red:null` precisa ficar a ±1 pp do pré-jogo. Se não ficar, o cenário é descartado e o caso é logado.
- **C. "{Favorito} com desfalques e rodízio no limite"**: `λ_fav' = lambdaBase_fav × TEAM_MULTIPLIER_MIN`. Só se `λ_fav' < λ_fav` pós-JEV. A matriz é `scorelineMatrix(λ_fav', λ_azarão, {rho})`.
- Cada cenário tem `{id, label, beforePct, afterPct}`. Cenário com |Δ| < 1 pp ou que falhou (null) sai da lista.

**4.4 Sinais a favor** (`signals.ts`, puro sobre dados já buscados; cada um traz `origin: "dados" | "modelo"`):
- **H2H** (`provider.getH2H`, até 5 com placar): vitórias do azarão ≥ 2 e ≥ vitórias do favorito → "Últimos N confrontos: X vitórias do {Azarão}".
- **Forma** (`getTeamForm`, FORM_LAST = 5): pontos do azarão ≥ pontos do favorito → "Forma: {Azarão} V V V V E · {Fav} D D V V E".
- **Desfalques** (`getAbsencesProvider().getAbsencesByFixture`): favorito com ≥ 3 e mais que o azarão → "{Fav} com N na lista de desfalques". Na tela só a contagem; os nomes podem ir para os fatos.
- **JEV da base** (`snapshot.judgments.answers`, sem chamada nova): `value > 0.5` em `attack_weakened_{fav}`, `defense_weakened_{fav}`, `rotation_risk_{fav}` ou `high_stakes_{azarão}` → frase fixa por fator, com origem "modelo" e a nota "já está na chance acima".
- Provider que falha → o sinal some. Sem nenhum sinal → "Nenhum sinal claro a favor hoje".
- Reusar a contagem de `summarizeForm`/`summarizeH2H` de `lib/ai/palpites/cartridges/cartridge.ts`. Hoje são privados: extrair para um módulo compartilhado sem mudar um byte do prompt `palpites_v13`, com um teste que fixa o `buildUserMessage` atual.

**4.5 Notícias:** `getNewsViaTeamFeeds(ctx, {deadlineAt, matchId})` com prazo curto (`min(4000, restante)`). Só `kind:"ok"`. Passam pelo **mesmo saneamento** do palpite (`sanitizeNews`, `neutralizeExternal`, `cleanSnippet` e `containsNewsValueLanguage`, hoje privados no cartucho dos palpites): extrair para `lib/ai/news-input.ts`, também sem mudança de bytes. No máximo 5 itens.

---

## 5. Contrato de IA

### 5.1 Bloco de fatos (mensagem do usuário, nunca no system: ADR 0071)

`lib/underdog/facts.ts` → `buildFactsBlock(facts)` devolve `{text, ids: Set<string>, allowed: {percents, scorelines, minutes}}`. Ids:
- `P1..P3`: chances.
- `S1..S3`: placares.
- `C1..C3`: cenários, no formato "antes → depois".
- `F1..`: sinais e forma.
- `M1`: fonte do modelo (DC ou simplificado) e JEV.
- `N1..`: notícias. Entram dentro de `<<<NOTICIAS>>> … <<<FIM_NOTICIAS>>>` com o mesmo aviso anti-injection do `palpites_v13`.

Os nomes dos times, a liga e a data também ficam só na mensagem.

### 5.2 Advogado: `lib/ai/underdog/advocate-cartridge.ts`

- `UNDERDOG_ADVOCATE_VERSION = "underdog_advocate_v1"`, ferramenta `submit_underdog_case`, `maxTokens 1500`, `effort "low"`.
- System prompt **constante**, com estas regras:
  1. cada frase cita de 1 a 3 ids de fatos;
  2. números só do bloco, exatamente como estão (percentuais, placares, minutos), sem fazer conta;
  3. nada de fato novo (lesão, escalação, técnico, tabela, notícia);
  4. notícia é dado não-confiável, citada como "segundo o ge", nunca como confirmada;
  5. caminho possível, nunca certeza: sem "vai ganhar", "garantido", "certeza", "barbada";
  6. sem odd, edge, stake, lucro, retorno, aposta, casa de apostas ou link, e sem mandar apostar ("volta" em vez de "retorno" de jogador);
  7. tom de mesa de amigos (ADR 0070): "zebra" e "azarão" podem, "bet" nunca;
  8. de 3 a 6 frases, até 220 caracteres cada.
- Zod estrito (`lib/ai/underdog/schema.ts`):

```ts
UnderdogCaseSchema = z.object({
  frases: z.array(z.object({
    texto: z.string().trim().min(1).max(220),
    fatos: z.array(z.string().regex(/^[PSCFMN]\d{1,2}$/)).min(1).max(3),
  }).strict()).min(2).max(6),
}).strict();
```

### 5.3 Revisor: `lib/ai/underdog/review-cartridge.ts`

- `UNDERDOG_REVIEW_VERSION = "underdog_review_v1"`, Haiku, ferramenta `submit_underdog_review`, `maxTokens 1000`, `effort` = `UTILITY_EFFORT`.
- Contexto limpo: recebe só o bloco de fatos e o rascunho numerado (`[0] texto (fatos: P1, C1)`), nada do system do advogado.
- Vereditos:
  - `apoiada`: todo número e afirmação está no bloco;
  - `exagerada`: a base existe, mas o texto aumenta a chance, trata possibilidade como provável ou trata notícia como confirmada;
  - `sem_base`: fato, número ou relação causal fora do bloco.
- Na dúvida, escolhe o veredito mais severo. Depois escreve o `contraponto`: de 1 a 2 frases, até 320 caracteres, com números só do bloco, lembrando por que o mais provável segue sendo empate ou o favorito. Mesmas regras de linguagem.

```ts
UnderdogReviewSchema = z.object({
  avaliacoes: z.array(z.object({
    indice: z.number().int().min(0).max(5),
    veredito: z.enum(["apoiada", "exagerada", "sem_base"]),
    motivo: z.string().trim().min(1).max(160),
  }).strict()).min(1).max(6),
  contraponto: z.string().trim().min(1).max(320),
}).strict();
```

### 5.4 Guardas e merge: `lib/ai/underdog/guards.ts` e `merge.ts` (puros, nunca lançam)

**Por frase do advogado.** Reprovar descarta a frase, que conta como cortada:
- todo id em `fatos` existe no bloco;
- `PERCENT_RE` / `PERCENT_TOLERANCE_PP` (`lib/ai/markets/_narrator/fidelity.ts`) contra `allowed.percents`;
- placar `(\d+)\s*(?:x|×|a)\s*(\d+)` contra `allowed.scorelines` (placares S mais os estados dos cenários, ex. 1×0);
- minuto (`\d{1,3}\s*(?:'|’|min)`, "aos N") contra {30, 60};
- linguagem:
  - `containsValueLanguage` (`lib/ai/palpites/value-language-guard.ts`);
  - `BET_LANGUAGE_RE` (apost*; hoje local em `lib/ai/user-palpite/fidelity.ts`, exportar);
  - `BOOKMAKER_NAME_RE` e o padrão de URL (`lib/ai/bet-slip-explain/fidelity.ts`);
  - promessa (`garantid*` fora de negação, "certeza", "barbada");
  - "bet" (o mesmo regex da `__tests__/voice-firewall.test.ts`).

**Revisor.** Um veredito por índice que sobreviveu, nem a mais nem a menos. Faltou → falha do revisor. `CUT_VERDICTS = ["sem_base"]`, como a proposta aprovada diz. *Pergunta aberta para o review do plano: cortar também `exagerada`?* Hoje a frase exagerada fica e o contraponto responde a ela.

**Sobrevivência.** `kept ≥ max(2, ceil(totalDoAdvogado/2))`. Se não, o texto inteiro vira **template**.

**Contraponto.** Passa pelas mesmas guardas de número e linguagem. Reprovou → contraponto de template, mantendo o texto do advogado.

**Revisor que falha** (sem chave, timeout, `tool_missing`, Zod, prazo) → **template** (fail-closed: texto sem revisão não vai para a tela).

### 5.5 Template: `lib/ai/underdog/fallback.ts`

Frases só do código, que passam pelas próprias guardas (teste):
- "{Azarão} vence em {p}% das simulações do modelo, mais ou menos 1 jogo em cada {N} assim."
- O cenário com o maior Δ: "Com {Azarão} na frente aos 30', a chance vai a {x}%."
- O primeiro sinal.
- "O placar de zebra mais provável é {S1}."
- Contraponto: "Nos outros {round(d+f)}% o jogo termina empatado ({d}%) ou com vitória do {Fav} ({f}%)."

### 5.6 Orquestrador: `lib/ai/underdog/generate.ts`

Cópia estrutural de `explainBetSlipWithAI`, com duas chamadas:
- `canFitCall` antes de cada uma;
- `persistAiCallError` / insert `ai_calls` com o `promptVersion` de cada uma;
- `calculateCost` com os tokens de cache;
- `servedModel` (ADR 0062).

Devolve `{narrative, source: "llm" | "template", failure: "none" | "guards" | "infra", advocateAiCallId, reviewerAiCallId, advocateFamily}`. **Nunca lança.**

---

## 6. Persistência

### 6.1 Schema (`db/schema.ts`): tabela `underdog_views`

| coluna | tipo |
|---|---|
| `id` | uuid pk defaultRandom |
| `user_id` | uuid not null → users, restrict |
| `match_id` | uuid not null → matches, restrict |
| `model_snapshot_id` | uuid not null → match_model_snapshots, cascade (snapshots nunca são apagados hoje; o texto é derivado) |
| `underdog_side` | text `'home' \| 'away'` |
| `facts` | jsonb: os números do painel congelados (chances, placares, cenários, sinais, notícias com id/título/url, fonte do modelo), para o texto e os números baterem ao reabrir; sinais e notícias não são reproduzíveis |
| `narrative` | jsonb `{sentences: [{text, facts, verdict}], counterpoint, cut, total}` |
| `narrative_source` | text `'llm' \| 'template'` |
| `versions` | jsonb `{calc, advocate, review, matchModel}` |
| `advocate_ai_call_id`, `reviewer_ai_call_id` | uuid → ai_calls, set null |
| `created_at` | timestamptz default now |

Índices:
- `UNIQUE (user_id, model_snapshot_id)`;
- `(user_id, match_id, created_at desc)`.

Mais `ai_config.enable_underdog_view boolean not null default true`.

Leitura sempre por Zod (`UnderdogFactsSchema`, `UnderdogNarrativeSchema` em `lib/underdog/types.ts`). Row inválida é omitida com log, como em `parseSnapshot`.

### 6.2 Migration `db/migrations/0067_underdog_views.sql`

Gerar com `pnpm db:generate` (para o `_journal.json` e o `0067_snapshot.json`) e depois editar à mão, no padrão de `0057_user_palpite_analyses.sql`:
- `CREATE TABLE IF NOT EXISTS`;
- `ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "enable_underdog_view" boolean DEFAULT true NOT NULL`;
- FKs em `DO $$ BEGIN … EXCEPTION WHEN duplicate_object THEN NULL; END $$`;
- `CREATE UNIQUE INDEX IF NOT EXISTS` e `CREATE INDEX IF NOT EXISTS`;
- cabeçalho com o comentário sobre o DB de preview compartilhado.

Conferir que nenhum outro branch em voo pegou o 0067. Se pegou, renumerar na hora do merge.

### 6.3 Regras

- A action procura a row de (user, snapshot **atual**). Se existe, devolve sem cobrar.
- O teaser carrega a **última row do usuário no jogo**, de qualquer base:
  - mesma base → abre na hora, sem action;
  - base mais velha → mostra o texto antigo com os números congelados dele e a linha "O modelo foi recalculado desde este texto" + botão "Atualizar · usa 1 do limite";
  - se a base atual não passa na porta da §3, nada aparece.
- **Template por falha de infraestrutura (provider/timeout) não é gravado**: o usuário pode tentar de novo, pagando, como no #614. Template por guardas/revisor **é gravado**: é um resultado determinístico e evita a sensação de roleta.
- Corrida (dois cliques ou duas abas): `ON CONFLICT DO NOTHING` e releitura. A dupla cobrança nesse caso raro é aceita. O botão fica desabilitado enquanto `pending`.
- **LGPD:** o payload não tem dado do usuário (só dados do jogo), então **não** entra na redação de `ai_calls`. A row registra comportamento do titular: adicionar `DELETE FROM underdog_views WHERE user_id = :uid;` ao runbook da ADR 0046 (emenda curta). O `/privacidade` já cobre "dados das partidas"; sem mudança.

---

## 7. Server action: `app/actions/underdog.ts`

Espelha `app/actions/bet-slip-explain.ts`. `"use server"`, `actionDeadline()`, entrada `matchId` (z.uuid()).

Resultado:

```ts
| {ok: true; view: UnderdogView; charged: boolean}
| {ok: false; error: string; kind: "invalido" | "desligado" | "nao-encontrado" | "fechado" | "sem-azarao" | "limite"}
```

Ordem:
1. sessão / acesso / `isEmailAllowed`;
2. `getEnableUnderdogView()`;
3. `getMatchById` → pré-jogo;
4. snapshot atual → `modelScorelineFromSnapshot` → `findUnderdog`;
5. row existente?;
6. `checkPalpitesRateLimit(userId, {failClosed: !isAdmin})`, com `fail-closed` → `ANALYSES_UNAVAILABLE_MESSAGE` e o limite → "Você atingiu o limite de N usos por dia (palpites, Seu palpite, explicações e chances do azarão)…";
7. depois da cobrança, try/catch total: fatos → sinais (`Promise.allSettled`) → `generateUnderdogCase` → insert → `toUnderdogView`. Exceção inesperada → template na hora, sem gravar.

O cliente manda **só** o `matchId`. Números, base e sinais saem do servidor.

---

## 8. Interface

**Onde fica:** `components/palpites/palpite-area.tsx` ganha o slot `underdog?: ReactNode`, renderizado logo depois de `<PalpiteHero … collapsible />` e antes de "Ler análise completa", **fora** de `section[aria-label="palpite"]`. Em `page.tsx`, o `loadUnderdogTeaser` entra no `Promise.all` existente (linhas 238-268), em paralelo e sem Suspense, para não haver salto de layout abaixo do HERO. O teaser é calculado depois, com `phase`/`caps`/`heroPalpite`, e passado ao `PalpiteArea` via `MatchLayout`.

**Componentes:**
- `components/underdog/underdog-panel.tsx` (cliente, `useActionState`);
- `components/underdog/underdog-facts.tsx` (apresentação pura);
- view mapper `lib/view/underdog.ts` (`toUnderdogTeaserView`, `toUnderdogView`: nomes de exibição via `displayMatchTeams`, % formatados por `lib/format-number`).

**Fechado:**
- linha-botão com borda suave e tom quente, `aria-expanded`, `aria-controls`;
- à esquerda, "Chances do azarão" e "{Azarão} vence · como a zebra acontece"; à direita, "26%" em mono tabular;
- abaixo, em `text-meta`, "Usa 1 do seu limite diário de palpites", só quando não há texto guardado para a base atual.

**Carregando:** skeleton das seções e a linha "O advogado da zebra está montando o caso…". O botão fica desabilitado.

**Aberto:**
1. "26% {Azarão} vence" e "Mais ou menos 1 jogo em cada 4 assim. Empate 29%, {Fav} 45%."
2. "Placares de zebra mais prováveis": 3 chips "0 × 1 · 8%".
3. "Se acontecer…": linhas com a etiqueta à esquerda e "26% → 59%" à direita, em mono.
4. "Sinais a favor hoje": lista com etiqueta de origem ("dados", "modelo").
5. O bloco da IA em fundo `muted`:
   - frases sobreviventes em parágrafo e "Advogado da zebra · {Família}";
   - "Contraponto." mais o texto;
   - "Revisor adversarial · Haiku · N frase(s) cortada(s) · usou 1 do limite de palpites";
   - links "Fontes citadas" das notícias `N#` usadas;
   - no template, "Texto padrão: o rascunho da IA não passou na conferência";
   - base velha: a linha "Atualizar".

**Desktop** (container `wide`, coluna principal de ~852px ao lado do `SlipAside` de 340px): o painel ocupa a largura da coluna principal; cenários em grid `grid-cols-[1fr_auto]`; chips em uma linha.

**Celular:** coluna única; os chips quebram linha; nos cenários, a etiqueta fica em cima e os números embaixo, alinhados à direita, se não couber; nada fixo; o espaçador da `SlipMobileBar` já existe.

**Regras visuais e de texto:**
- piso de 11px só em número mono (ADR 0056);
- **nenhum aviso de risco no painel** (um aviso por tela, ADR 0057);
- nenhum número de odd, odd justa ou stake;
- sem cor `edge-*`;
- textos de tela no tom da ADR 0070.

**Admin:** entrada `enableUnderdogView` em `lib/config/admin-flags.ts`, com `area: "ia"`, rótulo "Chances do azarão", descrição e `costNote`: "Cada uso: 1 chamada do modelo de análise do usuário (até 1.500 tokens) + 1 Haiku (até 1.000), contando 1 do limite diário de palpites. Forma/H2H/desfalques pelo cache da API-Football; RSS do ge grátis; sem The Odds API. ~US$ 0,006." Getter `getEnableUnderdogView()` em `lib/db/queries/ai-config.ts` (default true sem row).

---

## 9. Testes

**Puros (`lib/underdog/__tests__/`):**
- `gate.test.ts`: lado; gap 7,99 esconde e 8 mostra; empate de vitórias; empate dominante; base velha, versão diferente e jogo já começado → null; coerência com o palpite (palpite no azarão esconde, empate não esconde, palpite liquidado ignorado).
- `scorelines.test.ts`: as 3 células de vitória do azarão em ordem, espelho casa/fora, arredondamento.
- `scenarios.test.ts`:
  - A sobe a chance;
  - mistura B sem cartão a ±1 pp do pré-jogo (vários λ);
  - B com cartão no favorito sobe;
  - C usa `lambdaBase × 0.85` e é pulado quando o JEV já está no piso;
  - simetria casa/fora;
  - determinismo;
  - Δ < 1 pp sai.
- `signals.test.ts`: limiares de H2H, forma, desfalques e JEV; provider com falha omite o sinal; zero sinais.
- `facts.test.ts`: ids estáveis, `allowed` completo, notícias saneadas dentro dos delimitadores.

**IA (`lib/ai/underdog/__tests__/`, mock do provider no padrão de `lib/ai/bet-slip-explain/__tests__/explain.test.ts`):**
- `cartridges.test.ts`: versões; system e tool constantes, sem nome de time, data ou id (ADR 0071); a mensagem traz os ids.
- `schema.test.ts`: campo a mais, id inválido, limites.
- `guards.test.ts`, um corte por regra: percentual de fora, placar de fora, minuto de fora, id inexistente, "odd", "retorno", "aposte", nome de casa, URL, "garantido", "bet".
- `merge.test.ts`: corte de `sem_base`, `exagerada` mantida, menos da metade → template, revisor sem um índice → template, contraponto inválido → template do contraponto.
- `fallback.test.ts`: o template passa nas próprias guardas.
- `generate.test.ts`: duas rows em `ai_calls` com versões e custo; advogado falha → template sem chamar o revisor; revisor falha → template; prazo; nunca lança; `failure: "infra" | "guards"` certo.

**Banco:** `lib/db/queries/__tests__/underdog-views.pglite.test.ts`, com as migrations reais: unique (user, snapshot), `ON CONFLICT` relê, última row por jogo, Zod omite row inválida, coluna da flag com default true.

**Action:** `app/actions/__tests__/underdog.test.ts`:
- sem sessão;
- flag desligada;
- jogo começado;
- sem azarão (recusa grátis, `checkPalpitesRateLimit` não é chamado);
- row existente devolve sem cobrar;
- limite e fail-closed;
- depois da cobrança, sempre ok;
- template de infraestrutura não grava, template de guardas grava.

**Interface:**
- `components/underdog/__tests__/underdog-panel.test.tsx`: fechado mostra o %, a nota de custo e `aria-expanded`; aberto mostra as seções; template mostra a etiqueta; base velha mostra "Atualizar"; o HTML não tem `containsValueLanguage` (o `%` é permitido aqui).
- `components/palpites/__tests__/palpite-area.test.tsx`: o slot do azarão fica **fora** de `section[aria-label="palpite"]` (espelhar o teste da linha ~188), e o firewall do HERO continua limpo.
- Adicionar `components/underdog/*` à lista de `__tests__/voice-firewall.test.ts` (FILES) e aos `PAGE_FILES` de `app/(app)/match/[id]/__tests__/one-notice.test.ts`.
- Conferir `single-tree.test.ts` (nada de `lg:hidden` em `page.tsx`).

**Outros:**
- Flags: `lib/config/__tests__/admin-flags.test.ts` e `lib/admin/__tests__/settings-index.test.ts` (se listarem as chaves).
- Refactors sem mudança de bytes: teste que fixa a saída de `buildUserMessage` do `palpites_v13` antes e depois de extrair `sanitizeNews`/`summarizeForm`/`summarizeH2H`; teste de `modelScorelineFromSnapshot` equivalente ao `getMatchModelScoreline`.

---

## 10. Riscos e pegadinhas

- **Firewall do HERO:** qualquer `%` dentro do `PalpiteHero` quebra o teste. O slot fica fora.
- **Coerência com o #668:** se o #668 entrar antes, a porta de coerência pode usar o resultado decidido em código. Se entrar depois, a regra de `probableScore` cobre o caso.
- **A base muda todo dia** (refit do DC): a linha "Atualizar" vai aparecer com frequência. Não regerar sozinho. Se incomodar, follow-up: considerar a mesma base quando `|Δ chance do azarão| < 1 pp` e os mesmos placares.
- **"retorno" e "R$" nas notícias:** a entrada aceita os dois, mas a saída barra `retorno`. O prompt pede "volta"; a frase que escorregar é cortada, e não o texto inteiro.
- **"2 a 1" como placar:** o regex de placar aceita " a ". Cuidado com falso positivo do tipo "de 2 a 3 jogos". Ou restringir a "N x N"/"N × N" e pedir esse formato no prompt (recomendado).
- **Prompt caching:** os system prompts são curtos e podem não chegar ao mínimo cacheável do Haiku. É inofensivo, mas não prometer economia.
- **Prazo:** advogado (Sonnet ou Opus, 10-40 s) mais Haiku (3-6 s), dentro dos 270 s da action. Opus com o prazo apertado → `canFitCall` → template.
- **Quota:** form/H2H/desfalques passam pelo provider com cache (o mesmo da aba Dados). Nunca chamar a The Odds API. Nunca usar o fallback de web search das notícias.
- **Os testes de `ai_calls` contam linhas por `promptVersion`?** Conferir `lib/db/queries/ai-costs.ts`: hoje ele não filtra por versão.
- **Duas ADR "0067" já existem;** a próxima livre é a **0073**.

---

## 11. Ordem de implementação (um PR, commits nesta ordem)

1. `docs:` ADR 0073 ("Chances do azarão: advogado da zebra com revisor adversarial"):
   - segunda porta de LLM como as ADRs 0063 e 0055;
   - porta de 8 pp e coerência;
   - cenários em código;
   - Haiku em contexto limpo e o corte;
   - 1 unidade do limite de palpites;
   - persistência por (usuário, base);
   - só pré-jogo;
   - flag;
   - sem casa de apostas;
   - emenda curta ao runbook da ADR 0046.
2. `refactor:` `modelScorelineFromSnapshot`, e extração de `sanitizeNews`/`summarizeForm`/`summarizeH2H` e de `BET_LANGUAGE_RE`, com os testes de bytes iguais.
3. `feat:` `lib/underdog/` (gate, placares, cenários, sinais, fatos, tipos/Zod, versão), com os testes.
4. `feat:` schema, migration 0067, `lib/db/queries/underdog-views.ts`, getter e entrada no registro de flags, com os testes pglite.
5. `prompt:` cartuchos `underdog_advocate_v1` e `underdog_review_v1`, schema, guardas, merge, template e orquestrador, com os testes.
6. `feat:` action `openUnderdogView`, com os testes.
7. `feat:` view mapper, `components/underdog/*`, slot no `PalpiteArea` e fiação no `page.tsx` (`Promise.all` e teaser), com os testes de interface, firewall, voz e aviso.
8. Verificação: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Prints no desktop (1280px, com o painel Suas apostas) e no celular, fechado, carregando, aberto, template e base velha, **aprovados pelo Fernando antes do merge** (critério de saída da issue). Citar no PR o custo das chamadas reais feitas para debug.

---

## 12. Alternativas rejeitadas

- **Texto compartilhado por (base, família) entre usuários:** mais barato, mas o dono decidiu por usuário, e a cobrança por uso viraria cobrança sem chamada. Fica como follow-up.
- **Código grátis ao expandir e cobrança só no texto da IA:** dois cliques e mais estado. O design aprovado cobra ao abrir.
- **Passar pelo `predict.ts`:** gravaria predição falsa (ver §0.1).
- **Cenário B condicionado em 0 × 0 aos 60':** mistura o efeito do placar com o do cartão (ver §4.3).
- **Notícia como sinal em código:** o código não sabe dizer se a matéria favorece o azarão. Isso é o PR C.

---

### Critical Files for Implementation
- /home/user/palpiteiro-claude/lib/ai/bet-slip-explain/explain.ts (modelo da segunda porta; também `cartridge.ts`, `fidelity.ts`, `fallback.ts`, `schema.ts` na mesma pasta)
- /home/user/palpiteiro-claude/app/actions/bet-slip-explain.ts (portões, ordem da cobrança, "depois da cobrança nunca falha")
- /home/user/palpiteiro-claude/lib/quant/in-play.ts (`inPlayScoreline`, `remainingFraction`, `RED_OWN`/`RED_OPP`) e /home/user/palpiteiro-claude/lib/model-base/model-scoreline.ts (portões da base e refactor)
- /home/user/palpiteiro-claude/app/(app)/match/[id]/page.tsx e /home/user/palpiteiro-claude/components/palpites/palpite-area.tsx (lugar do slot, firewall da ADR 0030)
- /home/user/palpiteiro-claude/db/schema.ts (+ `db/migrations/0057_user_palpite_analyses.sql` como modelo da 0067; `lib/config/admin-flags.ts`; `lib/db/queries/ai-config.ts`)
---

## Ajustes pós-review (2026-11-21) — PREVALECEM sobre as seções acima

Review independente conferiu os símbolos no código e rodou a matemática dos cenários com as funções do repo. Decisões:

1. **Cenário A**: etiqueta exata do estado: "Se o {Azarão} estiver vencendo por 1 × 0 aos 30'". Sai a nota de "limite inferior" (está invertida: gol mais cedo dá MENOS chance, porque sobra tempo pro empate). Nada de "abre o placar até".
2. **Cenário B**: forma fechada, sem mistura: `scorelineMatrix(λ_fav·((1−r60)+r60·RED_OWN), λ_dog·((1−r60)+r60·RED_OPP), {rho})`, com `r60 = remainingFraction({2H,60})` e as constantes de `lib/quant/in-play.ts` (exportar se preciso). Um teste garante forma fechada ≈ mistura via `inPlayScoreline` a ±0,5 pp. Sai o ramo "descarta e loga".
3. **Cenário C**: usa o código real: `applyJudgments({lambdaHomeBase, lambdaAwayBase}, answers)` com `attack_weakened_{fav}`, `defense_weakened_{fav}` e `rotation_risk_{fav}` = 1 e o resto como guardado (neutro sem `judgments`). Etiqueta: "{Fav} desfalcado e com rodízio (máximo que o modelo aplica)". Pula se Δ < 1 pp. Some o `TEAM_MULTIPLIER_MIN × λ`.
4. **Persistência por materialidade**: a row guardada vale como atual quando o lado é o mesmo e |Δ| < 2 pp em azarão, empate e favorito. A action aplica o mesmo teste ANTES de cobrar. "Atualizar" só depois de mudança material. O teaser mostra o % congelado da row guardada quando ela vale. UNIQUE(user, snapshot) fica só como dedupe de corrida.
5. **Texto pago não some**: antes do apito, row guardada sempre aparece; se a base atual não passa mais na porta, mostra "O modelo mudou desde este texto" sem botão "Atualizar".
6. **Ordem da cobrança**: `computeUnderdogFacts` (puro) roda ANTES de `checkPalpitesRateLimit` (falha de conta = recusa grátis). Sinais com timeout duro (`Promise.race` 5 s). Depois da cobrança, o insert tem try próprio: falha de banco devolve a view da IA sem gravar.
7. **Grava / não grava**: grava = guardas/Zod do advogado reprovaram ou o revisor deixou < 2 frases `apoiada`. Não grava = qualquer falha do revisor (chave, timeout, Zod, `tool_missing`, `indice` duplicado ou faltando) e falha de infraestrutura do advogado.
8. **Guardas de linguagem**: mover `IMPERATIVE_RE`, `PROMISE_RE`, `HOUSE_RE`, `URL_RE`, `BOOKMAKER_NAME_RE` e `BET_LANGUAGE_RE` para `lib/ai/language-guards.ts` (reexportando de onde estão, sem mudar comportamento) e usar todos. Placar só "N x N"/"N × N" (prompt pede esse formato). `allowed` inclui todos os placares, o complemento `round(d+f)` e o N de "1 jogo em cada N".
9. **Notícias fora do v1** (como a issue diz: entram com o C). Sem refactor do cartucho `palpites_v13`; contagens de forma/H2H como funções puras pequenas em `lib/underdog/signals.ts`. Sem ids N#, sem "Fontes citadas".
10. **Contraponto**: o prompt do revisor proíbe citar ou parafrasear frase `sem_base`; o código rejeita contraponto que divida 6+ palavras seguidas com frase cortada → contraponto de template.
11. **"exagerada" NÃO é cortada.** `sem_base` é objetivo (número, fato ou causa fora do bloco); "na dúvida, o mais severo" vale só entre `apoiada` e `exagerada`. Os índices `exagerada` vão para o contraponto rebater. Template quando < 2 frases `apoiada`. Logar a distribuição de vereditos (em `narrative`).
12. **ADR 0073 emenda a ADR 0070 §7**: a etiqueta do /jogos segue "< 20%"; o botão usa "lado menos provável, gap ≥ 8 pp".
13. **voice-firewall**: `components/underdog` em `DIRS`; `lib/view/underdog.ts` e `lib/ai/underdog/fallback.ts` em `FILES`. Guardas e cartuchos ficam fora (contêm as palavras proibidas de propósito). Títulos do painel h2/h3.
14. **Slot no PalpiteArea**: desestruturar `underdog` explicitamente (não vazar no `...hero`); o `<form>` do painel não fica dentro do form do HERO (teste). Slot DEPOIS da região "Ler análise completa", não entre o HERO e o toggle. Teaser aparece só com `heroPalpite` presente e sem run em andamento.
15. **Estados e a11y**: região `role="status"` `aria-live="polite"` para carregando/resultado/erro; `aria-busy` no painel; nota de custo ligada ao botão por `aria-describedby`; foco no título do painel ao carregar; mensagens para limite, fail-closed, desligado, fechado e sem-azarão.
16. **Uma fonte só**: `findUnderdog` sobre a matriz refeita (não sobre `probabilities` arredondado) e `underdogTeaserVisible({phase, caps, heroPalpite, flag})` puro, com testes, usados na página e na action. Sai o ramo "palpite liquidado".
17. **Miúdos**: FK `model_snapshot_id` com `restrict`; mensagem de limite numa constante compartilhada (unificar as ações existentes); Zod `frases.min(3).max(6)`; sinal JEV com `value ≥ 0.7`; ADR diz que o estado do JEV não é guardado no snapshot.
