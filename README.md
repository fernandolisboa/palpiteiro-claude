# palpiteiro-claude

Web app que usa Claude como motor de seleção de edge multi-mercado em partidas de futebol: dada uma partida + mercados candidatos, emite **uma** recomendação por análise (mercado + seleção + linha + stake) ou `pass`, com tracking obsessivo de Yield **segmentado por mercado** e transparência total no racional da IA. Tier 1 (MVP) = 1X2 + over/under multi-linha; over/under 2.5 é o primeiro mercado.

## Setup de desenvolvimento

```bash
# 1. Clone e entre na pasta
git clone https://github.com/fernandolisboa/palpiteiro-claude
cd palpiteiro-claude

# 2. Copie as variáveis de ambiente
cp .env.example .env.local
# edite .env.local com seus valores reais

# 3. Instale as dependências
pnpm install

# 4. Suba o servidor de desenvolvimento
pnpm dev
```

Acesse [http://localhost:3000](http://localhost:3000).

## Comandos

| Comando | Descrição |
|---|---|
| `pnpm dev` | Servidor de desenvolvimento |
| `pnpm build` | Build de produção |
| `pnpm start` | Serve o build de produção localmente |
| `pnpm typecheck` | Verificação de tipos TypeScript |
| `pnpm lint` | ESLint |
| `pnpm test` | Testes (Vitest) |
| `pnpm db:generate` | Gera migrations a partir do schema |
| `pnpm db:migrate` | Aplica migrations pendentes |
| `pnpm db:studio` | Abre o Drizzle Studio (GUI do banco) |

## Migrations

Schema em `db/schema.ts`; migrations versionadas em `db/migrations/` (SQL gerado pelo Drizzle).

### Workflow local

1. Edite `db/schema.ts`.
2. `pnpm db:generate` — gera o SQL da diff em `db/migrations/`.
3. Commite o arquivo de migration junto com a mudança de schema.
4. `pnpm db:migrate` — aplica contra a `DATABASE_URL` do `.env.local` (sua Neon branch de dev).
5. Opcional: `pnpm db:studio` pra inspecionar o resultado.

### Workflow CI/CD

O `build` do Next está envelopado em `drizzle-kit migrate && next build`. Em cada deploy do Vercel:

- **Preview** (push em branch com PR): a integração Vercel-Neon dá ao PR uma Neon branch isolada e injeta `DATABASE_URL` apontando pra ela. As migrations pendentes são aplicadas só nessa branch — Production fica intocada.
- **Production** (merge em `main`): `DATABASE_URL` aponta pra Neon main; as migrations rodam ali. Se algo falhar, o build aborta e o release anterior continua servindo.

`drizzle-kit migrate` é idempotente: rastreia o que já foi aplicado em `drizzle.__drizzle_migrations`, então rebuilds não reaplicam nada.

### Migrations destrutivas (expand-contract)

Renomear ou remover colunas/tabelas quebra a janela em que o código antigo ainda roda contra schema novo (deploy não é atômico entre instâncias). Divida em dois PRs:

1. **PR 1 (expand)** — adiciona a estrutura nova (coluna nova nullable, tabela nova etc.) e atualiza o código pra escrever em **ambos** os lugares e ler do novo com fallback. Deploy → backfill → verificar que tudo lê do novo.
2. **PR 2 (contract)** — remove a estrutura antiga e o código de fallback.

Renomear coluna = adicionar a nova + copiar dados + parar de escrever na antiga + remover a antiga (cada passo num PR separado quando o volume justifica).

### Rollback em emergência

`drizzle-kit migrate` é forward-only — não existe "down" automático. Estratégias por gravidade:

- **Mudança aditiva (coluna ou tabela nova)** — revert do PR em `main`. O Vercel redeploya o código antigo; o schema fica com a estrutura a mais, sem uso, sem impacto. Limpa numa migration de manutenção depois.
- **Mudança destrutiva já em produção** — abrir PR novo com a migration reversa **explícita** (adiciona de volta o que foi removido) e mergear. Em paralelo, restaurar dados ausentes a partir do histórico point-in-time da Neon.
- **Pânico total (corrupção de dados)** — usar Neon branch restore pra criar uma branch a partir de timestamp anterior, promovê-la a main no console da Neon, e abrir PR de fix do código.

Por isso PRs com migrations destrutivas devem ser pequenos, isolados e sempre passar pelo expand-contract.

## Variáveis de ambiente

Veja `.env.example` para a lista completa. As principais para desenvolvimento local:

- `DATABASE_URL` — string de conexão Neon PostgreSQL
- `AUTH_SECRET` — segredo para assinar sessões (`openssl rand -base64 32`)
- `ANTHROPIC_API_KEY` — chave da API Anthropic
- `AUTH_RESEND_KEY` + `RESEND_FROM_EMAIL` — envio de magic links

## Deploy

O deploy é feito via integração nativa **Vercel + GitHub** — sem `vercel.json`, sem CLI.

1. Crie uma conta em [vercel.com](https://vercel.com) com login do GitHub
2. Clique em **Add New Project** e selecione este repositório
3. O Vercel detecta Next.js automaticamente — clique em **Deploy**
4. Configure as variáveis de ambiente (`.env.example` lista todas) no painel da Vercel em **Settings → Environment Variables**
5. Cada push para `main` dispara um novo deploy automático; PRs geram preview deployments

> **Auth.js v5:** instalado como `next-auth@5.0.0-beta.31` — ainda sem tag GA no npm, mas amplamente usado em produção. Será atualizado quando o GA for publicado.

## Stack

- **Next.js 15** (App Router, TypeScript strict)
- **PostgreSQL** via [Neon](https://neon.tech) + **Drizzle ORM**
- **Auth.js v5** com magic link via Resend
- **Anthropic SDK** (Claude Sonnet)
- **Tailwind CSS v4** + **shadcn/ui**
- **Vercel** (hosting, cron jobs, KV)

Documentação detalhada: [`docs/`](./docs/)

## Rate limiting

Os clientes HTTP de providers externos compartilham um conjunto de primitives
em [`lib/providers/http/`](./lib/providers/http/) que evitam burst e logam
consumo de quota. Cada provider (`api-football`, `odds-api`) instancia um
`createProviderClient` no topo do módulo.

**Estratégia em camadas** (de fora pra dentro):

1. **Concurrency limiter** (`concurrency.ts`) — semáforo FIFO, no máximo N
   requests em voo simultâneas por provider.
2. **Throttle sliding window** (`throttle.ts`) — no máximo M requests por
   janela de W ms; excedentes esperam até a janela liberar.
3. **Retry com backoff exponencial + jitter** (`retry.ts`) — 1s → 2s → 4s
   (±20%), até 3 tentativas, retry só em 429/5xx/erros de rede; respeita
   `Retry-After`.
4. **Quota logger** (`quota-logger.ts`) — extrai headers de quota,
   loga JSON estruturado por chamada e dispara `WARN` quando remaining < 20%
   do limite e `ERROR` quando < 5%. Cache hits **não** logam quota.

**Configs ativas:**

| Provider     | Concurrency | Throttle      | Justificativa |
|--------------|-------------|---------------|---------------|
| api-football | 2           | 8 req / 60s   | Free tier = 10 req/min + 100 req/dia. 20% abaixo do per-minute evita burst-detection (responsável pela suspensão da issue #23). |
| odds-api     | 2           | 15 req / 60s  | Free tier = 500 req/mês, sem per-minute strict. Throttle mais relaxado prioriza burning legítimo de quota mensal sem esperas artificiais. |

**Como ajustar:** editar o `createProviderClient({...})` no topo de
`lib/providers/sports-data/api-football/adapter.ts`,
`lib/providers/sports-data/football-data-org/adapter.ts` ou
`lib/providers/odds-api.ts`. Os primitives são puros e cobertos por testes
unitários em `lib/providers/http/__tests__/`.

**Validação manual:** `pnpm tsx scripts/test-rate-limit.ts` dispara 10
chamadas reais ao endpoint `/status` da API-Football (não consome quota
diária) e confirma que o throttle espaça as últimas duas em ~60s. Duração
esperada: ~62-75s. Se a conta estiver suspensa, o script aborta logo na
primeira chamada e os testes unitários permanecem cobrindo o comportamento.

## Sports Data Providers

Dados de jogos, classificação, escalações, lesões e H2H são acessados via uma
camada de abstração em [`lib/providers/sports-data/`](./lib/providers/sports-data/)
que expõe a interface `SportsDataProvider` agnóstica de fonte. Refs e times
são identificados por **nome canônico + liga** (não por IDs nativos de provider),
e fixtures por composite key `${league}:${kickoffAt}:${home}:${away}`.

### Adapters e capabilities

| Provider | supportsInjuries | supportsLineups | Ligas |
|---|---|---|---|
| `api-football` | ✓ | ✓ | Brasileirão A, Champions League |
| `football-data-org` | ✗ (free tier não expõe) | ✓ (em `/v4/matches/{id}`) | Brasileirão A, Champions League |

Cada adapter mantém um mapa estático `canonical-name → provider-native team-id`
em `lib/providers/sports-data/<adapter>/team-ids.ts`. O script
`scripts/generate-team-ids.ts --provider=<name>` gera/atualiza esses mapas
chamando `/v4/competitions/{code}/teams` (football-data-org) ou
`/teams?league=X&season=Y` (api-football). Custo: 2 chamadas reais por provider.
Lista canônica de times em `lib/providers/sports-data/canonical-teams.ts` — gerada
do primeiro provider executado (idempotente: re-runs verificam coverage sem
sobrescrever).

### Composição primary + fallback

Configurado via env (default: api-football primary, football-data-org fallback):

```
SPORTS_DATA_PRIMARY=api-football
SPORTS_DATA_FALLBACK=football-data-org
```

`getSportsDataProvider()` em [`lib/providers/sports-data/index.ts`](./lib/providers/sports-data/index.ts)
retorna um `FallbackProvider` que envolve os dois adapters. Cascade automático
quando o primário lança `SportsDataTransientError` (5xx pós-retry, 429 pós-retry,
timeout, network failure, schema drift, ou erro de envelope tipo "account
suspended"). Erros 4xx ≠ 429 (`SportsDataNotFoundError`) NÃO ativam fallback —
são erros de input. Quando ambos adapters lançam transient, o último erro
é propagado.

Quando primary === fallback, retorna o adapter desembrulhado (sem overhead do
FallbackProvider).

Logging de cascade: `console.warn` com JSON estruturado:

```json
{"event":"fallback_activated","method":"getStandings","primary":"api-football",
 "fallback":"football-data-org","cause":"SportsDataTransientError: 503...",
 "timestamp":"..."}
```

### Passo manual (pós-merge da issue #24)

1. Criar conta em https://www.football-data.org/client/register e obter token.
2. Adicionar em `.env.local`:
   ```
   FOOTBALL_DATA_ORG_API_KEY=<token>
   ```
3. Adicionar nas env vars do Vercel (**Production** e **Preview**).
4. Quando a conta da API-Football voltar:
   ```
   pnpm tsx scripts/generate-team-ids.ts --provider=api-football
   ```
   pra preencher `lib/providers/sports-data/api-football/team-ids.ts`
   (vazio neste PR por causa da suspensão). Verificar que
   `canonical-teams.test.ts` "API_FOOTBALL_TEAM_IDS coverage" passa após
   atualizar pra exigir 100% de cobertura (hoje só checa que tá vazio).

### Validação manual

`pnpm tsx scripts/test-providers.ts` exercita os 3 cenários (primary OK,
fallback ativado via mock, capabilities reportadas corretas). Máximo de 2
chamadas reais — abort em 429 ou quota.
