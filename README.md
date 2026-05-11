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
