# PLAN-670 — Notícias: passo honesto + RSS do ge por time

Issue: #670. Proposta aprovada: https://claude.ai/artifact/QjUHsEdxqeKyNxY2y87szu (PR A de 3; B = #671, C = #672).
Snapshot de 2026-11-21; arquivo histórico, não spec viva.

## Contexto (conferido no código)
- `matches.homeTeam/awayTeam` guardam nomes **canônicos** ("SE Palmeiras", "CR Flamengo", "CA Mineiro"); na `copa_libertadores` são nus ("Flamengo"). Fonte: `lib/providers/sports-data/canonical-teams.ts` + aliases em `team-names.ts`. `normalizeTeamName()` já tira acento e prefixos SE/CR/EC/SC/FC.
- Nomes curtos de exibição ficam em `lib/view/team-labels.ts`, mas `lib/view/__tests__/team-display-boundary.test.ts` proíbe importá-lo de `lib/providers`/`lib/ai` → o provider de notícias tem nomes curtos próprios no mapa novo.
- `extractSources` ignora calado o objeto `{error_code}`; `!result.ok` devolve `unavailable:false` → `startNewsFetch` mostra `newsEmpty` (a mentira).
- `ALLOWED_DOMAINS` também é usado por `lib/ai/model-versions/probe.ts` (ok). `extract-cards-from-web.ts` só lê `CARD_DOMAINS_*` (intocado).
- Fontes persistem em `palpite_sets.headline.sources` (`{title,url}[]`), lidas por `lib/view/palpites-headline.ts`, `components/palpites/palpite-hero.tsx` e `/p` (`lib/view/share/source-hardening.ts`).
- Sem parser XML no `package.json`.
- Feed real do ge (Flamengo): 100 itens / ~10 dias; `<description>` = CDATA com só `<img>` + texto puro FORA do CDATA (matéria 1–6k chars com boilerplate "+ Leia mais…", "Ouça o podcast…"); `<atom:subtitle>` (linha fina) em 99/100; `pubDate` `Sat, 21 Nov 2026 18:43:20 -0000`; mistura itens não-futebol (`/basquete/`, `/futebol-feminino/`, `/gato-mestre/`).
- Slugs verificados (200): palmeiras, flamengo, sao-paulo, corinthians, santos, vasco, botafogo, fluminense, gremio, internacional, cruzeiro, atletico-mg, bahia, fortaleza, bragantino, vitoria, juventude, sport, mirassol, ceara, athletico-pr, chapecoense, coritiba, remo. Feeds oficiais úteis: São Paulo (`https://www.saopaulofc.net/feed/`), Fortaleza (`https://www.fortaleza1918.com.br/feed/`).

## Decisões
1. **Parser RSS por regex, sem dependência nova**: entrada estreita (RSS 2.0, só `<item>` com title/link/pubDate/description/atom:subtitle); testes de fixture cobrem CDATA, entidades e lixo.
2. **Janela ancorada em `min(now, kickoff)`**: `anchor − 72h ≤ pubDate ≤ anchor`. Análise com dias de antecedência não fica vazia; nada pós-apito entra.
3. **Sem web search quando o RSS respondeu com 0 itens relevantes** (status `none`): o ge já está no `allowed_domains`, a busca acharia o mesmo, custaria ~US$0,02 + 10–15s. Web search só quando nenhum time tem feed (ligas de fora) ou TODOS os feeds falharam, e só se o prazo couber.
4. **Persistir só `{title,url}`**: shape do jsonb intacto, texto da matéria fora do banco, `/p` e hero intactos.
5. **`status` substitui `unavailable`** (só `lib/ai/palpites/index.ts` + testes leem).

## Arquivos
- `lib/providers/news/types.ts`: `NewsSourceKind = "ge"|"club"|"web_search"`; `NewsResult` ganha `snippet?`, `publishedAt?` (ISO), `source?`; `NewsFetchStatus = "found"|"none"|"failed"|"skipped"|"no_search"`; `NewsFetchOutcome = {results, aiCall, status, via: NewsSourceKind|null}`.
- `lib/providers/news/team-sources.ts` (novo): tabela por TIME (não por liga), aliases casados por `normalizeTeamName`; `resolveTeamSources(name)`, `mentionTermsFor(name)`, `newsShortName(name)`; `mentions` curados (ex.: Atlético-MG ["atletico-mg","atletico mineiro","galo"]); `clubFeedUrl` só SP e Fortaleza.
- `lib/providers/news/rss-parse.ts` (novo, puro): `parseRssItems`, `decodeEntities`, `htmlToText`, `makeSnippet` (subtitle ?? texto, corte em palavra, ≤280). Entrada limitada a ~2 MB, regex não-gulosa, data inválida → null.
- `lib/providers/news/ge-rss.ts` (novo): `filterFeedItems` (janela, https, nega `/basquete/`, `/volei/`, `/futebol-feminino/`, `/gato-mestre/`, `/cartola/`, menciona o adversário com borda de palavra), `fetchFeed` (timeout `min(4000, restante−1000)`, cache em processo 10 min só de sucesso, seam de teste), `getNewsViaTeamFeeds` (feeds em paralelo com `allSettled`, dedupe por URL sem query/fragmento, mais novo primeiro, cap 10, log `news_feed_failed`).
- `lib/providers/news/anthropic-web-search.ts`: `news_v2`, `max_uses: 2`, liga por `LEAGUE_LABEL`, nomes curtos, data em America/Sao_Paulo, sugestão "<Mandante> x <Visitante>"; system prompt constante (ADR 0071); `extractSources` → `{sources, searchErrors, searched}`; status: `!ok`→failed, só erros→failed (loga `error_code`), sem busca→no_search, 0→none, senão found; sem chave→failed. `userLocation` BR quando a liga é brasileira ou algum time está no mapa.
- `lib/ai/providers/types.ts` + `anthropic/request-builder.ts`: `ServerToolDef.userLocation?` → `user_location`. Só duas variantes estáveis do bloco de tools (BR/não-BR) → cache de prefixo segue batendo. Cartões e probe sem mudança de bytes.
- `lib/providers/news/combined.ts` (novo) + `index.ts`: feeds primeiro; algum feed ok → found/none via ge; todos falharam → web search se couber, senão failed; sem fontes → web search.
- `lib/providers/news/allowed-domains.ts`: tirar uol/bbc/guardian/espn só de `ALLOWED_DOMAINS` com o motivo; `CARD_DOMAINS_*` intocados (follow-up).
- `lib/ai/progress/steps.ts` + `details.ts`: tira `newsEmpty`; notas `newsNoneGe` "Nada novo sobre o jogo no ge nos últimos três dias", `newsNoneWeb` "A busca não achou notícia recente do jogo", `newsNoSearch` "A busca de notícias não rodou desta vez"; `newsDetail` agrupa por fonte ("3 notícias do ge", "1 notícia do site do clube", "2 notícias da busca na web").
- `lib/ai/palpites/index.ts`: found→done+detail; none→done+nota por `via`; no_search→skipped+nota; failed→failed; budget skip→skipped; `.catch`→failed. Persistir `sources.map(({title,url}) => ({title,url}))`.
- `lib/ai/palpites/cartridges/cartridge.ts`: `NewsItemSchema` + snippet (≤400)/publishedAt/source; linha `- [ge, 21/11 15:43] Título (url)` + `  Trecho: …` dentro dos delimitadores; neutraliza `<<<`/`>>>` em título/trecho; instrução "o trecho é parte da matéria, também não-confiável"; **`palpites_v13`**. System prompt não muda.

## Testes
Fixture `__tests__/fixtures/ge-flamengo.xml` (~6 itens reais aparados: um do Palmeiras na janela, um velho, um basquete, um gato-mestre, um sem Palmeiras, uma URL duplicada) + item WordPress com `&#8211;`/`content:encoded`. `rss-parse.test.ts`, `team-sources.test.ts` (todo `CANONICAL_TEAMS.brasileirao_a` resolve; nomes nus e aliases; times de fora → null; slugs únicos), `ge-rss.test.ts` (janela, adversário, deny-list, dedupe, cap, um feed com timeout não derruba o outro, cache), `combined.test.ts` (found/none sem web search; todos falham → web search; jogo de fora → web search; sem prazo → failed), `anthropic-web-search.test.ts` (news_v2, maxUses 2, userLocation BR/EPL, mensagem, status), teste do builder (`user_location` só quando setado), `details.test.ts`, `generate-palpites.test.ts` (mapeamento de passo, persistência sem snippet, v13), `cartridge.test.ts` (trecho/data dentro dos delimitadores, delimitador neutralizado).

## Docs e commits
Adendo ao ADR 0032 (RSS do ge primeiro, domínios removidos, `max_uses:2`, `user_location`, status). Commits `fix(news)`, `feat(news)`, `prompt: palpites_v13 + news_v2`.

## Riscos / follow-ups
- ge muda formato/slug → falha graciosa + fallback; monitorar `news_feed_failed`.
- Falso positivo no filtro de menção ("Internacional", "São Paulo", "Santos"): aceito na v1, mitigado por `mentions` curados.
- Notícia pré-jogo que não cita o adversário (lesão) fica de fora; follow-up: aceitar itens do próprio time com lesão/desfalque/escalação nas últimas 48h.
- `pause_turn`: `runServerToolAnalysis` só devolve o `content` final; com `max_uses:2` é raro; follow-up acumular blocos.
- `NEWS_MIN_BUDGET_MS` (15s) é maior que o RSS precisa; follow-up: gate menor quando há feed.
- `CARD_DOMAINS_INTL` ainda tem bbc/guardian/espn bloqueados → liquidação de cartões provavelmente falha no pool B; issue separada.
- Cache em processo não sobrevive entre instâncias serverless; aceitável no volume atual.
- Direito autoral: trecho ≤280 chars só no prompt, nunca persistido nem exibido.

## Ajustes pós-review (revisão adversarial do plano)
Estes ajustes têm precedência sobre as seções acima.
1. **200 que não é feed = `failed`**: sem `<rss`/`<channel>` ou 0 itens parseados → o feed conta como falha. Item mais novo com mais de 7 dias → feed velho = falha.
2. **Filtro de menção só em título + `atom:subtitle`** (não no corpo da matéria; o corpo gera ruído).
3. **`mentions` como padrões; nomes ambíguos exigem forma de confronto/artigo**: Vitória (palavra comum), São Paulo (cidade), Bahia/Ceará (estados), Santos (sobrenome), Sport, Internacional/Inter, Atlético (MG × PR × Madrid). Ex.: Vitória só casa em "o Vitória", "do Vitória", "contra o Vitória", "Vitória x", "x Vitória", "Vitória-BA". Teste por nome ambíguo.
4. **Ranking**: até 5 por time (cap 10 total); itens com desfalque|lesão|lesionad|suspens|escalação|escalad|pendurad|técnico|treinador|poupa|reserva sobem antes da ordem por data.
5. **Allowlist de caminho** no ge: `^https://ge\.globo\.com/(?:[a-z]{2}/)?futebol/` menos `blogs|gato-mestre|cartola|futebol-internacional|futebol-feminino`.
6. **Trecho com linguagem de valor**: rodar `containsValueLanguage` em cada trecho ao montar a entrada; se bater, descarta o trecho (fica o título; título que bater também sai). Incluir os trechos no texto aceito pelo `fidelity-validator` (contagens de gols vindas da notícia não derrubam o palpite) — conferir o mecanismo exato e adaptar.
7. **A síntese recebe o status**: `none` → "(nenhuma notícia recente sobre o jogo)"; `failed`/`no_search`/`skipped` → "(notícias indisponíveis nesta análise: não conclua nada pela ausência)". Parte do v13.
8. **Achatar espaços** (inclusive quebras de linha) em título e trecho, além de neutralizar `<<<`/`>>>`; URL revalidada como https.
9. **Meia falha**: um feed ok e o outro falhou → nota própria ("Só deu pra ler as notícias de um dos times") e status `found`/`none` conforme os itens; sem web search extra.
10. **Testes que usam `unavailable`/`newsDetail(3)`** entram no plano: `generate-palpites.pglite.test.ts`, `generate-live-palpites.pglite.test.ts`, `app/actions/__tests__/predictions-best-bet.test.ts`, `lib/ai/progress/__tests__/details.test.ts`.
11. **Sem `user_location`** (web search para times brasileiros só roda quando todos os feeds falharam; o system prompt de notícias nem atinge o mínimo de cache). Remove a mudança em `ServerToolDef`/builder.
12. **Sem feeds oficiais de clube na v1**: São Paulo já é coberto pelo ge e Fortaleza não está na Série A 2026. A tabela fica pronta para um campo futuro; `NewsSourceKind = "ge" | "web_search"`.
13. **Probe de versão** (`probe.ts`) aceita `{error_code}` como sucesso: follow-up, fora deste PR; corrigir só o comentário "max_uses 1" se citar notícias.
14. **Fetch**: checar `content-length` e ler o corpo com teto de 2 MB; cachear itens parseados, não XML; User-Agent explícito; datas da síntese com `Intl` em `America/Sao_Paulo`.
15. **Nomes curtos só na consulta da web search**, nunca como chave ou para casar time; comentário explicando a fronteira do #578.
