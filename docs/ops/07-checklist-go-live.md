# Checklist final de produção (Fase 2: abrir pros amigos)

Este é o checklist mestre que amarra os docs [`01`](./01-dominio.md)–[`06`](./06-marca-inpi.md) num único fluxo ordenado, com checkboxes pra você marcar conforme avança. O objetivo é destravar a **Fase 2** do [roadmap](../ROADMAP.md): sair do uso solo e abrir o Palpiteiro pra família e amigos (meta: **≥3 usuários** logando por convite/whitelist), de forma redondinha.

Use este doc como _runbook_ de go-live. Cada seção referencia o doc detalhado correspondente — aqui ficam só os checkboxes e o "está pronto?" de cada etapa. Marque `[x]` à medida que fecha cada item.

> ℹ️ **Contexto legal (não muda nada técnico, mas tira peso):** o Palpiteiro **não aceita dinheiro real nem opera apostas** — gera recomendações + tracking de Yield hipotético; a aposta real é feita pelo usuário fora do app, em plataformas `.bet.br` autorizadas. Logo o app **não** é operador sob a [Lei 14.790/2023](https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2023/lei/l14790.htm). Isso reduz muito a carga regulatória, mas não zera 18+, jogo responsável e LGPD — ver [`05-legal-compliance.md`](./05-legal-compliance.md).

## TL;DR da ordem

1. **Domínio** comprado + DNS apontado pra Vercel → [`01`](./01-dominio.md).
2. **Vercel produção** com domínio custom + matriz de env vars completa + crons protegidos → [`02`](./02-vercel-prod.md).
3. **Resend** fora do modo teste (domínio verificado) → o magic link chega na caixa dos amigos → [`03`](./03-email-resend.md).
4. **Observabilidade**: Sentry ligado (ou adiamento consciente) + spend-alert ativo → [`04`](./04-observabilidade.md).
5. **Legal**: páginas `/termos` e `/privacidade` + footer 18+/jogo responsável → [`05`](./05-legal-compliance.md).
6. **Marca**: domínio e handles garantidos; INPI adiado conscientemente → [`06`](./06-marca-inpi.md).
7. **Whitelist** dos amigos + `db:claim-admin` rodado → [`auth-setup.md`](../runbooks/auth-setup.md).
8. **Smoke tests** pós-deploy (login externo, análise, crons, override, dashboard).
9. **Definition of done**: ≥3 amigos convidados logam e veem recomendações.

> ⚠️ A ordem **3 antes de 7** importa: enquanto o Resend estiver em modo teste, o magic link só chega no e-mail da sua própria conta Resend — então convidar amigos só funciona _depois_ de verificar o domínio. Verifique o domínio primeiro; só então adicione amigos na whitelist.

---

## (a) Domínio comprado + DNS apontado — [`01-dominio.md`](./01-dominio.md)

- [ ] Nome decidido e **registrado** (ver DECISÃO abaixo).
- [ ] Registro pago e dentro do prazo de renovação anotado.
- [ ] Registrante = você (e-mail real, não vai expirar sem aviso).
- [ ] DNS apontado pra Vercel conforme o doc 01 (registros A/CNAME ou nameservers da Vercel).
- [ ] Propagação de DNS confirmada (o domínio resolve pro app).

> ✅ **DECISÃO (sua):** qual nome/TLD? Candidato mencionado: `palpiteiro.com.br`, mas `.com` / `.app` também são opções.
> **Recomendação default:** o `.com.br` casa com o público (futebol BR, amigos no Brasil) e com a futura marca INPI; se quiser proteção de marca mais ampla/internacional, segure também o `.com`. Detalhes e trade-offs em [`01-dominio.md`](./01-dominio.md) e [`06-marca-inpi.md`](./06-marca-inpi.md). **A escolha é sua.**

## (b) Vercel produção + env vars completas — [`02-vercel-prod.md`](./02-vercel-prod.md)

- [ ] Domínio custom anexado ao projeto Vercel (Production), HTTPS válido.
- [ ] **Matriz de env vars de Production completa** (checklist dedicado na seção [Matriz de env vars de Production](#matriz-de-env-vars-de-production) abaixo).
- [ ] Crons aparecem no projeto (Settings → Cron Jobs) e `CRON_SECRET` setado em Production **e** Preview.
- [ ] Integração **Neon** confirmada (`DATABASE_URL` AUTO, não setada na mão).
- [ ] Store **Vercel KV** linkada (`KV_*` AUTO).
- [ ] Plano **Hobby vs Pro** decidido conscientemente (ver DECISÃO abaixo).
- [ ] Deploy de produção verde; build rodou `drizzle-kit migrate && next build` (migrations aplicadas).

> ✅ **DECISÃO (sua):** ficar no **Hobby** ou subir pro **Pro**?
> **Recomendação default: ficar no Hobby na Fase 2** — o app não aceita dinheiro nem opera apostas (uso pessoal/não-comercial), tráfego é baixo e os free tiers cabem folgados. Reavalie só se aceitar pagamento ou tráfego crescer. Racional completo em [`02-vercel-prod.md`](./02-vercel-prod.md#plano-hobby-vs-pro).

## (c) Resend fora do modo teste — [`03-email-resend.md`](./03-email-resend.md)

- [ ] Domínio **verificado** no Resend (registros SPF/DKIM/DMARC publicados no DNS).
- [ ] `RESEND_FROM_EMAIL` trocado de `onboarding@resend.dev` para `no-reply@seudominio...` (ou similar) em Production.
- [ ] Teste de entrega: magic link chega numa caixa **externa** (Gmail de amigo), idealmente não no spam.
- [ ] `SPEND_ALERT_EMAIL` e o remetente do alerta de gasto usam o mesmo domínio verificado.

> ⚠️ Subdomínios `*.vercel.app` **não** podem ser verificados no Resend — é exatamente por isso que o domínio próprio (seção **a**) é pré-requisito desta etapa. Sem domínio verificado, o Resend só entrega pro e-mail da sua própria conta Resend, e o convite pros amigos **não** chega.

## (d) Observabilidade + spend-alert — [`04-observabilidade.md`](./04-observabilidade.md)

- [ ] **Sentry**: wired do zero (instalar `@sentry/nextjs`, configurar `SENTRY_DSN`) **OU** decisão consciente de **adiar** (ver DECISÃO abaixo).
- [ ] **Spend-alert ativo**: `DAILY_AI_SPEND_ALERT_USD` (>0) e `SPEND_ALERT_EMAIL` setados em Production (opt-in — recomendado pra Fase 2).
- [ ] Logs do app acessíveis (Vercel → Logs/Observability) e você sabe onde olhar quando algo quebra.
- [ ] (Opcional) Uptime check externo apontando pra `/` (ver doc 04).

> ✅ **DECISÃO (sua):** ligar o **Sentry agora** ou **adiar**?
> **Recomendação default:** ligar o **free tier do Sentry agora** — é greenfield (o pacote não está instalado e não há código Sentry hoje), o tier grátis cobre tráfego baixo e, com amigos usando, você quer ver o stack trace de um erro sem depender de print no WhatsApp. Se preferir adiar, registre a decisão e deixe `SENTRY_DSN` vazia de propósito. Passo a passo e limites atuais em [`04-observabilidade.md`](./04-observabilidade.md).

## (e) Páginas legais + footer — [`05-legal-compliance.md`](./05-legal-compliance.md)

- [ ] Página **`/termos`** publicada (uso pessoal, sem garantia, app não opera apostas).
- [ ] Página **`/privacidade`** publicada (LGPD: coleta de e-mail, base legal, contato, exclusão).
- [ ] **Footer** com aviso **18+** e link de **jogo responsável**.
- [ ] Disclaimer claro de que recomendações não são garantia e a aposta real acontece fora do app, em plataformas `.bet.br` autorizadas.

> ⚠️ As rotas `/termos` e `/privacidade` **ainda não existem** no app (não há `app/termos` nem `app/privacidade` hoje). Criá-las é parte do trabalho da Fase 2 — ver [`05-legal-compliance.md`](./05-legal-compliance.md).

## (f) Marca — domínio/handles garantidos, INPI adiado — [`06-marca-inpi.md`](./06-marca-inpi.md)

- [ ] Domínio garantido (mesmo da seção **a**).
- [ ] Handles de redes sociais reservados (mesmo que não use ainda) — evita squatting.
- [ ] **INPI**: registro de marca **avaliado** e **adiado conscientemente** pra Fase 2 (ou iniciado, se você decidir) — ver DECISÃO abaixo.

> ✅ **DECISÃO (sua):** registrar marca no **INPI agora** ou **adiar**?
> **Recomendação default: adiar na Fase 2.** Com app sem monetização e uso entre amigos, o registro INPI é custo/burocracia que pode esperar; o essencial agora é **não perder o nome** (domínio + handles). Reavalie se for abrir ao público. Custos e prazos em [`06-marca-inpi.md`](./06-marca-inpi.md).

## (g) Whitelist dos amigos + claim-admin — [`auth-setup.md`](../runbooks/auth-setup.md)

- [ ] `ALLOWED_EMAILS` em Production inclui você **e os amigos** (lista por vírgula, case-insensitive).
- [ ] Whitelist na **tabela do DB** populada para os amigos (via `/admin/invites` ou `pnpm db:seed-invites`) — complementa a env (ver [ADR 0009](../decisions/0009-whitelist-db-table.md)).
- [ ] `pnpm db:claim-admin` **já rodado uma vez** contra o DB de **prod** (você é admin).
- [ ] Você fez **logout + login** uma vez depois do claim (pro JWT carregar `role: "admin"`).

> ⚠️ A ordem do claim importa: rodar `db:claim-admin` **antes** do seu primeiro login. Detalhes (e o porquê do relogin) em [`auth-setup.md`](../runbooks/auth-setup.md) e [ADR 0007](../decisions/0007-auth-multiuser-jwt-env-whitelist.md).

---

## Matriz de env vars de Production

Checklist da matriz **canônica** de Production (nomes exatos do [`.env.example`](../../.env.example)). Marque cada uma conforme seu estado-alvo. Detalhe completo de _onde_ e _como_ setar em [`02-vercel-prod.md`](./02-vercel-prod.md#matriz-de-env-vars).

Legenda de **Estado-alvo**: **SETAR** = você cola na mão · **AUTO** = integração popula (não mexa) · **VAZIA** = vazia de propósito · **OPT-IN** = só se quiser o recurso.

| Env | Estado-alvo | Pronto? |
| --- | --- | :---: |
| `DATABASE_URL` | AUTO (Neon) — não setar na mão | [ ] |
| `KV_URL` | AUTO (KV) | [ ] |
| `KV_REST_API_URL` | AUTO (KV) | [ ] |
| `KV_REST_API_TOKEN` | AUTO (KV) | [ ] |
| `KV_REST_API_READ_ONLY_TOKEN` | AUTO (KV) | [ ] |
| `AUTH_URL` | **VAZIA** na Vercel (`trustHost` deriva de `VERCEL_URL`) | [ ] |
| `AUTH_SECRET` | SETAR (`openssl rand -base64 32`, Sensitive) | [ ] |
| `AUTH_RESEND_KEY` | SETAR (API key Resend, Sensitive) | [ ] |
| `RESEND_FROM_EMAIL` | SETAR (`no-reply@seudominio...` pós-domínio) | [ ] |
| `ALLOWED_EMAILS` | SETAR (você + amigos, por vírgula) | [ ] |
| `ANTHROPIC_API_KEY` | SETAR (pay-per-use, Sensitive) | [ ] |
| `ODDS_API_KEY` | SETAR (Sensitive) | [ ] |
| `API_FOOTBALL_KEY` | SETAR (plano direto api-sports.io, Sensitive) | [ ] |
| `FOOTBALL_DATA_ORG_API_KEY` | SETAR (Sensitive) | [ ] |
| `SPORTS_DATA_PRIMARY` | SETAR (`api-football` default) | [ ] |
| `SPORTS_DATA_FALLBACK` | SETAR (`football-data-org` default) | [ ] |
| `CRON_SECRET` | SETAR (Production **e** Preview, Sensitive) | [ ] |
| `RATE_LIMIT_ANALYSES_PER_DAY` | SETAR ou deixar default `20` | [ ] |
| `RATE_LIMIT_ANALYSES_PER_DAY_ADMIN` | SETAR ou deixar default `200` | [ ] |
| `DAILY_AI_SPEND_ALERT_USD` | OPT-IN (recomendado p/ Fase 2) | [ ] |
| `SPEND_ALERT_EMAIL` | OPT-IN (par do anterior) | [ ] |
| `SENTRY_DSN` | SETAR (se ligar Sentry) **ou** VAZIA (se adiar) | [ ] |

> ⚠️ Três erros clássicos (repetidos de [`02`](./02-vercel-prod.md#matriz-de-env-vars)): **(1)** setar `DATABASE_URL`/`KV_*` na mão quebra a integração; **(2)** preencher `AUTH_URL` na Vercel quebra o callback do magic link em Preview; **(3)** esquecer de marcar **Preview** numa env manual de runtime faz o deploy de PR falhar (ou pior, falhar aberto). Marque Production **e** Preview pras manuais de runtime.

---

## Smoke tests pós-deploy

Rode estes **depois** do deploy de produção com o domínio custom e o Resend já fora do modo teste. São o "destravou de verdade?" da Fase 2.

### 1. Login por magic link num e-mail externo

- [ ] Em `/signin`, submeta o e-mail de um amigo **whitelisted** (env + DB).
- [ ] O magic link chega na caixa dele (externa, ex.: Gmail) — não só na sua conta Resend.
- [ ] Clicar no link loga e a home renderiza.
- [ ] Um e-mail **não** whitelisted é recusado **antes** do envio (mensagem "não autorizado" em `/signin?error=AccessDenied`).

> ℹ️ Se o link cair em spam no Gmail, está documentado como gotcha conhecido — ver [`03-email-resend.md`](./03-email-resend.md) (entregabilidade).

### 2. Analisar um jogo (rate limit + custo logado)

- [ ] Disparar uma análise de um jogo na UI; recomendação over/under 2.5 renderiza.
- [ ] O custo da chamada aparece em `ai_calls` (visível em `/admin/costs`).
- [ ] O **rate limit por usuário/dia** aplica (depois de `RATE_LIMIT_ANALYSES_PER_DAY` análises, novas chamadas são barradas **antes** de tocar a Anthropic).

> ⚠️ **Custo real:** cada análise gasta tokens (dinheiro de verdade). No smoke test, rode o **mínimo** necessário — uma análise basta pra validar o caminho feliz.

### 3. Trigger manual dos crons (Bearer `CRON_SECRET`)

Os dois crons são rotas **GET** protegidas por `Authorization: Bearer <CRON_SECRET>`. Dá pra dispará-los à mão pra validar (use o valor real de `CRON_SECRET` e o domínio de produção):

```bash
# Settlement (liquida predições com resultado conhecido; idempotente)
curl -i -H "Authorization: Bearer $CRON_SECRET" \
  https://SEU-DOMINIO/api/cron/settle-predictions

# Spend alert (e-mail se o gasto AI do dia passar do limite; dedup por dia)
curl -i -H "Authorization: Bearer $CRON_SECRET" \
  https://SEU-DOMINIO/api/cron/spend-alert
```

- [ ] `settle-predictions` retorna `200` com `{ ok: true, summary: ... }`.
- [ ] `spend-alert` retorna `200` com `{ ok: true, ... }` (e-mail só sai se opt-in + acima do limite).
- [ ] Sanity-check de auth: a **mesma** chamada **sem** o header (ou com secret errado) retorna `401`.

> ⚠️ As rotas **falham fechadas**: sem `CRON_SECRET` setado ou com secret errado, retornam `401` (não rodam). Confirme que isso vale — é a prova de que os crons agendados estão autenticados. Detalhes em [`02-vercel-prod.md`](./02-vercel-prod.md#cron_secret--proteger-os-crons).

### 4. Override de settlement (admin)

- [ ] Como admin, abra `/admin/predictions/<id>` e aplique um **override** de resultado.
- [ ] O override persiste e o Yield/dashboard reflete a correção.

> ℹ️ Settlement é **idempotente** e suporta override manual de propósito — jogos podem ser anulados, adiados ou ter score corrigido depois (gotcha do [`CLAUDE.md`](../../CLAUDE.md)).

### 5. Dashboard / Yield renderiza

- [ ] O dashboard carrega para um usuário comum (não-admin) e mostra as predições/Yield dele.
- [ ] Números de Yield batem (sanity-check: nada de string-math nem `NaN`).
- [ ] Loading states aparecem no cold start da Neon (~1s) sem travar a UI.

---

## Plano de rollback

Se um deploy de produção quebrar, **reverter é redeploy do build anterior** — não mexa no DB às cegas.

1. **Promover o deploy bom anterior** na Vercel: **Deployments** → ache o último deploy verde → **⋯ → Promote to Production** (ou **Rollback**, conforme a UI). Docs: [Instant Rollback](https://vercel.com/docs/deployments/instant-rollback).
2. Confirme que o domínio custom voltou a servir o deploy bom (HTTPS ok, home renderiza).
3. Se a causa foi uma **env var** errada, corrija no painel e faça **Redeploy** (env vars valem no build/runtime do deploy — mudar não vale retroativamente).

> ⚠️ **Migrations são forward-only.** O build aplica `drizzle-kit migrate` no deploy e **não há down-migration automática**. Promover um build anterior **não desfaz** uma migration já aplicada no DB. Se uma migration ruim entrou em prod, reverter o schema exige uma **nova** migration que desfaz o estado — nunca rode `db push` destrutivo contra prod. Em prod cada deploy roda contra a Neon **main**; teste schema arriscado num Preview (branch isolada) antes. Ver [`02-vercel-prod.md`](./02-vercel-prod.md#integração-neon-postgres).

> 💡 Antes de um deploy arriscado, vale anotar o ID do deploy atual (o "bom conhecido") pra promover rápido se precisar.

---

## Definition of done — Fase 2

A Fase 2 está **pronta** quando:

- [ ] **≥3 amigos convidados** (whitelist env + DB) conseguem **logar por magic link** (e-mail chega na caixa deles, fora do modo teste do Resend).
- [ ] Esses amigos **veem recomendações** (análise over/under 2.5) e o **dashboard/Yield** deles.
- [ ] Você (admin) consegue convidar/revogar, ver custos (`/admin/costs`) e aplicar override de settlement.
- [ ] Os crons rodam autenticados (settlement diário + spend-alert opt-in ligado).
- [ ] Páginas `/termos` e `/privacidade` no ar + footer 18+/jogo responsável.

> ✅ Bateu os cinco? Fase 2 destravada. Próximo foco (fora do escopo destes docs) é a Fase 3 (público), que **não está planejada** e dependeria de revisitar plano Vercel, legal e marca.

---

## Próximos passos e cross-links

- [`README.md`](./README.md) — índice de ops, ordem recomendada e tabela de custos.
- [`01-dominio.md`](./01-dominio.md) — comprar domínio + DNS pra Vercel.
- [`02-vercel-prod.md`](./02-vercel-prod.md) — Vercel produção: domínio, env vars, crons, Neon/KV, Hobby vs Pro.
- [`03-email-resend.md`](./03-email-resend.md) — Resend fora do modo teste: domínio + entregabilidade.
- [`04-observabilidade.md`](./04-observabilidade.md) — Sentry do zero, logs, uptime, alertas.
- [`05-legal-compliance.md`](./05-legal-compliance.md) — 18+, jogo responsável, LGPD, termos, Lei 14.790/2023.
- [`06-marca-inpi.md`](./06-marca-inpi.md) — registro de marca no INPI (avaliar/adiar).
- [`../runbooks/auth-setup.md`](../runbooks/auth-setup.md) — setup de auth, whitelist e `db:claim-admin`.
- ADRs relevantes: [0007 — auth multiuser](../decisions/0007-auth-multiuser-jwt-env-whitelist.md) · [0009 — whitelist em tabela DB](../decisions/0009-whitelist-db-table.md).
