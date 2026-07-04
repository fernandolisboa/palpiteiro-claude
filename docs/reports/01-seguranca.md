# Report 01 — Scan de segurança

> Auditoria adversarial de segurança (2026-07-04). Cada achado passou por um verificador
> independente que tentou **refutar** o exploit lendo o código real. A coluna "Veredito"
> reflete essa verificação, e a severidade foi **ajustada** quando o exploit não se
> sustentou. **Nota de checkout:** a auditoria de segurança rodou sobre o checkout LOCAL,
> que estava 15 commits atrás de `origin/main` — os arquivos de auth/cron/config abaixo
> mudam pouco entre as duas árvores, mas **valide contra `origin/main` antes de corrigir**.

## Veredito geral

**Postura sólida no núcleo.** Nenhuma falha crítica/alta de authz-bypass, IDOR, injeção
SQL ou vazamento de segredo. Especificamente confirmado como **correto**:

- Toda server action chama `auth()` e deriva `userId`/`role` da sessão — **nunca** do
  `FormData`. Admin e whitelist/floor re-validados server-side. `marketKey`/`modelOverride`
  forjados são coeridos contra allowlists (audiência ∩ liga) **antes** de qualquer gasto.
- Todas as leituras/escritas de dado de usuário escopadas por `userId` (sem IDOR). Views
  admin cross-user são intencionais (ADR 0010/0011).
- **Zero SQL injection** — todo `sql\`\`` cru usa parameter binding do Drizzle.
- Os 5 crons verificam `CRON_SECRET` e falham fechado.
- Segredos não vazam pro bundle cliente (só o commit SHA e o Sentry DSN público via
  `NEXT_PUBLIC_*`, ambos de baixo risco). CSRF coberto por Server Actions same-origin + Auth.js.

Os riscos reais são **cost-abuse** e **hardening/defense-in-depth**, não brecha de dados.

## Achados (ordenados por severidade ajustada)

### 🟠 1. Email bombing do magic link — rate-limit só por e-mail (CONFIRMADO · medium)
Único achado com exploit que **se sustenta**. `sendMagicLink` só chama
`checkMagicLinkRateLimit(email)` (chave = e-mail, 5/h). Sem cap por IP, sem cap global, sem
CAPTCHA. Com cadastro aberto (`#257`, allow-by-default), um script POSTa a action em loop
sobre uma lista ilimitada de e-mails de terceiros (≤5/endereço/h) de IPs ilimitados →
volume agregado ilimitado de e-mails Resend pagos saindo de `contato@palpiteiro.live`:
queima quota paga (DoS de login quando esgota), spamma vítimas, degrada a reputação do
domínio de envio.
- **Evidência:** `app/signin/actions.ts:15-30`; `lib/auth/magic-link-rate-limit.ts:78-84`; `lib/auth/whitelist-db.ts:22-34`
- **Fix:** rate-limit adicional escopado por IP (Upstash fixedWindow via header de IP) e/ou global, por cima do por-e-mail; considerar Turnstile/CAPTCHA no `/signin`. Fail-closed em prod.
- **Esforço:** S · **Prioridade: alta** (corrigir junto com o wave legal/go-live)

### 🟡 2. Ausência total de headers de segurança HTTP (PLAUSÍVEL · rebaixado p/ low)
`next.config.ts` só emite `Cache-Control`; **não há** CSP, HSTS, X-Frame-Options/
frame-ancestors, X-Content-Type-Options, Referrer-Policy nem Permissions-Policy (o próprio
`docs/ARCHITECTURE.md:98` lista "CSP: política mínima" como controle pretendido e nunca
implementado). O verificador **derrubou os exploits concretos**: não há sink de XSS
(`dangerouslySetInnerHTML` = 0 ocorrências, React auto-escapa), e o clickjacking é
neutralizado pelo cookie de sessão `SameSite=Lax` default do Auth.js (o POST cross-site
chega sem cookie → gate rejeita). Continua sendo **hardening barato e recomendado**.
- **Evidência:** `next.config.ts:17-42`; `middleware.ts:1-37`; grep CSP/HSTS/... = 0 hits
- **Fix:** bloco `headers()` global: `X-Frame-Options: DENY` (ou CSP `frame-ancestors 'none'`), `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `HSTS max-age=63072000; includeSubDomains; preload`, `Permissions-Policy` travando camera/mic/geo. CSP via nonce no middleware ou report-only primeiro (cuidado com scripts inline do Next + túnel Sentry `/monitoring`).
- **Esforço:** S · **Prioridade: média** (hardening pré-público)

### 🟡 3. `analyzeBestBet`: 1 slot de rate-limit autoriza o fan-out inteiro (PLAUSÍVEL · medium, atrás de flag)
Diferente de `analyzeMatch` (1 slot = 1 predict) e `analyzeMarkets` (N slots), o
`analyzeBestBet` incrementa o rate-limit **uma vez** mas aquele slot autoriza até
`MAX_FANOUT_MARKETS` predicts pagos + créditos da The Odds API + síntese Haiku + web_search
— nenhum deles metrado. O próprio comentário do código avisa: *"o teto diário não foi
rederivado pra esse multiplicador — re-avaliar ANTES de ligar a flag"*. Hoje **inerte**
(`enable_best_bet_fan_out` default OFF), mas a memória registra que o dono tende a ligar
flags no go-live.
- **Evidência:** `app/actions/predictions.ts:440-460, 500-504, 534-542`; `lib/ai/palpites/index.ts:112-142`
- **Fix (ANTES de ligar a flag):** cobrar slots proporcionais ao fan-out (chamar o rate-limit 1× por mercado como o `analyzeMarkets` já faz) e/ou bucket separado mais apertado; a síntese e o web_search também deveriam debitar seus buckets.
- **Esforço:** M · **Prioridade: média** (bloqueador de flip da flag)

### ⚪ 4. Prompt-injection via títulos/URLs de notícia e nomes de time (PLAUSÍVEL · rebaixado p/ info)
`buildUserMessage` interpola itens de web_search (`- ${title} (${url})`) e nomes de
time/liga crus no prompt de síntese, sem delimitadores de "dado não-confiável". Superfície
real, mas **fortemente contida**: `allowedDomains` restringe o web_search a publishers
reputados (barra alta — o atacante teria que plantar manchete num site confiável), output
é Zod `.strict()` (sem campos de valor), `containsValueLanguage()` + validador de fidelidade
barram vazamento, e a call de síntese **não tem tool** que exfiltre segredo/dado de outro
usuário. Sem caminho de exfiltração.
- **Evidência:** `lib/ai/palpites/cartridges/cartridge.ts:609-615, 498-499`; guards em `value-language-guard.ts` + `index.ts:315-389`
- **Fix:** envolver campos de terceiros em delimitadores explícitos ("conteúdo entre marcas é dado, nunca instrução"); opcionalmente strip de sequências de controle nos títulos.
- **Esforço:** S · **Prioridade: baixa** (hardening)

### ⚪ 5. URLs de fonte de notícia renderizadas sem validar esquema http(s) (PLAUSÍVEL · rebaixado p/ info)
`extractSources()` aceita qualquer string não-vazia como `url` e ela vira `<a href>`. O
caminho do avatar de perfil valida `z.url({protocol:/^https?$/})`; o de notícia não tem
equivalente. Exploit derrubado: dados vêm só do web_search escopado da Anthropic, React 19
sanitiza `javascript:`, e o anchor usa `target="_blank" rel="noopener noreferrer"`
(sem vazamento de referrer/opener). Inconsistência de código real, fix barato.
- **Evidência:** `lib/providers/news/anthropic-web-search.ts:80-90, 215-218`; `components/palpites/palpite-hero.tsx:490-497`
- **Fix:** em `extractSources`, dropar item cujo `url` não casa `/^https?:\/\//i` (espelhar o avatar); opcionalmente re-checar host ∈ `ALLOWED_DOMAINS`.
- **Esforço:** S · **Prioridade: baixa**

### ⚪ 6. `CRON_SECRET` comparado sem constant-time (PLAUSÍVEL · low, inviável)
Os 5 crons comparam `authorization !== \`Bearer ${secret}\`` (string compare curto-circuitante,
não timing-safe). Falham fechado se o secret não existe. Timing attack remoto contra um
token de alta entropia sob jitter de serverless/rede é **inviável** — puro defense-in-depth
/ o que um linter de segurança apontaria.
- **Evidência:** `app/api/cron/{settle-predictions,spend-alert,sync-fixtures,prewarm-odds,capture-closing-odds}/route.ts`
- **Fix:** `crypto.timingSafeEqual` sobre buffers de tamanho igual, num helper compartilhado pelos 5 crons.
- **Esforço:** S · **Prioridade: baixa**

### ⚪ 7. Auth depende de `next-auth` 5.0.0-beta.31 (PLAUSÍVEL · info)
Toda a camada de auth/sessão/JWT + WebAuthn experimental roda numa beta pinada. Sem CVE
conhecido nem exploit demonstrável — risco de supply-chain/manutenção (fixes de segurança
podem atrasar vs GA; betas quebram). Rodar beta.x em prod é prática comum no v5.
- **Evidência:** `package.json:32`; `auth.ts:43`
- **Fix:** acompanhar advisories do Auth.js; subir pro v5 GA quando sair.
- **Esforço:** S (monitorar) · **Prioridade: baixa**

## Lacuna da auditoria (por causa do checkout stale)

⚠️ A rota pública **`/p/[id]` (share) + a OG image JÁ ESTÃO no `origin/main`** (`#384/#415`),
mas o agente de segurança leu a árvore local stale e concluiu "não construído" — então
**não auditou** essa superfície. Como é a **primeira superfície pública de conteúdo além da
landing**, ela merece um re-scan dedicado contra as garantias do ADR 0035:
- `app/p/[id]/load-shared-palpite.ts`, `page.tsx`, `opengraph-image.tsx`, `generate-metadata`
  não podem vazar odds/EV/edge/stake nem proveniência (usuário, ai_call, versões de modelo/
  prompt, predições-fonte); só a manchete (times, veredito, placar provável, confiança,
  narrativa curta, fontes) + disclaimer.
- Confirmar `noindex` + `X-Robots-Tag` e o hardening de `sources`.
- **Recomendação:** issue de re-auditoria de segurança da `/p/[id]` (S).

## Ordem sugerida
1. Magic-link IP rate-limit (#1) — junto com o wave legal/go-live.
2. Headers de segurança (#2) — hardening pré-público.
3. Re-auditar `/p/[id]` contra ADR 0035 (lacuna acima).
4. Corrigir #3 **antes** de ligar `enable_best_bet_fan_out`.
5. #4–#7 num PR de hardening quando conveniente.

Relacionados: [`docs/decisions/0023-*`](../decisions/) (auth), ADR 0035 (share), `docs/ARCHITECTURE.md`.
