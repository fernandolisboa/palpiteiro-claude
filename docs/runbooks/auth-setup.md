# Runbook — Setup de Auth (Auth.js v5 + Resend) e rollout

Operacional. Como configurar as envs de auth e fazer o primeiro deploy do
multi-user (issue #12, ADR 0007). Para o *porquê* das decisões, ver
[`docs/decisions/0007-auth-multiuser-jwt-env-whitelist.md`](../decisions/0007-auth-multiuser-jwt-env-whitelist.md).

## TL;DR da ordem

1. Gerar/coletar as envs (abaixo) → setar em **Vercel (Production + Preview)** e em **`.env.local`**.
2. Deploy (a migration `0003` aplica sozinha — o build é `drizzle-kit migrate && next build`).
3. Rodar **uma vez** `pnpm db:claim-admin` (contra o DB de **prod**).
4. **Só então** logar pela primeira vez com o `ADMIN_EMAIL`.
5. Sair e entrar de novo uma vez (pro JWT carregar `role: "admin"`).

> ⚠️ A ordem 3 → 4 importa: logar antes do claim cria uma row nova e o script
> aborta por colisão de e-mail (ver decisão (c) no ADR 0007). O script é
> idempotente e protege contra isso, mas o caminho feliz é claim-antes-do-login.

## Variáveis de ambiente

App lê em runtime (⇒ **Vercel Production + Preview** e `.env.local`):

| Var | O que é | Como obter |
| --- | --- | --- |
| `AUTH_SECRET` | segredo de assinatura do JWT | `openssl rand -base64 32`. O **nome** da env tem que ser `AUTH_SECRET` (não `BETTER_AUTH_SECRET` — `npx auth secret` pode resolver pra CLI errada; só o valor aproveita). |
| `AUTH_RESEND_KEY` | API key do Resend (envia o magic link) | resend.com → **API Keys** (https://resend.com/api-keys). **Não precisa de domínio.** |
| `RESEND_FROM_EMAIL` | remetente do e-mail | Solo/teste: `onboarding@resend.dev`. Amigos: `no-reply@seudominio.com` (exige domínio verificado). |
| `ALLOWED_EMAILS` | whitelist (lista por vírgula, case-insensitive) | Começa só com o seu e-mail. Gate no callback `signIn` — recusa **antes** do envio. |
| `AUTH_URL` | URL pública | **Deixar vazio na Vercel** (`trustHost` deriva de `VERCEL_URL`; Preview aponta pro próprio deploy). Local: `http://localhost:3000`. |

**NÃO** vão pra Vercel (só usados pelo script, uma vez):

| Var | Uso |
| --- | --- |
| `ADMIN_EMAIL` | e-mail real que reivindica a row do dev user. Ex.: `fernandoigorlisboa@pm.me`. |
| `ADMIN_NAME` | nome do admin. Ex.: `Fernando`. |

## Modo teste do Resend (sem domínio)

Sem domínio verificado, o Resend opera em **modo teste**:

- Remetente forçado a `onboarding@resend.dev`.
- Entrega **só pro e-mail da sua própria conta Resend**.

Implicação: pra login solo funcionar, o e-mail em `ALLOWED_EMAILS` (e o que você
digita no `/signin`) deve ser **o mesmo e-mail da conta Resend**. Magic link pra
amigos **não** funciona nesse modo.

> Subdomínios `*.vercel.app` (ex.: `palpiteiro-ai.vercel.app`) **não** podem ser
> verificados no Resend. Pra convidar amigos é preciso ter um domínio próprio —
> escopo das issues #52 / #53.

## O claim do dev user

Antes do #12 o app rodava como um usuário fake (`DEV_USER_ID`,
`admin@palpiteiro.local`). Todo o histórico (predições/ai_calls/outcomes da Copa)
aponta pra essa row. O script renomeia a row in-place (mesmo UUID) pro seu
e-mail/nome reais — no primeiro login o adapter reusa a row e o histórico vira
seu, sem migrar tabelas filhas.

Precisa do **`DATABASE_URL` de produção** no `.env.local` (pegue o connection
string da Neon no painel da Vercel/Neon). Então:

```bash
ADMIN_EMAIL=fernandoigorlisboa@pm.me ADMIN_NAME=Fernando pnpm db:claim-admin
```

- Idempotente: re-rodar depois de reivindicado é no-op.
- Aborta com mensagem clara se já existir uma row com `ADMIN_EMAIL` numa row
  diferente do placeholder (sintoma de login-antes-do-claim) — resolver o merge
  manualmente antes de re-rodar.
- DB novo (preview/sem dev user): nada a reivindicar; o primeiro login cria a row.

## Por que sair e entrar de novo depois do claim

O `role` é carimbado no JWT **no sign-in**. O claim muda `role` no DB, mas um
token já emitido continua `role: "user"` até expirar — e o gate de admin
(override de settlement, `/admin/*`) nega silenciosamente. Logout + login emite
um JWT novo com `role: "admin"`.

## Verificação rápida pós-deploy

- Acessar `/` sem sessão → redireciona pra `/signin`.
- Submeter e-mail **whitelisted** (= e-mail da conta Resend, em modo teste) →
  recebe magic link → loga → home mostra suas predições.
- Submeter e-mail **não-whitelisted** → sem e-mail + mensagem "não autorizado"
  em `/signin?error=AccessDenied`.
- Depois do claim + relogin: predições antigas da Copa aparecem como suas; a UI
  de override (`/admin/predictions/<id>`) abre só pra você (admin).

## Follow-ups (deferidos do #12)

- Rate limit por usuário/dia — #51
- Página de convidar usuário — #52
- Whitelist em tabela DB — #53
