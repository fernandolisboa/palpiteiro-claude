# palpiteiro-claude

Web app que usa Claude para gerar recomendações de aposta em over/under 2.5 gols em partidas de futebol, com tracking obsessivo de Yield e transparência total no racional da IA.

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
