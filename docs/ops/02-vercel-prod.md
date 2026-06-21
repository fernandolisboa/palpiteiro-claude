# Configurar o projeto Vercel pra produção

> ✅ **JÁ FEITO (2026-06).** Produção no ar em **`palpiteiro.live`** (apex canônico, `www`
> redireciona), plano **Vercel Pro**, 5 crons + `CRON_SECRET`, Neon/KV integrados,
> `RESEND_FROM_EMAIL` = `contato@palpiteiro.live`. Este doc vira **runbook** (a decisão
> "Hobby vs Pro" abaixo já é **Pro**). Estado consolidado no [`README`](./README.md) e no
> [`07-checklist-go-live.md`](./07-checklist-go-live.md).

Operacional. Como deixar o projeto Vercel **pronto pra produção** da Fase 2
(abrir pros amigos): domínio custom anexado, matriz de env vars correta, crons
protegidos, integrações Neon/KV confirmadas e um deploy de produção verificado.

O app já roda hoje num subdomínio `*.vercel.app`. Este doc fecha o gap entre
"funciona pra mim" e "pronto pra convidar gente" — sem mudar arquitetura, só
configurando o painel da Vercel direito.

> 📌 Pré-requisito: a escolha e compra do domínio é o [`01-dominio.md`](./01-dominio.md).
> Você pode anexar o domínio agora ou depois, mas a entregabilidade do e-mail
> (magic link pros amigos) depende dele — ver [`03-email-resend.md`](./03-email-resend.md).

## TL;DR da ordem

1. **Anexar o domínio custom** ao projeto e marcar como Production (precisa do DNS do [`01-dominio.md`](./01-dominio.md)).
2. **Preencher a matriz de env vars** — só as manuais; `DATABASE_URL`, `KV_*` são auto; `AUTH_URL` fica **vazia**.
3. **Gerar e setar o `CRON_SECRET`** (Production + Preview).
4. **Confirmar** as integrações Neon e KV linkadas.
5. **Decidir Hobby vs Pro** (default: Hobby — ver callout de decisão).
6. **Deploy de produção** + verificação de `/` e `/signin`.

## Anexar o domínio custom

Pré-requisito: domínio comprado e DNS apontado conforme [`01-dominio.md`](./01-dominio.md).

1. No painel da Vercel, abra o projeto → **Settings → Domains**.
2. Clique **Add Domain**, digite o apex (ex.: `seudominio.com.br`) e confirme.
3. A Vercel mostra os registros DNS esperados (A/CNAME). Se você seguiu o
   [`01-dominio.md`](./01-dominio.md), eles já batem — aguarde a verificação
   ficar verde (pode levar de minutos a algumas horas pela propagação de DNS).
4. Adicione também a variante `www` (ex.: `www.seudominio.com.br`).
5. **Redirect www ↔ apex**: a Vercel deixa você escolher qual é o canônico. Em
   **Settings → Domains**, marque um como principal e configure o outro pra
   **Redirect** (308) pra ele. Recomendação: apex como canônico, `www`
   redireciona pro apex (gosto pessoal; o inverso é igualmente válido).
6. Marque o domínio custom como **Production** — assim o branch de produção
   (`main`) passa a servir nele, não só no `*.vercel.app`.

> ⚠️ O subdomínio `*.vercel.app` continua existindo e funcionando depois de
> anexar o custom. Mantenha-o — alguns checks e o Preview ainda o usam. Mas
> **comunique o domínio custom** como o oficial pros amigos.

> 🔗 Depois de o domínio existir e estar verificado, ele destrava a verificação
> de domínio no Resend (sair do modo teste) — siga [`03-email-resend.md`](./03-email-resend.md).
> `*.vercel.app` **não** pode ser verificado no Resend, por isso o domínio
> custom é pré-requisito pra mandar magic link pros amigos.

## Matriz de env vars

Onde setar cada env e de onde ela vem. A coluna **Origem** é a parte que mais
gera erro: o que é **AUTO** (preenchido por integração) você **não** mexe; o que
é **MANUAL** você cola no painel.

> ℹ️ Como setar manual: **Settings → Environment Variables → Add New**. Para cada
> var, marque os ambientes (Production / Preview / Development) e cole o valor.
> Marque as que são segredo como **Sensitive** (a Vercel não deixa relê-las
> depois — guarde uma cópia no seu gerenciador de senhas). Docs oficiais:
> [Environment Variables](https://vercel.com/docs/environment-variables) e
> [Managing env vars across environments](https://vercel.com/docs/environment-variables/manage-across-environments).

| Env | Origem | Production | Preview | Development | Observação |
| --- | --- | :---: | :---: | :---: | --- |
| `DATABASE_URL` | **AUTO** (Neon) | ✅ | ✅ | — local | Integração Vercel-Neon popula. **Não setar manual.** Prod → Neon main; cada Preview → branch isolada. Local: cole a string da sua branch de dev no `.env.local`. |
| `KV_URL` | **AUTO** (KV) | ✅ | ✅ | — | Integração Vercel KV popula. **Não setar manual.** |
| `KV_REST_API_URL` | **AUTO** (KV) | ✅ | ✅ | — | idem |
| `KV_REST_API_TOKEN` | **AUTO** (KV) | ✅ | ✅ | — | idem |
| `KV_REST_API_READ_ONLY_TOKEN` | **AUTO** (KV) | ✅ | ✅ | — | idem |
| `AUTH_URL` | **VAZIA na Vercel** | ⬜ vazia | ⬜ vazia | local | `trustHost` deriva de `VERCEL_URL` — não setar na Vercel. Local: `http://localhost:3000` no `.env.local`. |
| `AUTH_SECRET` | MANUAL | ✅ | ✅ | ✅ | `openssl rand -base64 32`. Nome tem que ser `AUTH_SECRET`. Sensitive. |
| `AUTH_RESEND_KEY` | MANUAL | ✅ | ✅ | ✅ | API key do Resend ([resend.com/api-keys](https://resend.com/api-keys)). Sensitive. |
| `RESEND_FROM_EMAIL` | MANUAL | ✅ | ✅ | ✅ | Modo teste: `onboarding@resend.dev`. Pós-domínio: `no-reply@seudominio...` — ver [`03-email-resend.md`](./03-email-resend.md). |
| `ALLOWED_EMAILS` | MANUAL | ✅ | ✅ | ✅ | Whitelist por vírgula (gate antes de enviar o link). Complementa a tabela de whitelist no DB. |
| `ANTHROPIC_API_KEY` | MANUAL | ✅ | ✅ | ✅ | Pay-per-use. **Custa dinheiro real.** Sensitive. |
| `ODDS_API_KEY` | MANUAL | ✅ | ✅ | ✅ | The Odds API (free tier 500 req/mês). Sensitive. |
| `API_FOOTBALL_KEY` | MANUAL | ✅ | ✅ | ✅ | API-Football plano direto (api-sports.io), não RapidAPI. Sensitive. |
| `FOOTBALL_DATA_ORG_API_KEY` | MANUAL | ✅ | ✅ | ✅ | football-data.org (free tier 10 req/min). Sensitive. |
| `SPORTS_DATA_PRIMARY` | MANUAL | ✅ | ✅ | ✅ | `api-football` (default) ou `football-data-org`. |
| `SPORTS_DATA_FALLBACK` | MANUAL | ✅ | ✅ | ✅ | `football-data-org` (default) ou `api-football`. |
| `CRON_SECRET` | MANUAL | ✅ | ✅ | (`.env.local` p/ testar) | Protege os crons. Ver seção abaixo. Sensitive. Pra bater os crons localmente via `curl` (ver [`07-checklist-go-live.md`](./07-checklist-go-live.md)), defina também no `.env.local` — senão a rota responde 401. |
| `RATE_LIMIT_ANALYSES_PER_DAY` | MANUAL (opcional) | ✅ | ✅ | — | Teto diário por usuário. Default no código `20` se ausente. |
| `RATE_LIMIT_ANALYSES_PER_DAY_ADMIN` | MANUAL (opcional) | ✅ | ✅ | — | Default `200`. |
| `DAILY_AI_SPEND_ALERT_USD` | **OPT-IN** | ✅* | — | — | Limite de gasto/dia pra disparar e-mail. Deixe **vazia pra desativar**. |
| `SPEND_ALERT_EMAIL` | **OPT-IN** | ✅* | — | — | Destinatário do alerta. Sem ela o cron roda mas não manda nada. |
| `SENTRY_DSN` | MANUAL (depois) | ✅ | ✅ | — | Só placeholder hoje; wiring de Sentry é do zero — ver [`04-observabilidade.md`](./04-observabilidade.md). |

`*` = setar só se você quiser o alerta de gasto ligado (recomendado pra Fase 2 — assim você nota um pico de custo Anthropic no mesmo dia).

> ⚠️ **Os três erros clássicos desta matriz:**
> 1. Setar `DATABASE_URL` ou `KV_*` na mão → conflita com a integração e quebra
>    Preview (branch errada) ou aponta prod pro DB errado. **Deixe AUTO.**
> 2. Preencher `AUTH_URL` na Vercel → pode quebrar o callback do magic link em
>    Preview. **Deixe vazia** na Vercel; só local tem `http://localhost:3000`.
> 3. Esquecer de marcar **Preview** numa env manual → o deploy de PR sobe sem a
>    key e falha em runtime (ou pior, falha aberto). Marque Production **e**
>    Preview pra todas as manuais de runtime.

> 💡 Mudou uma env depois de já ter deployado? Ela **não** vale retroativamente
> no deploy atual — env vars são lidas no build/runtime do deploy. Faça um
> **Redeploy** pra pegar o novo valor.

## CRON_SECRET — proteger os crons

Os dois crons já estão declarados no `vercel.json`:

| Cron | Path | Schedule (UTC) | Faz o quê |
| --- | --- | --- | --- |
| Settlement | `/api/cron/settle-predictions` | `0 9 * * *` (09:00) | Liquida predições com resultado conhecido (idempotente). |
| Spend alert | `/api/cron/spend-alert` | `0 23 * * *` (23:00) | Se opt-in, e-mail quando o gasto AI do dia passa do limite. |

A Vercel chama essas rotas com o header `Authorization: Bearer <CRON_SECRET>`.
A rota **falha fechada (500)** se o secret não estiver setado e **rejeita (401)**
em mismatch — ou seja, sem o `CRON_SECRET` configurado os crons não rodam de
verdade (falham em vez de rodar sem proteção).

Gere e copie o valor:

```bash
openssl rand -base64 32
```

Depois, no painel: **Settings → Environment Variables → Add New** →
`CRON_SECRET` → cole o valor → marque **Production** e **Preview** → **Sensitive**.

> ⚠️ Production **e** Preview. Se o Preview rodar um cron (ou você bater na rota
> num deploy de PR) sem o secret, ela retorna 500. Setar nos dois evita ruído de
> erro vindo de Preview.

> 🔗 O detalhe de quem dispara/dedup e o threshold do alerta de gasto está em
> [`04-observabilidade.md`](./04-observabilidade.md). Aqui só garantimos que o
> cron está **autenticado**.

## Integração Neon (Postgres)

1. **Confirmar linkada**: **Settings → Integrations** (ou **Storage**) deve
   listar a Neon conectada ao projeto. Se sim, `DATABASE_URL` aparece como
   variável gerenciada (AUTO) em Production e Preview — não edite.
2. **Migrations no deploy**: o build é `drizzle-kit migrate && next build`
   (ver `package.json`). As migrations **aplicam sozinhas** no deploy e são
   **forward-only** — não há rollback automático. Reverter = nova migration que
   desfaz. **Nunca** rodar `db push`/`db:studio` destrutivo contra prod.
3. **Preview = branch isolada por PR**: cada PR recebe sua própria Neon branch,
   então testar destrutivamente num Preview não toca o DB de produção. 👍
4. **Cold start**: depois de inatividade, a primeira query na Neon tem latência
   ~1s. Não bloqueie UI esperando — o app usa loading states; mantenha esse
   padrão em telas novas.

> 💡 Se um deploy de Preview falhar em ~20s com `BUILD_FAILED` e sem logs úteis,
> costuma ser quota de Neon branches estourada (uma branch por Preview).
> Apague branches velhas no painel da Neon e re-dispare o deploy.

## Vercel KV (Redis)

1. **Confirmar store linkada**: **Storage** deve listar o KV ligado ao projeto;
   as envs `KV_URL` / `KV_REST_API_*` aparecem como AUTO em Production e Preview.
2. Usado por **rate limit por usuário/dia** (Upstash Ratelimit sobre o KV) e
   pela **dedup do alerta de gasto** (uma notificação por dia UTC).
3. Sem essas envs em dev local, o rate limit **falha aberto** (não limita) — de
   propósito: a proteção de custo só importa em prod, onde as envs existem.

## Plano Hobby vs Pro

A regra que importa é de **Terms of Service**, não de limite técnico: o plano
**Hobby é restrito a uso pessoal / não-comercial**. A Vercel define uso
comercial como qualquer deployment com fim de ganho financeiro de qualquer
envolvido — pedir/processar pagamento de visitantes, anúncios (ex.: AdSense)
etc. Pedir doação **não** conta como comercial.

| Critério | Hobby | Pro |
| --- | --- | --- |
| Preço | Grátis | ~US$ 20 / membro / mês + uso acima do crédito incluso |
| Uso permitido (ToS) | Pessoal / não-comercial | Comercial OK |
| Limites de build/função | Generosos pra tráfego baixo | Bem mais altos |
| Suporte | Comunidade | E-mail |

> ⚠️ Preços e limites mudam. Confira no link (valores mudam):
> [Vercel Pricing](https://vercel.com/pricing) · [plano Hobby](https://vercel.com/docs/plans/hobby) ·
> [Fair Use — Commercial Usage](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage).

> ✅ **DECISÃO (sua):** ficar no **Hobby** ou ir pro **Pro**?
> **Recomendação default: ficar no Hobby na Fase 2.** O Palpiteiro **não aceita
> dinheiro nem opera apostas** (gera recomendação + tracking de Yield
> hipotético; aposta real é feita fora, em plataformas `.bet.br` — ver
> [`05-legal-compliance.md`](./05-legal-compliance.md)). Sem monetização e com
> tráfego baixo de você + amigos, o uso é não-comercial e o Hobby tende a servir
> confortavelmente.
> **Ponto a confirmar:** a leitura de "não-comercial" é da Vercel, e o texto do
> ToS pode evoluir — leia o [ToS atual](https://vercel.com/legal/terms) e o
> [Fair Use](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage)
> antes de decidir. **Se um dia monetizar (Fase 3, não planejada) → Pro.**
> Risco de ficar no Hobby achando que é comercial: a Vercel pode desabilitar o
> projeto. Pra um side project pessoal de amigos, baixo — mas é a sua chamada.

## Deploy de produção + verificação

1. **Disparar o deploy de produção**: faça push pra `main` (ou, no painel,
   **Deployments**, abra o último de produção e **Redeploy**; ou **Promote** um
   Preview testado pra Production). O build roda `drizzle-kit migrate && next build`
   — confira nos logs que a migration aplicou sem erro.
2. **Conferir o domínio**: o deploy de Production deve estar servindo no domínio
   custom (não só no `*.vercel.app`). Abra `https://seudominio...`.
3. **Verificação básica:**
   - `GET /` **sem sessão** → redireciona pra `/signin` (o app exige auth).
   - `GET /signin` → carrega o formulário de e-mail.
   - Submeter um e-mail **whitelisted** → recebe magic link → loga → home com
     suas predições. (Em modo teste do Resend, "whitelisted" = o e-mail da sua
     própria conta Resend — ver [`03-email-resend.md`](./03-email-resend.md) e
     [`../runbooks/auth-setup.md`](../runbooks/auth-setup.md).)
   - Submeter e-mail **não-whitelisted** → sem e-mail + `/signin?error=AccessDenied`.
4. **Claim do admin (1x)**: se ainda não fez, rode `pnpm db:claim-admin` contra
   o DB de **prod** e relogue uma vez (pro JWT carregar `role: "admin"`).
   Passo a passo em [`../runbooks/auth-setup.md`](../runbooks/auth-setup.md).
5. **Smoke dos crons (opcional)**: bater manualmente em
   `/api/cron/settle-predictions` **sem** o header deve dar 401 (prova que o
   `CRON_SECRET` está ativo). Não force a rota com o secret só pra testar se ela
   roda análise — settlement é idempotente, mas evite ruído.

> ⚠️ **Custo Anthropic é dinheiro real.** Rodar uma análise repetidas vezes em
> prod só pra "ver funcionando" queima tokens. Verifique o fluxo de auth e UI;
> deixe a análise de LLM pra um caso de uso real. Se precisar testar análise,
> ligue o `DAILY_AI_SPEND_ALERT_USD` pra ser avisado de pico.

## Próximos passos

- [`01-dominio.md`](./01-dominio.md) — comprar o domínio e apontar o DNS (pré-requisito do passo 1).
- [`03-email-resend.md`](./03-email-resend.md) — sair do modo teste do Resend pra mandar magic link pros amigos (precisa do domínio).
- [`04-observabilidade.md`](./04-observabilidade.md) — Sentry do zero, logs, uptime; e o threshold do alerta de gasto.
- [`07-checklist-go-live.md`](./07-checklist-go-live.md) — checklist final de produção pra Fase 2.
- [`../runbooks/auth-setup.md`](../runbooks/auth-setup.md) — detalhe do setup de auth, claim do admin e modo teste do Resend.
- [`../decisions/0007-auth-multiuser-jwt-env-whitelist.md`](../decisions/0007-auth-multiuser-jwt-env-whitelist.md) — o *porquê* da whitelist por env + JWT.

### Fontes (confirme nos links — valores mudam)

- [Vercel — Environment Variables](https://vercel.com/docs/environment-variables)
- [Vercel — Managing env vars across environments](https://vercel.com/docs/environment-variables/manage-across-environments)
- [Vercel — Hobby Plan](https://vercel.com/docs/plans/hobby)
- [Vercel — Pricing](https://vercel.com/pricing)
- [Vercel — Fair Use: Commercial Usage](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage)
- [Vercel — Terms of Service](https://vercel.com/legal/terms)
