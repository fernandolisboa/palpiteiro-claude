# ADR 0011 — Admin pode mutar role e acesso de usuários

## Status

Accepted (2026-06)

## Contexto

Implementação da issue #88. O #59 / ADR 0010 trouxe a área `app/admin/users/` —
mas SÓ leitura: o admin busca usuários e audita o tracking de qualquer um, sem
poder editar nada. `lib/db/queries/users.ts` é inteiramente read-only.

Falta ao admin solo o poder operacional de: (a) promover/rebaixar role
(`user` ↔ `admin`; só essas duas em `userRoleEnum`) e (b) revogar/conceder
acesso (`users.allowed`, a whitelist em DB do ADR 0009). Hoje isso só é possível
por SQL manual ou pelo script `claim-admin`.

Isto ESTENDE o ADR 0010 de _ver_ pra _mutar_ — uma superfície de escalonamento
de privilégio (quem é admin pode criar outro admin) e de lockout (rebaixar/
revogar errado pode trancar o dono pra fora). Por isso registra-se antes de
implementar.

## Decisão

1. **Mutações em server actions gateadas por role**, em
   `app/actions/admin-users.ts` (`setUserRole`, `setUserAccess`), com o mesmo
   gate defense-in-depth das outras actions de admin (`role === "admin"` DENTRO
   da action, além do layout). As queries novas (`updateUserRole`,
   `updateUserAccess`, `countAdmins`, `getUserManagement`) ficam em
   `lib/db/queries/users.ts` — primeiras mutações do módulo.

2. **Guardas anti-lockout (no servidor, fonte de verdade — não só botão
   desabilitado):**
   - **Não alterar a própria role.** `setUserRole` recusa
     `userId === session.user.id`. Mexer na própria role (sempre um rebaixe, já
     que pra chegar aqui você já é admin) sai pela porta de outro admin.
   - **Não rebaixar o último admin.** Rebaixar (`→ user`) um admin é bloqueado se
     `countAdmins() <= 1` — nunca chegar a zero admins.
   - **Não revogar o próprio acesso.** `setUserAccess` recusa
     `userId === session.user.id && allowed === false`.

   Os self-guards comparam contra `session.user.id` (id carimbado no JWT no
   login, nunca revalidado contra o DB): num delete+recreate manual do operador
   com novo id, o cookie velho não casaria o self-guard — mesmo trade-off de
   staleness do JWT do ADR 0007. O guard do último admin ainda impede zerar
   admins.

3. **Semântica de `allowed` documentada.** Revogar `allowed` remove o usuário da
   whitelist em DB, MAS o env `ALLOWED_EMAILS` é o floor checado primeiro
   (`isEmailAllowedWithDb`): um e-mail no env continua entrando mesmo com
   `allowed=false`. E revogar NÃO encerra a sessão JWT vigente da vítima — o
   token vale até expirar; o efeito é bloquear LOGINS FUTUROS. O revoke também
   depende da invariante de que um usuário existente NÃO tem `pending_invites`
   (`promoteInvitedUserOnLogin` apaga o convite no primeiro login): como
   `isEmailWhitelistedInDb` autoriza com `allowed=true` OU invite pendente, um
   convite remanescente reabriria o acesso — mudanças no fluxo de invite/promoção
   precisam preservar essa invariante. Tudo aceito no contexto solo/F&F e
   registrado pra não surpreender.

4. **TOCTOU aceito.** `countAdmins()` e o `update` são read/write separados
   (neon-http não tem transação interativa; `db.batch` não condiciona). A janela
   de corrida é desprezível num app de operador único; não vale a complexidade de
   um update condicional.

## Razão

- Dá ao admin o controle operacional que faltava (role + acesso) pela UI, sem
  SQL manual nem redeploy.
- As guardas no SERVIDOR garantem que o invariante "sempre ≥ 1 admin e o operador
  não se tranca" vale mesmo via POST direto na action, não só pela UI.
- Reusa o padrão de action/gate/`useActionState` já estabelecido (#52/#80).

## Consequências

- (+) Admin promove/rebaixa e revoga/concede acesso pela UI, com guardas.
- (+) Mutações isoladas em `lib/db/queries/users.ts` + action gateada; zero
  acesso ao DB fora dessa fronteira.
- (−) Superfície de escalonamento de privilégio (admin cria admin) — aceita no
  contexto solo/F&F, gateada por role no layout + re-check na action.
- (−) Revogar acesso tem efeito assimétrico (não vale pra e-mails do env, não
  derruba sessão vigente) — documentado, não corrigido (fora de escopo).

## Referências

- Implementa o #88; estende o ADR 0010 (visão cross-user) de ver pra mutar.
- ADR 0007 (auth multiusuário, JWT, role) e ADR 0009 (whitelist em DB) pro
  modelo de role/acesso.
