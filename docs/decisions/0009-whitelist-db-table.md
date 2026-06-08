# ADR 0009 — Whitelist em tabela DB (modelo de duas fontes)

## Status
Accepted (2026-06) — **emenda o ADR 0007** (mecanismo de whitelist).

## Contexto

Implementação da issue #53. O ADR 0007 colocou a whitelist no env
`ALLOWED_EMAILS`, checada no callback `signIn` (que roda ANTES do envio do magic
link → cost-safe). O problema: mudar quem pode logar exige editar env +
redeploy, sem UI. Isto trava o #52 (página de convite do admin), que precisa
adicionar/remover e-mails sem deploy.

O ADR 0007 já registrou o problema de ovo-e-galinha: o `DrizzleAdapter` só cria
a row em `users` no PRIMEIRO login bem-sucedido, então `users.allowed` sozinho
não autoriza convidados que ainda não logaram. Daí o modelo de duas fontes
abaixo (escolhido pelo maintainer — não re-litigar o schema aqui).

## Decisão

1. **Whitelist de duas fontes + env como floor.** `allowed(email)` é true se
   QUALQUER uma:
   - `email ∈ env ALLOWED_EMAILS` (floor PERMANENTE — admin nunca trava,
     sobrevive a tabela vazia; checado PRIMEIRO, short-circuit que PULA o DB);
   - existe row em `users` com `allowed=true` (usuários que JÁ existem — a coluna
     `users.allowed`, dormente desde o 0007, fica ATIVA);
   - existe row em `pending_invites` (convidados que ainda NÃO logaram).

   Nova tabela `pending_invites`: `email text PRIMARY KEY` (trimmed+lowercased na
   query layer), `invited_by_user_id uuid references users.id onDelete set null`
   (nullable — o convite sobrevive ao delete do inviter), `note text` (livre, pra
   UI do #52), `created_at timestamptz notNull defaultNow`. Migration `0005`
   gerada via `pnpm db:generate` (aditiva/segura: tabela nova + FK nullable, sem
   backfill); NUNCA `db push`.

2. **Erro de leitura do DB → cai pro resultado env-only.** Uma indisponibilidade
   do Neon degrada pra env-only (admin/env continua funcionando, estranhos
   recusados = cost-safe) em vez de falhar aberto ou trancar todo mundo. O
   short-circuit do env + esse fallback são a garantia de cost-safety.

3. **`signIn` DB-aware mora no `auth.ts` (Node), não no `auth.config.ts`
   (edge).** O `auth.config.ts` é o split-config edge-safe que o `middleware.ts`
   importa — ele NÃO pode importar código de DB (puxaria o cliente Neon pro
   bundle do edge e quebraria o `assertConfig`/edge runtime → toda rota protegida
   viraria loop pro /signin). Removemos o `signIn` (e o import `isEmailAllowed`)
   do edge config; adicionamos `callbacks: { ...authConfig.callbacks, signIn }`
   no `auth.ts`. O middleware só usa `authorized`/`jwt`/`session`, então isto é
   seguro. `lib/auth/whitelist.ts` fica INTACTO (env-only, edge-safe); a checagem
   composta vive no novo `lib/auth/whitelist-db.ts` (Node-only).

   A preocupação do issue com "cache pro edge" é IRRELEVANTE: o `signIn` roda no
   fluxo Node do route-handler (não no edge), e login é infrequente — um cold
   start do Neon (~1s) num login é aceitável. NENHUM cache é adicionado.

4. **Promoção no primeiro login via `events.createUser`.** Dispara uma vez no
   primeiro login, DEPOIS do `signIn` ter autorizado o usuário. Para o usuário
   recém-criado: marca `users.allowed=true` E apaga a row em `pending_invites`,
   num único `db.batch` atômico. SEM isto, o cenário de lockout: o convidado loga
   uma vez (autorizado via `pending_invites`), mas se a gente só apagasse o
   convite (ou nunca setasse `allowed`), no PRÓXIMO login não haveria row em
   `pending_invites`, `allowed` seria `false`, e talvez ele não esteja no env →
   AccessDenied. Promover (allowed=true + delete) mantém o invariante:
   `pending_invites` só guarda convidados que ainda não logaram; quem retorna é
   autorizado via `users.allowed=true`.

5. **`db.batch`, não `db.transaction()`.** O driver neon-http NÃO suporta
   transações — `db.transaction()` LANÇA `"No transactions support in neon-http
   driver"` em runtime (confirmado em `node_modules`). `db.batch([update,
   delete])` roda o array num único round-trip transacional e é o primitivo
   atômico correto aqui.

6. **Seed de transição** (`db/scripts/seed-invites.ts`, idempotente, espelha
   `claim-admin.ts`): lê `ALLOWED_EMAILS` e por e-mail — se já existe row em
   `users` → `allowed=true`; senão → upsert em `pending_invites`
   (`onConflictDoNothing`). Migra a lista atual do env pro DB no dia 1 sem
   redeploy. Uso: `ALLOWED_EMAILS=a@x.com,b@y.com pnpm db:seed-invites`.

7. **Invariante cost-safe preservado.** A decisão acontece DENTRO do `signIn`,
   que o `@auth/core` roda ANTES de enviar o magic link → e-mail não autorizado =
   AccessDenied = nenhum e-mail/token. A checagem NÃO foi movida pra downstream.

Normalização (trim+lowercase) em TODA fronteira (whitelist-db, queries de
invites, seed): o e-mail é a PK de `pending_invites`, então uma divergência de
caixa/espaço silenciosamente inverteria a decisão e criaria rows que nunca casam.

## Razão

- **Duas fontes + env floor**: cobre tanto quem já existe (`users.allowed`)
  quanto quem nunca logou (`pending_invites`), com o env como rede de segurança
  que sobrevive a tabela vazia e nunca tranca o admin.
- **signIn no Node**: a checagem agora lê o DB; o edge config tem que ficar
  DB-free pra o middleware não quebrar.
- **Promoção no createUser**: a peça que evita lockout do convidado retornante.
- **db.batch**: o único primitivo atômico disponível no neon-http.

## Consequências

- (+) Whitelist gerenciável sem redeploy → desbloqueia o #52.
- (+) Cost-safe preservado (decisão pré-envio do magic link); degrada pra
  env-only num outage do Neon, sem falhar aberto.
- (+) `lib/db/queries/invites.ts` (add/remove + checagem) já no shape que a UI do
  #52 reusa.
- (−) Login agora pode bater no DB (env-miss): um cold start do Neon (~1s)
  ocasional. Aceitável (login infrequente); sem cache.
- (−) Mais uma fonte de verdade pra raciocinar; mitigado pelo invariante de que
  `pending_invites` só guarda quem ainda não logou (garantido pela promoção).

## Referências

- Emenda o ADR 0007 (fecha o follow-up "whitelist em tabela DB").
- Issues: #12 (auth multi-user), #52 (UI de convite — reusa as queries), #53
  (esta).
