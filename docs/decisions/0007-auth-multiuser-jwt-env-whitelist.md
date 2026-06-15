# ADR 0007 — Auth multi-user: JWT + whitelist por env

## Status
Accepted (2026-06) — **emenda o ADR 0004** (mecanismo de whitelist). **Emendado
pelo ADR 0023**: `role`/`allowed` passam a ser revalidados do DB no `jwt()` +
`maxAge` na sessão (some a staleness de role/allowed na sessão viva).

## Contexto

Implementação da issue #12. Até aqui o app rodava como um usuário fake
hardcoded (`DEV_USER_ID`, `lib/auth/dev-user.ts`): sem login, qualquer um com a
URL podia disparar análise (custo Anthropic), sync de fixtures e fetch de odds
(quota dos providers). O ADR 0004 já decidiu **Auth.js v5 + magic link via
Resend**; o que faltava era escolher estratégia de sessão, mecanismo concreto de
whitelist e como tratar os dados do dev user.

O ADR 0004 dizia "whitelist via tabela `users` (`users.allowed_emails`)". Na
prática essa coluna não existe (existe `users.allowed` boolean), e uma whitelist
em DB tem um problema de ovo-e-galinha com magic link: a row do usuário só
existe **depois** do primeiro login (o adapter cria no fluxo), então gatear por
DB exigiria pré-provisionar rows. Para o MVP isso é complexidade desnecessária.

## Decisão

1. **Whitelist via env `ALLOWED_EMAILS`** (lista separada por vírgula),
   verificada no callback `signIn` — que roda **antes** do envio do magic link
   (confirmado no source do `@auth/core`). E-mail fora da lista → `AccessDenied`
   → nenhum e-mail enviado, nenhum token criado (protege login **e** custo de
   envio). Isto **emenda o ADR 0004**: o gate autoritativo passa a ser o env, não
   uma tabela. `users.allowed` permanece intacto para uma futura whitelist em DB
   (follow-up).

2. **Sessão via JWT** (`session.strategy: "jwt"`), não DB sessions. O app é
   protegido por **middleware no edge**; JWT valida a sessão a partir do cookie
   sem ida ao DB no edge, evitando o atrito clássico do v5 (adapter no edge
   runtime). Usa-se o split-config: `auth.config.ts` (edge-safe, sem adapter) +
   `auth.ts` (Node, com DrizzleAdapter). `id`/`role` são expostos via callbacks
   `jwt`/`session`. As tabelas `sessions`/`accounts` são criadas para satisfazer
   o contrato do adapter (e futuro OAuth), mas ficam inativas sob JWT.
   Providers que exigem adapter (type `"email"`/`"webauthn"`, como o Resend) NÃO
   podem morar no `auth.config.ts` edge — ficam só no `auth.ts` junto do adapter.
   O `assertConfig` do @auth/core exige adapter pra qualquer provider de email em
   TODA invocação de `Auth()` (inclusive a leitura de sessão do middleware); sem
   ele dispara `MissingAdapter` e derruba toda rota protegida.

3. **Claim do dev user in-place** — em prod a row `DEV_USER_ID` é renomeada
   (mesmo UUID) pro e-mail/nome real via `db/scripts/claim-admin.ts`, rodado uma
   vez. No primeiro login o adapter faz `getUserByEmail` e reusa a row, então
   todo o histórico (Copa) continua válido e vira do admin — sem migrar tabelas
   filhas, sem órfãos. O script aborta se um login com `ADMIN_EMAIL` aconteceu
   antes do claim (colisão de unique).

## Razão

- **JWT**: menos atrito no edge, sem query no caminho quente do middleware. App
  pessoal aceita o trade-off de não ter revogação server-side instantânea (o JWT
  vale até expirar).
- **Whitelist por env**: cost-safe, zero schema, recusa pré-envio, trivial de
  editar. Suficiente pro critério de aceite do #12.
- **Claim in-place**: preserva o histórico sem DML arriscado nas filhas.

## Consequências

- (+) Middleware edge sem DB; setup simples; histórico preservado.
- (+) Whitelist recusa antes de gastar quota de e-mail.
- (−) Sem revogação instantânea de sessão (JWT). Aceitável na escala atual.
- (−) Mudar a whitelist exige editar env + redeploy (sem UI). Follow-up: página
  de convite + whitelist em DB.
- (−) `role` no JWT é lido no sign-in; mudança de role (ex.: após o claim) só
  reflete após novo login. Documentado no rollout.

## Follow-ups (deferidos do #12)

- Rate-limit por usuário/dia (Upstash Ratelimit via KV).
- Página de "convidar usuário" pro admin.
- Whitelist em tabela DB (substituindo/complementando o env).
