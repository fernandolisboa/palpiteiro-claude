# ADR 0023 — Estratégia de auth: OAuth/passkey aceitos cedo, self-provision aberto, sessão revalidada do DB

**Data:** 2026-06-14  
**Status:** Aceito — **emenda os ADRs 0004, 0007 e 0009.**

Emendas registradas (cada ADR alvo tem a linha de Status atualizada in-place com `**emendado pelo ADR 0023**`):

- **0004** (magic link + senha rejeitada): aceita **OAuth antecipadamente** — não fica mais reservado pra uma "Fase 3" hipotética. **Senha CONTINUA rejeitada** (a alternativa "senha + e-mail tradicional" do 0004 segue descartada; o eixo que muda é OAuth/passkey, não senha).
- **0007** (role no JWT, lido só no sign-in): a `role` **e** a flag `allowed` passam a ser **revalidadas do DB** no callback `jwt()`; some a consequência "(−) `role` no JWT só reflete após novo login" (linhas 67-68 do 0007). Adiciona `maxAge` à sessão (piso de 7 dias) como defense-in-depth.
- **0009** (whitelist em DB com `users.allowed` + `pending_invites`, modelo invite-only): o **self-provision aberto** substitui o invite-only como porta padrão (o default de `users.allowed` vira `true` no #257, **não aqui**); o gate `allowed` deixa de ser só "whitelist de login" e passa a ser o **flag de acesso autoritativo** (ativo vs. bloqueado), reusado também como guarda de custo mid-session.

Nota de numeração: o ADR **0024** (cache/sem service worker) já existe; este preenche o **0023** que estava vago. Próximo número livre é **0025**.

## Contexto

A auth do app cresceu por emendas: 0004 escolheu Auth.js v5 + magic link via Resend (senha rejeitada por fricção); 0007 fixou sessão **JWT** (sem DB no edge) + whitelist por env; 0009 trouxe a whitelist pra DB (`users.allowed` + `pending_invites`) com env como floor; 0011 deu ao admin UI pra mutar `role`/`allowed`. O modelo resultante é **invite-only** e tem duas lacunas conhecidas, documentadas como trade-offs aceitos mas que agora pesam porque a porta vai abrir pra self-provision (#257):

1. **Staleness de `role`/`allowed` na sessão viva (#252 — "o bug da noiva").** O callback `jwt()` em `auth.config.ts:36-73` carimba `token.id`/`token.role` **só no primeiro login** (`if (user)`, linhas 37-41) e nunca relê o DB; o branch `trigger === "update"` (linhas 47-71) só aplica edição de nome/avatar via `unstable_update`, não role/allowed. `session()` (linhas 75-81) copia `token.role` → `session.user.role`. Logo, promover alguém a admin, rebaixar, ou bloquear **não chega** numa sessão ativa — exatamente a consequência já registrada no 0007 (linhas 67-68) e no 0013 (linhas 108-109), e a semântica que o 0011 §3 (linhas 48-58) descreve: revogar `allowed` "bloqueia LOGINS FUTUROS (não a sessão vigente)".

2. **Bloqueio não morde mid-session + rate-limit fail-OPEN (#264 — guarda de custo, load-bearing).** Como o bloqueio só vale no próximo login, um abusador com sessão viva continua disparando análises (cada uma é uma chamada paga ao Anthropic — gotcha de tokens do CLAUDE.md). E o teto diário por usuário (`lib/rate-limit.ts`) **falha aberto** quando o KV não está configurado: `getLimiters` (linhas 44-58) retorna `null` sem `KV_REST_API_URL`/`KV_REST_API_TOKEN`, e `checkAnalysisRateLimit` (linhas 93-104) devolve `{ ok: true, limit: Infinity }`. Justificado como conveniência de dev (comentário linhas 48-51), vira um buraco de custo assim que o signup abrir.

Abrir o self-provision (#257) sem fechar essas duas lacunas é arriscado: qualquer um que entre tem uma sessão que ignora bloqueio e um rate-limit que pode estar desligado. Este ADR registra a estratégia de auth pós-0011 e as decisões travadas desta leva (#252 + #264), além de registrar (sem implementar) o rumo de OAuth (#256, wave 3) e o flip pra self-provision aberto (#257).

**Restrição inegociável herdada (a #1 a respeitar):** `auth.config.ts` é o config **edge** que `middleware.ts:3` importa; `auth.ts` é o config **Node** (adapter + providers). O 0009 já moveu o `signIn` DB-aware pro `auth.ts` justamente porque ler DB no edge puxaria o cliente Neon pro bundle do middleware. Há um teste de regressão que **trava essa fronteira**: `__tests__/auth.config.test.ts:57-69` afirma que `auth.config.ts` NÃO define `signIn` e que seu source NÃO casa `/whitelist-db/` nem `/@\/lib\/db/`. Qualquer leitura de DB nova na auth tem que respeitar essa fronteira.

## Decisão

### 1. Modelo de estado: reusar `users.allowed`, SEM coluna nova, SEM migration

A flag de acesso é a coluna **já existente** `users.allowed` (`db/schema.ts:124`, `boolean().notNull().default(false)`). **Não** se adiciona coluna `blocked` nem nenhuma migration nesta leva. Semântica daqui pra frente:

- `allowed = true` → **ativo**, pode usar o app;
- `allowed = false` → **bloqueado / revogado / não-liberado** (os três colapsam num único estado).

Bloquear um abusador = `setUserAccess(id, false)`; desbloquear = `true`. O default permanece `false` nesta leva — ele só vira `true` mais tarde, no self-provision aberto (#257), **não aqui**.

**Por que reusar `allowed` em vez de uma coluna `blocked` dedicada:**

- **Colisão de migration com sessão paralela (motivo decisivo).** A sessão #175 é dona das migrations 0020/0021 em paralelo. `pnpm db:generate` numera a próxima migration sequencialmente; gerar uma aqui criaria um arquivo `00NN_*` que colide/conflita com o que o #175 está gerando. Reusar uma coluna que já existe **elimina** a necessidade de qualquer migration — zero risco de colisão.
- **A distinção pending-vs-blocked é operacionalmente irrelevante num side project solo.** Um modelo com coluna `blocked` separada distinguiria "nunca foi liberado" (pending) de "foi liberado e depois bloqueado" (blocked). Pra um operador único de F&F, ambos os estados levam à mesma ação ("não deixar usar") e à mesma UI (o toggle de acesso que o 0011 já construiu). A granularidade extra não paga o custo de schema + migration + uma fonte de verdade a mais pra raciocinar.
- **O caminho de escrita já existe** — esta leva só muda a *aplicação* (enforcement), não a *mutação*. `users.allowed` já é lida como gate de whitelist no login (`lib/db/queries/invites.ts:26-42`, `isEmailWhitelistedInDb`), já é mutada por `lib/db/queries/users.ts:190-195` (`updateUserAccess`), e já é exposta pela action de admin `app/actions/admin-users.ts:79-110` (`setUserAccess`, com guarda anti-auto-lockout nas linhas 102-105). A UI de bloquear/desbloquear do 0011 é exatamente a peça que o #264 precisa — não há nada novo a construir no write path.

### 2. #252 — `role` e `allowed` frescos na sessão viva (revalidar do DB no `jwt()`)

O callback `jwt()` passa a **reler `role` E `allowed` do DB** na renovação natural do token, de modo que uma mudança de role ou um bloqueio feito pelo admin tenha efeito **sem o usuário re-logar** — fechando o bug da noiva.

**Onde o `jwt()` DB-aware mora: em `auth.ts` (Node), NÃO em `auth.config.ts` (edge).** Define-se/sobrescreve-se `jwt` em `auth.ts` espalhando `...authConfig.callbacks` e sobrepondo a chave — **exatamente o padrão já usado pro `signIn`** em `auth.ts:51-56` (e explicado no comentário `auth.ts:46-50`: callbacks DB-aware vivem no Node, não no edge). Pôr um `jwt()` que lê DB em `auth.config.ts` violaria o teste de regressão `__tests__/auth.config.test.ts:57-69` (que proíbe `@/lib/db` no source edge) e vazaria Neon pro bundle do middleware. O `jwt()`/`authorized` do **edge** continuam **DB-free**: `authorized` segue só `!!auth?.user` (`auth.config.ts:32-34`) e o `jwt` edge segue carimbando/aplicando perfil sem ir ao DB.

**Estender o guard:** o `__tests__/auth.config.test.ts` deve ganhar um assert espelhando os existentes — que o `jwt` DB-aware **não** está no config edge / que o `jwt` edge permanece DB-free. É a prova barata e independente de build da fronteira.

**`maxAge` da sessão (defense-in-depth).** `session: { strategy: "jwt" }` está em `auth.config.ts:22` **sem `maxAge`** → cai no default do next-auth (~30 dias; `next-auth@5.0.0-beta.31`). Adiciona-se um piso modesto: `session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 }` (7 dias). Isso limita por quanto tempo um token pode estar stale entre renovações — é cinto-e-suspensório, não o mecanismo principal (o mecanismo é a releitura no `jwt()`). `unstable_update` já é exportado de `auth.ts:31` se um dia se quiser forçar reemissão imediata, mas a releitura na renovação natural é o caminho.

### 3. #264 — guarda de custo/abuso: checagem de acesso (env-floor OU `allowed`) no DB antes de `predict()` + rate-limit fail-CLOSED

A aplicação confiável do bloqueio **não** depende só do JWT (que pode estar stale até a próxima renovação). O enforcement de verdade é uma **leitura no DB** do acesso **dentro** da server action `analyzeMatch` (`app/actions/predictions.ts`, Node, `"use server"`), **antes** de chamar `predict()` (chamada em `predictions.ts:152-159`). Um usuário sem acesso recebe um erro claro em português e **nunca** alcança `predict()`.

**O gate tem que espelhar o short-circuit do floor do env — não pode ser um read cru de `allowed`.** O caminho de login (`isEmailAllowedWithDb`, `lib/auth/whitelist-db.ts:21-31`) autoriza por **env-floor OU `users.allowed=true`**, checando o env **primeiro** (`isEmailAllowed`, linha 25). Um admin do floor do env pode legitimamente ter `users.allowed=false` no DB (o default é `false` em `db/schema.ts:124`; `claim-admin.ts` só renomeia a row do dev-user, **não** seta `allowed`; e `promoteInvitedUserOnLogin` só dispara no evento `createUser`, i.e. primeiro login de usuário **recém-criado** — nunca pro admin pré-existente). Logo, um read cru `SELECT allowed WHERE id=?` retornaria `false` e **trancaria o operador do próprio app** — o exato auto-lockout que a §6 promete impossível e que o self-guard de `setUserAccess` (`admin-users.ts:102-105`) e o 0011 §3 protegem em outros lugares. **O gate autoriza se `isEmailAllowed(session.user.email)` (floor do env) OU `allowed=true` no DB** — a mesma composição do `isEmailAllowedWithDb`.

- O ponto de inserção é a zona de gates pré-`predict` que já existe: auth/session id (linhas 71-74), `userExists` (linhas 78-80, via `lib/db/queries/users.ts:49-56`), rate-limit (linhas 84-93). O novo gate entra ali, no mesmo padrão.
- O gate precisa do **e-mail** da sessão (já em `session.user.email`, custo zero) **e** do `allowed` do DB. A query do DB é uma nova `isUserAllowed(id)` modelada em `userExists` (`lib/db/queries/users.ts:49-56` é o template exato), **ou** reusa `getUserManagement` (`lib/db/queries/users.ts:148-162`, que já seleciona `allowed`); o resultado do DB é composto com o floor do env (`isEmailAllowed`) **antes** de decidir, espelhando `isEmailAllowedWithDb`. É um read barato vs. a chamada paga ao LLM. **Não** se usa um `isUserAllowed` que devolva o `allowed` cru direto como veredito — isso reintroduziria o lockout do env-floor.
- Isto é o que faz o bloqueio **morder mid-session** — fechando a lacuna que o 0011 §3 (linhas 48-58) e o comentário em `updateUserAccess` (`lib/db/queries/users.ts:185-189`) registram como "só bloqueia logins futuros".

**Rate-limit fail-CLOSED pra não-admin quando o KV está ausente.** Hoje `lib/rate-limit.ts` falha **aberto** sem KV (linhas 44-58 + 93-104). Esta leva inverte isso **só pra não-admin**: sem KV, um não-admin é capado/recusado (não tem barra livre); o **admin continua funcionando** (o operador não pode se trancar do próprio app). O carve-out de admin é uma branch que **já existe**: `role === "admin"` em `lib/rate-limit.ts:101` e `isAdmin` em `predictions.ts:99`. Em prod o KV está sempre presente, então o caminho normal não muda; o fail-closed cobre o cenário de KV mal-configurado depois que o signup abrir.

### 4. `allowDangerousEmailAccountLinking = true` (registro apenas — implementação no #256, wave 3)

Quando OAuth (Google) for adicionado (#256, **wave 3, NÃO aqui**), o provider recebe `allowDangerousEmailAccountLinking: true`, pra que um login OAuth com e-mail verificado **vincule à row `users` existente** (criada via magic link) em vez de criar um usuário duplicado. A tabela `accounts` já existe pra hospedar esse vínculo (`db/schema.ts:156+`, hoje inativa sob JWT — comentário do schema linhas 151-154 e 0007 linha 37). O risco do "Dangerous" (link por e-mail não-verificado) não se aplica: Google entrega e-mail verificado. Senha **não** entra (segue rejeitada pelo 0004).

### 5. CAVEAT edge/Node: por que a leitura de DB fica no Node mesmo o neon-http sendo edge-safe

Verificado: o cliente do projeto é **fetch-based e genuinamente edge-safe**. `lib/db/index.ts:1-2` usa `@neondatabase/serverless` (`neon()`) + `drizzle-orm/neon-http` (driver HTTP). O `node_modules/@neondatabase/serverless/index.mjs` (1374 linhas) tem **zero** imports de built-ins do Node (`crypto`/`net`/`tls`/`fs`/`stream` — grep não retornou nada); o caminho `Pool`/WebSocket que precisaria de `ws` **não** é importado pelo `neon-http`. Ou seja, ler DB dentro do `jwt()` *funcionaria* se rodasse no edge.

**Mesmo assim, a leitura de DB fica no Node (`auth.ts`), por três razões:**

(a) o teste de regressão `__tests__/auth.config.test.ts:57-69` **proíbe** `@/lib/db`/`whitelist-db` no source de `auth.config.ts` — manter a fronteira é o contrato vigente;  
(b) o caminho do middleware deve ficar **barato** (`authorized: () => !!auth?.user`, `auth.config.ts:32-34` — sem DB no caminho quente de cada navegação);  
(c) casa com o split edge/Node já estabelecido no 0009 §3.

**Prova:** `pnpm build` (= `drizzle-kit migrate && next build`, `package.json:7`) **falha** se um import Node-only vazar pro middleware edge — somado ao guard estendido de `auth.config.test.ts`, é a prova de que a fronteira não quebrou.

### 6. Caveat de semântica: `allowed=false` NÃO morde o floor do env (intencional)

`lib/auth/whitelist-db.ts:21-31` (`isEmailAllowedWithDb`) checa o env `ALLOWED_EMAILS` **primeiro** (short-circuit via `isEmailAllowed`, `lib/auth/whitelist.ts:24-30`): um e-mail no floor do env é permitido **mesmo com `allowed=false`** no DB. Por isso o gate do #264 (§3) **tem** que replicar esse short-circuit: ele autoriza se o e-mail está no floor do env **OU** se `allowed=true` no DB — exatamente a composição de `isEmailAllowedWithDb`. Um gate que lesse `allowed` cru (sem o ramo do env) **trancaria** um admin do floor do env cuja row tem `allowed=false` (cenário real — ver §3), violando este invariante. Contas do floor do env (o operador/admin) são **intencionalmente nunca auto-bloqueáveis**, e o mecanismo que garante isso é **o próprio short-circuit do env dentro do gate**, não uma suposição de que o abusador seja não-env. Consistente com o self-guard de `setUserAccess` (`app/actions/admin-users.ts:102-105`) e com o 0011 §3: o env é a rede de segurança que garante que o dono nunca se tranca.

## Razão

- **Reusar `allowed` (sem migration):** evita a colisão com as migrations 0020/0021 do #175 e não paga schema novo por uma distinção (pending vs. blocked) sem valor operacional num app solo. O write path já está construído (0011); só falta enforcement.
- **Releitura no `jwt()` (Node):** é o único lugar que torna role/bloqueio frescos sem re-login, mantendo o edge DB-free — reusa literalmente o move que o 0009 fez pro `signIn`.
- **Leitura direta antes de `predict()`:** o JWT pode estar stale até a renovação; o gate síncrono no Node antes da chamada paga é a barreira confiável de custo. Espelha os gates pré-`predict` já existentes (`userExists`, rate-limit).
- **Rate-limit fail-closed pra não-admin:** uma vez aberto o signup, falhar aberto é um buraco de custo direto; o carve-out de admin já é uma branch existente, então o custo da mudança é mínimo.
- **OAuth aceito cedo / senha ainda não:** o atrito de senha (hash, recovery, responsabilidade) que o 0004 rejeitou continua não valendo a pena; OAuth/passkey não tem esse atrito e a tabela `accounts` já está pronta — antecipá-lo é barato e melhora a porta de entrada do self-provision.

## Alternativas consideradas

| Opção | Descarte |
|---|---|
| Coluna `blocked` dedicada (+ migration) | Colide com as migrations 0020/0021 da sessão paralela #175; e a distinção pending-vs-blocked é operacionalmente irrelevante num app solo (ambos → "não deixa usar", mesma UI). Reusar `users.allowed` é zero-migration. |
| Confiar só no JWT pra bloquear (sem leitura direta em `analyzeMatch`) | O JWT fica stale até a renovação natural; um abusador com sessão viva seguiria gastando chamadas pagas no intervalo. O #264 exige o gate síncrono no Node antes de `predict()`. |
| Ler DB no `jwt()` rodando no **edge** (neon-http é edge-safe) | Quebra o guard `auth.config.test.ts` (proíbe `@/lib/db` no edge), encarece o caminho quente do middleware (DB a cada navegação) e contraria o split do 0009. A leitura fica no Node (`auth.ts`). |
| Revogação server-side instantânea de sessão (DB sessions) | Abandonar JWT reintroduz o atrito de adapter no edge que o 0007 evitou. A releitura no `jwt()` + `maxAge` de 7 dias + o gate direto em `analyzeMatch` cobrem o caso de uso (bloqueio efetivo) sem trocar a estratégia de sessão. |
| Manter rate-limit fail-open | Vira buraco de custo assim que o self-provision abre (#257). Fail-closed pra não-admin com carve-out de admin fecha isso com uma branch que já existe. |
| Adicionar OAuth nesta leva | Fora de escopo — #256 é wave 3. Aqui só se **registra** `allowDangerousEmailAccountLinking: true` e a intenção, pra não re-derivar contexto depois. |
| Adicionar senha | Rejeitada de novo (como no 0004): fricção e responsabilidade (hash/recovery) que não pagam num app de F&F; magic link + OAuth cobrem o login. |

## Consequências

- **(+)** `role`/`allowed` ficam frescos na sessão viva: promover/rebaixar/bloquear tem efeito sem re-login (fecha o bug da noiva, #252).
- **(+)** Bloqueio **morde mid-session**: a leitura direta antes de `predict()` impede um abusador de gastar chamadas pagas com sessão viva (#264).
- **(+)** Rate-limit deixa de ser buraco de custo pós-signup: fail-closed pra não-admin sem KV, admin nunca trancado.
- **(+)** Zero migration → zero colisão com as migrations da sessão paralela #175; nenhuma fronteira de schema nova.
- **(+)** OAuth/passkey desbloqueado conceitualmente (porta pra self-provision aberto, #257) sem reabrir senha; `accounts` já hospeda o vínculo.
- **(−)** Custo de uma leitura extra de DB no caminho de `analyzeMatch` (um `select` barato vs. uma chamada paga ao LLM — trade-off largamente positivo) e na renovação do `jwt()` (no Node, login/refresh infrequente — aceitável, mesmo raciocínio do 0009 sobre cold start de login).
- **(−)** `allowed=false` segue **não** morde e-mails do floor do env (intencional: o operador nunca se auto-bloqueia) — documentado, consistente com 0011 §3.
- **(−)** `maxAge` de 7 dias força re-login mais cedo que os ~30 dias default — fricção mínima aceita como defense-in-depth.
- **(−)** O guard de fronteira (`auth.config.test.ts`) precisa ser estendido pro `jwt` junto desta leva, senão um refactor futuro poderia reintroduzir DB-no-edge sem o teste pegar.
- **Ponto de revisão (#257):** o flip do default de `users.allowed` pra `true` (self-provision aberto) acontece lá, não aqui — reabrir a decisão de cost-safety naquele momento (com o signup público, o floor do env e os gates desta leva são o que segura o custo).

## Referências

- **Emenda os ADRs 0004** (OAuth aceito cedo; senha segue rejeitada), **0007** (role/allowed revalidados do DB + `maxAge`) e **0009** (self-provision aberto substitui invite-only; `allowed` vira flag de acesso autoritativo). As linhas de Status desses três são atualizadas in-place com `**emendado pelo ADR 0023**`.
- ADR 0011 (UI de mutação de `role`/`allowed` + self-guards anti-lockout — o write path que o #264 reusa; a semântica "bloqueio = só logins futuros" que o #264 estreita).
- ADR 0013 (audience gating + a mesma consequência "role no JWT stale até re-login", linha 108-109).
- ADR 0024 (cache/sem service worker) — já existe; este ADR preenche o 0023 que estava vago.
- Issues: **#252** (role+allowed frescos no `jwt`), **#264** (guarda de custo/abuso), **#257** (self-provision aberto — flip do default, fora desta leva), **#256** (OAuth, wave 3 — só `allowDangerousEmailAccountLinking` registrado), **#175** (sessão paralela, dona das migrations 0020/0021 — por isso **nenhuma** migration aqui).
- Arquivos tocados nesta leva (grounding, não escopo deste ADR): `auth.config.ts` (add `maxAge`; `jwt` edge segue DB-free), `auth.ts` (define `jwt` DB-aware via override de callback, espelhando `signIn`), `app/actions/predictions.ts` (leitura direta de `allowed` antes de `predict()`), `lib/rate-limit.ts` (fail-closed pra não-admin sem KV), `lib/db/queries/users.ts` (nova `isUserAllowed` ou reuso de `getUserManagement`), `__tests__/auth.config.test.ts` (estende o guard DB-in-edge pro `jwt`). **Sem mudança em `db/schema.ts`, sem migration.**
