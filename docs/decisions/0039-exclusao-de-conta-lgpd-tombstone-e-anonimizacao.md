# ADR 0039 — Exclusão de conta (LGPD): tombstone do `users` + anonimização do histórico, não cascade duro

## Status

Accepted (2026-09-24). Decisão de revisão legal delegada pelo dono (report
[11](../reports/11-revisao-legal.md)). Fecha a pendência "ADR de LGPD-deletion
(anonymize-vs-cascade)" do Report 05 rec. 5 e do Report 09 §3. **Este ADR decide a
estratégia e especifica a feature; a implementação self-serve fica pra um PR de
follow-up.** Até lá, o caminho é o procedimento manual da seção "Runbook manual", já
prometido na `/privacidade` (§8) com prazo de 15 dias.

> **Escopo:** estratégia de eliminação/anonimização quando o titular pede pra excluir a
> conta; o que é apagado, o que é anonimizado e por quê; spec da feature (`/perfil` +
> admin) e dos testes. **Fora de escopo:** exportação (portabilidade, art. 18, V — atendida
> manualmente por e-mail por ora); retenção dos logs dos fornecedores (fora do nosso
> controle, declarada na `/privacidade`).

## Contexto

- A `/privacidade` promete exclusão e diz que o histórico "pode ser mantido de forma
  anônima". Não existe caminho no código: `ai_calls`, `predictions`, `palpite_sets` e
  `bet_slips` referenciam `users` com `onDelete: "restrict"` (`db/schema.ts:259`, `:291`,
  `:444`, `:641`), então `DELETE FROM users` falha. Só as tabelas do Auth.js cascateiam
  (`accounts :171`, `sessions :192`, `authenticators :221`); `verification_tokens` é por
  `identifier` (e-mail), sem FK.
- **Onde há PII hoje** (auditado no código, não no doc):
  - `users`: `email` (único), `name`, `image` (URL de avatar, pode ser a do Google),
    `email_verified`, `accepted_terms_at`, `preferred_model_id`.
  - `accounts`: `provider_account_id` do Google + tokens OAuth.
  - `authenticators`: credencial passkey (chave pública + `provider_account_id`).
  - `verification_tokens.identifier` = e-mail.
  - `bet_slips.raw_input`: **texto livre digitado pelo usuário** (até ~280 chars).
  - `ai_calls.input_payload` das chamadas `bet_parse_*` (`lib/ai/bet-parse/parse.ts:77`,
    `cartridge.ts:99-103`): **o mesmo texto livre** vai no user message e é logado.
    `output_payload`/`error_message` dessas chamadas podem ecoá-lo.
  - `palpite_sets.shared_at`: um palpite público em `/p/[id]` não carrega PII (ADR 0035
    §5/§7), mas é conteúdo que o titular publicou.
  - Fora do banco: contadores do Upstash (e-mail/IP, janela ≤ 24h — `lib/rate-limit.ts`,
    `lib/auth/magic-link-rate-limit.ts:68/114`), logs da Vercel/Resend/Sentry (retenção do
    fornecedor; Sentry com `sendDefaultPii: false`).
- **Onde NÃO há PII:** `predictions`, `palpites`, `prediction_*`, `palpite_outcomes`,
  e os `ai_calls` de análise/palpites (payload = dados da partida, odds, notícias — sem
  e-mail/nome). São saídas do modelo **sobre partidas**, e são a matéria-prima do Yield
  por mercado, da calibração (Report 03) e do custo de IA por modelo.
- `CLAUDE.md`: "❌ Mutar predições passadas". Neon HTTP não tem transação interativa, mas
  `db.batch([...])` executa os statements como uma transação só (padrão já usado em
  `lib/db/queries/odds-snapshots.ts:28`).

### Base legal da decisão

- **Art. 18, VI** (eliminação dos dados tratados com consentimento) e **art. 15, III** +
  **art. 16** (término do tratamento por comunicação do titular → eliminação, salvo as
  exceções do art. 16). Nossa base é execução de contrato (ADR 0040), então o pedido de
  exclusão = fim do contrato = término do tratamento (art. 15, III) → eliminação (art. 16,
  caput). *(verificado na fonte)*
- **Art. 16, IV**: conservação autorizada "para uso exclusivo do controlador, vedado seu
  acesso por terceiro, e desde que anonimizados os dados". *(verificado na fonte)*
- **Art. 12**: dado anonimizado não é dado pessoal, salvo se a anonimização puder ser
  revertida "utilizando exclusivamente meios próprios" ou "com esforços razoáveis"; §1º
  manda considerar custo/tempo e tecnologia disponível. *(verificado na fonte)*
- **Art. 18, IV**: anonimização, bloqueio ou eliminação de dados desnecessários ou
  excessivos. *(verificado na fonte)*
- **Art. 19, II**: resposta completa em até 15 dias — adotado como prazo de execução.
  *(verificado na fonte)*

## Decisão

**1. Estratégia: TOMBSTONE da row `users` + eliminação de toda PII + anonimização do
histórico de saídas do modelo. NÃO cascade duro, NÃO re-apontar pra usuário-sentinela.**

Num único `db.batch` (atômico), na ordem:

| # | Statement | Por quê |
|---|---|---|
| 1 | `UPDATE ai_calls SET input_payload='{"redacted":"account_deleted"}', output_payload='{"redacted":"account_deleted"}', error_message=NULL WHERE user_id=$1 AND prompt_version LIKE 'bet_parse%'` | apaga o texto livre logado (PII potencial) sem quebrar FKs nem o custo agregado (tokens/custo/latência ficam) |
| 2 | `DELETE FROM bet_slips WHERE user_id=$1` (cascata: `bet_legs`, `bet_leg_outcomes`) | apostas registradas são **comportamento de aposta do titular**, não saída do modelo — não há finalidade que justifique manter (art. 16) |
| 3 | `UPDATE palpite_sets SET shared_at=NULL WHERE user_id=$1` | derruba os links públicos `/p/[id]` (kill-switch do ADR 0035 §7) |
| 4 | `DELETE FROM accounts / authenticators / sessions WHERE user_id=$1` | vínculos de login (IDs do Google, passkeys) — como a row `users` fica, a cascata do Auth.js não dispara sozinha |
| 5 | `DELETE FROM verification_tokens WHERE identifier=<e-mail>` | magic links pendentes carregam o e-mail |
| 6 | `UPDATE users SET email='excluido-'||gen_random_uuid()||'@palpiteiro.invalid', name=NULL, image=NULL, email_verified=NULL, accepted_terms_at=NULL, preferred_model_id=NULL, allowed=false, role='user', deleted_at=now() WHERE id=$1` | a row vira lápide: o `id` (uuid aleatório) continua satisfazendo os FKs `restrict`, mas nada nela liga a uma pessoa. `.invalid` é TLD reservado (RFC 2606) — não recebe e-mail, não colide com e-mail real, libera o e-mail original pra uma conta nova do zero |

Fica, sem vínculo com pessoa: `predictions`, `palpite_sets`/`palpites` (+ outcomes),
`ai_calls` de análise/palpites, custo/tokens. Finalidade declarada: estatística agregada
do desempenho do modelo (Yield por mercado, calibração, custo) — **art. 16, IV**.

**2. Por que não cascade duro (Opção A do Report 05).** Exigiria trocar 4 FKs pra
`cascade` (migration) e **destruiria saídas do modelo** que não são dado pessoal: o Yield
por mercado e a calibração (critério de saída da Fase C do Report 03 — ≥150 apostas
liquidadas) perderiam amostra a cada exclusão, e o custo de IA histórico ficaria errado.
A LGPD não exige apagar o que, desvinculado, não é dado pessoal (art. 12) e autoriza
guardá-lo anonimizado (art. 16, IV). Cascade também tornaria um `DELETE` acidental de
admin catastrófico — o `restrict` é uma proteção que vale manter.

**3. Por que não re-apontar pra um usuário-sentinela.** Mutaria `user_id` de
`predictions`/`palpite_sets`/`ai_calls` (contra a regra de imutabilidade do `CLAUDE.md`),
mais statements em mais tabelas, e o ganho de anonimização é nulo na nossa escala: com
uma exclusão, o bucket-sentinela É a pessoa. O tombstone muda só a row `users` + apaga o
que é do titular.

**4. Suficiência da anonimização (art. 12) — risco residual aceito.** Depois do batch, o
que resta é histórico de análises sobre partidas, chaveado por um uuid aleatório sem
tabela que o ligue a alguém. Reverter exigiria informação que não guardamos. Risco
residual reconhecido: na escala de amigos, o próprio dono poderia, **de memória**,
associar datas de análise a uma pessoa. Mitigação vinculante: o histórico de contas
excluídas só é usado em **agregado** (nunca drill-down por conta excluída — ver 5.c) e
nunca é compartilhado (art. 16, IV "vedado acesso por terceiro"). `users.created_at`
fica (NOT NULL, não identifica sozinho).

**5. Spec da feature (follow-up, 1 PR, esforço M).**
- a. **Migration**: `users.deleted_at timestamptz NULL` (aditiva, metadata-only). É a
  prova de execução do pedido (accountability, art. 6º, X *(não verificado — conferir
  depois)*) e o marcador pra UI/admin.
- b. **Query** `lib/db/queries/account-deletion.ts` → `anonymizeUser(userId)`: lê o
  e-mail, monta o `db.batch` da Decisão 1, **idempotente** (rodar 2× não falha; se
  `deleted_at` já está setado, no-op). Guard: nunca rodar pra e-mail do env-floor
  `ALLOWED_EMAILS` (anti-lockout do admin — o floor re-provisionaria a conta no próximo
  login de qualquer forma).
- c. **Self-serve** em `/perfil` (substitui a seção "Seus dados" de mailto): "Excluir minha
  conta" em zona de perigo, confirmação digitando o próprio e-mail, Server Action →
  `anonymizeUser(session.user.id)` → `signOut()`. A sessão JWT morre sozinha no próximo
  `jwt()` (`revalidateToken` vê `allowed=false`).
- d. **Admin** (`/admin/users/[id]`): o mesmo botão, pra pedidos por e-mail; a lista de
  usuários mostra lápides como "conta excluída" e as views por-usuário (ADR 0010) **não**
  abrem drill-down de conta excluída — só entram em agregados.
- e. **Testes** (pglite, com as migrations reais): após `anonymizeUser` — nenhuma row com o
  e-mail original em `users`/`verification_tokens`; zero rows em `accounts`/
  `authenticators`/`sessions`/`bet_slips` do id; `ai_calls` bet_parse redigidos e os de
  análise intactos; `palpite_sets.shared_at` nulo e `/p` do set retorna 404
  (`getSharedPalpiteSet`); `predictions` intactas; outro usuário intocado; 2ª execução
  no-op; o mesmo e-mail consegue criar conta nova.
- f. `/privacidade` §8 passa a citar o botão (bump de data).

**6. Fora do banco.** Upstash: contadores expiram em ≤ 24h, sem ação. Vercel/Resend/
Sentry: retenção do fornecedor, declarada na `/privacidade`; não reprocessamos esses logs.

## Runbook manual (vale até a feature existir)

Pedido chega em `contato@palpiteiro.live`. Só atender se vier **do e-mail da conta**
(confirma titularidade). Prazo: 15 dias. No console SQL do Neon (branch de produção),
numa transação:

```sql
BEGIN;
-- :uid = users.id do e-mail solicitante (SELECT id FROM users WHERE email = '...')
UPDATE ai_calls SET input_payload = '{"redacted":"account_deleted"}',
                    output_payload = '{"redacted":"account_deleted"}',
                    error_message = NULL
 WHERE user_id = :uid AND prompt_version LIKE 'bet_parse%';
DELETE FROM bet_slips WHERE user_id = :uid;
UPDATE palpite_sets SET shared_at = NULL WHERE user_id = :uid;
DELETE FROM accounts WHERE user_id = :uid;
DELETE FROM authenticators WHERE user_id = :uid;
DELETE FROM sessions WHERE user_id = :uid;
DELETE FROM verification_tokens WHERE identifier = '<e-mail>';
UPDATE users SET email = 'excluido-' || gen_random_uuid() || '@palpiteiro.invalid',
                 name = NULL, image = NULL, email_verified = NULL,
                 accepted_terms_at = NULL, preferred_model_id = NULL,
                 allowed = false, role = 'user'
 WHERE id = :uid;
COMMIT;
```

Responder ao titular confirmando a execução e a data. Guardar só a data e o fato (sem o
e-mail) numa nota privada até a coluna `deleted_at` existir.

## Alternativas consideradas e rejeitadas

1. **Cascade duro** — ver Decisão 2.
2. **Sentinela "conta excluída"** — ver Decisão 3.
3. **Soft-delete sem apagar PII** (`deleted_at` e só) — rejeitado: não é eliminação nem
   anonimização; descumpre art. 16 caput.
4. **Manter `bet_slips` anonimizados** (só `raw_input=NULL`) — rejeitado: é histórico de
   comportamento de aposta do titular, sem finalidade própria que justifique conservação;
   apagar é mais simples e mais protetivo.
5. **Redigir TODOS os `ai_calls` do usuário** — rejeitado: os de análise/palpites não têm
   PII e são a trilha de auditoria do modelo (ADR 0038 Decisão 4 depende do
   `output_payload` pra reconstruir o gate).

## Consequências

- O titular tem eliminação real da PII e um prazo firme; o produto mantém o histórico de
  desempenho do modelo.
- Rows-lápide aparecem em `users`; queries de admin precisam filtrar `deleted_at` quando a
  coluna existir.
- A regra "não mutar predições" segue intacta — só `users`, `ai_calls` bet_parse
  (redação), `palpite_sets.shared_at` e tabelas do titular mudam.

## Citações não verificadas nesta sessão

- LGPD art. 6º, X (responsabilização e prestação de contas) — conferir depois.
- RFC 2606 (TLD `.invalid` reservado) — conhecimento técnico, não conferido.
