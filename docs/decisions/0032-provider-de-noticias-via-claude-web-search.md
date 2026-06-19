# ADR 0032 — Provider de notícias via Claude web search (fontes reais citáveis)

## Status

Accepted (2026-06-19). Introduz **notícias** como categoria de DADO que alimenta o palpite embasado (ADR 0031), via a **server tool nativa de web search da Claude**, invocada pela fronteira `lib/ai/predict.ts` / o seam `AIProvider` (ADR 0027) e logada em `ai_calls`. Não cria infra de busca própria. **Respeita o gate de Tier 3 (ADR 0025)**: notícia é categoria de **dado**, não **mercado** liquidável novo — análoga ao provider dedicado de desfalques (ADR 0026), não habilita nenhum mercado novo.

## Contexto

O ADR 0031 fez o palpite **value-aware** e declarou que a manchete deve usar o **máximo de informação**. Hoje a síntese consome forma/H2H/tabela (`SportsDataProvider`), desfalques (`AbsencesProvider`, ADR 0026) e as análises multi-mercado com edge/EV. Falta um insumo que um humano consultaria antes de chutar um jogo: **notícias** — desfalque de última hora confirmado pela imprensa, troca de técnico, contexto de motivação/lesão que ainda não está nos dados estruturados.

Há dois jeitos errados de fazer isso. Um provider de notícias genérico (NewsAPI/GNews) adiciona um provider externo novo, uma key nova e uma integração própria — funciona, mas é peso. E uma chamada de LLM do tipo "me conte as notícias" **sem fonte real** é o pior caso: o modelo alucina a notícia E a fonte, destruindo a confiabilidade e a integridade de citação que são justamente o ponto da feature.

A Claude oferece uma **server tool de web search** que resolve isso reaproveitando o seam de LLM que o app já tem (ADR 0027). É metered por busca (não por token), retorna **fontes reais** (título + URL) e suporta **curadoria de domínios**. Como toda chamada de LLM já passa por `lib/ai/predict.ts` (única porta, logada em `ai_calls`), notícias entram pela mesma fronteira — sem furar abstração nem criar provider externo novo. O padrão de "categoria de dado dedicada, separada da `SportsDataProvider` gorda" já existe e é o modelo: o `AbsencesProvider` (ADR 0026, `lib/providers/absences/`, `getAbsencesProvider()` consumido em `lib/ai/predict.ts:28,250`, com gate de capability `supportsAbsences`).

## Decisão

**1. Notícia vira insumo do palpite, via web search nativa da Claude.** A busca é feita pela **server tool** de web search da Claude — `web_search_20260209` (com **dynamic filtering**) nos modelos atuais (Opus 4.8/4.7/4.6, Sonnet 4.6); `web_search_20250305` (busca básica) em modelos mais antigos/Haiku e no Vertex AI. A invocação passa por `lib/ai/predict.ts` / o seam `AIProvider` (ADR 0027) e é logada em `ai_calls`. **Sem infra de busca própria.** (Há variante mais nova `web_search_20260318` com controle de `response_inclusion`; usar a mais recente que o modelo do app suportar — validar contra a doc no momento da implementação.)

**2. Só fontes reais e verificáveis.** A tool devolve um bloco `web_search_tool_result` cujo `content` é uma **lista de `web_search_result`**, cada item carregando **título + URL** (a busca de verdade). O app **captura e persiste** esses `{title, url}` junto do conjunto de palpites e os renderiza como **citações clicáveis** na UI ("o palpite usou estas fontes"). O LLM **nunca inventa** uma notícia ou fonte — a integridade de citação é o ponto inteiro da feature. (Citações são sempre habilitadas no web search; os campos `title`/`url` não contam como tokens de input/output.)

**3. Curadoria de domínios.** Usa-se `allowed_domains` da tool pra restringir a um conjunto curado de fontes reputadas de futebol (BR + grandes internacionais), melhorando sinal e confiança nas citações. Começa curado, expande com o tempo.

**4. Custo: metered por busca, limitado por construção.** Web search é cobrado **por busca**, separado dos tokens — **$10 por 1.000 buscas** na Claude API (≈ $0,01/busca), confirmado na página de preços da Anthropic. O teto é trivial por construção: o fan-out é rate-limited em **20 runs/dia** (1 slot por run inteiro — `app/actions/predictions.ts:407`, `checkAnalysisRateLimit` do `analyzeBestBet`; limite `DEFAULT_USER_LIMIT = 20` em `lib/rate-limit.ts:28`) e o passo de notícias roda **uma vez por run** → **≤ ~20 buscas/dia** ⇒ ≈ $0,20/dia no pior caso. Cada busca conta como 1 uso independentemente do nº de resultados; erro de busca não é cobrado. (Dynamic filtering exige a code-execution tool habilitada — verificar na implementação.)

**5. Tier / gate.** Notícia é uma **categoria de DADO/provider nova**, NÃO um **mercado** de Tier 3 — não toca o gate de mercado Tier 3 (ADR 0025); é análoga ao provider dedicado de desfalques (ADR 0026). A síntese consome notícia como **contexto**; não habilita nenhum mercado liquidável novo. Logo, **não exige ADR de mercado novo** — esta ADR cobre a categoria de dado.

**6. Disponibilidade / cross-provider.** Web search é server tool da Claude, disponível na **API first-party da Anthropic** (que este app usa) — os resultados chegam na **mesma resposta**. Não está disponível no Amazon Bedrock; no Vertex AI só a busca básica. Como o app roda na API first-party, está coberto.

## Consequências

- **(+)** **Fontes reais citadas** constroem confiança — o usuário vê de onde veio o palpite e pode clicar. É o oposto do "LLM inventando notícia".
- **(+)** **Reaproveita o seam `predict.ts`/`AIProvider`** (ADR 0027) — zero provider externo novo, zero key nova, log em `ai_calls` de graça. Mesmo padrão de categoria-de-dado-dedicada do `AbsencesProvider`.
- **(−)** **Custo por busca** (metered, separado dos tokens) — mas **limitado por construção** a ≤ ~20/dia pelo cap de 20 runs/dia; teto ≈ $0,20/dia.
- **(−)** **Qualidade das notícias depende da curadoria de `allowed_domains`** — começa restrito (BR + grandes internacionais) e expande. Lista mal curada = sinal ruim.
- **(−)** **Só disponível onde a web search da Claude existe** (API first-party — ok pra este app; não no Bedrock, só básica no Vertex). Acopla a feature ao provider Anthropic.
- **(−)** **Persistência nova a construir:** capturar e guardar os `{title, url}` junto do conjunto de palpites e renderizá-los como citações clicáveis — esquema/UI novos.

## Alternativas consideradas

1. **API de notícias genérica** (NewsAPI/GNews) — **viável, rejeitado**: adiciona provider externo novo + key + integração própria, e ainda exigiria casar a notícia com a partida e formatar citação. A web search da Claude reaproveita o seam de LLM que já existe e devolve citações reais nativamente.
2. **Chamada de LLM "me conte as notícias" SEM fonte real** — **rejeitado de cara**: alucina notícia E fonte, destruindo a integridade de citação e a confiabilidade que motivam a feature. Inaceitável pelo "não inventar" do próprio cartucho de palpite (ADR 0031 §4 / CLAUDE.md "não pular validação").

## Referências

`lib/ai/predict.ts` (única porta da LLM, ADR 0027 — web search entra por aqui, logado em `ai_calls`), `:28` + `:250` (`getAbsencesProvider()` — padrão de categoria-de-dado dedicada a espelhar), `lib/ai/providers/types.ts` (`AIProvider`/`ToolDef` neutro, ADR 0027 #231); `lib/providers/absences/` (provider dedicado de desfalques, ADR 0026 — modelo de "categoria de dado, não mercado"; `fallback-provider.ts:42-44` gate `supportsAbsences`); `app/actions/predictions.ts:407` (`checkAnalysisRateLimit` do `analyzeBestBet`, 1 slot por RUN), `lib/rate-limit.ts:28` (`DEFAULT_USER_LIMIT = 20` → teto ~20 buscas/dia); cartucho de palpite `lib/ai/palpites/cartridges/cartridge.ts:163` ("Use SÓ os dados fornecidos. NÃO invente jogadores, lesões ou números." — alinhado ao "não inventar fonte"). Server tool da Claude: `web_search_20260209` (dynamic filtering, modelos atuais) / `web_search_20250305` (básica, antigos/Vertex) / `web_search_20260318` (mais recente, `response_inclusion`); resposta `web_search_tool_result` → lista de `web_search_result` (`title`/`url`/`page_age`/`encrypted_content`); parâmetro `allowed_domains` pra curadoria; preço **$10 / 1.000 buscas** (Anthropic, página de web search tool). ADR 0025 (gate Tier 3 — **de pé**: notícia é dado, não mercado), ADR 0026 (provider dedicado de desfalques — modelo desta ADR), ADR 0027 (seam `AIProvider` / `predict.ts` única porta), ADR 0031 (palpite embasado — consumidor das notícias). Issues de implementação: #377 (provider), #378 (UI/citações). CLAUDE.md ("nunca chamar API externa fora de `lib/providers/`", "não furar `predict.ts`", "não pular Zod no output da LLM", provider de IA novo exige ADR — esta é a ADR).
