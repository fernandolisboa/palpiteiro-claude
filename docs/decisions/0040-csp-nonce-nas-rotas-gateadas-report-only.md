# ADR 0040 — CSP: nonce nas rotas gateadas, estática nas públicas, report-only primeiro

## Status

Accepted (2026-09-24) — fecha a Fase 1 do #467 (report 01 achado #2, CSP deferida no PR #462).
Fase 2 (enforce) em 2026-10-01 — ver §Promoção executada.

## Contexto

O PR #462 shipou os headers de segurança do #436 **exceto CSP**. O App Router injeta
scripts inline (bootstrap + payload RSC `self.__next_f.push`), então uma CSP útil precisa
de nonce, e o padrão documentado do Next gera o nonce no middleware por request. Nonce
tem um custo que o padrão não diz em voz alta: a página precisa ser renderizada **por
request**, o que desliga static/ISR.

Isso bate de frente com duas superfícies públicas:

- `/p/[id]` depende de ISR + CDN como escudo de custo contra link viral (ADR 0035
  §Consequências).
- a landing `/` e as páginas legais são estáticas.

Ao mesmo tempo, o middleware deste app **só roda nas rotas gateadas** (o matcher exclui
as públicas), e essas rotas já são dinâmicas porque leem a sessão. Pra elas, o nonce
não custa nada.

## Decisão

1. **Duas variantes da mesma política**, geradas por um único builder
   (`lib/security/csp.ts`):
   - **Gateadas** (o matcher do middleware casa): `script-src 'self' 'nonce-…'
     'strict-dynamic'`, nonce de 128 bits por request, emitido por
     `lib/security/gated-response.ts`. O nonce vai no header da request (o Next lê de lá
     e carimba os próprios scripts) e no da response.
   - **Públicas** (`/`, `/signin`, `/como-funciona`, `/termos`, `/privacidade`,
     `/p/[id]`): `script-src 'self' 'unsafe-inline'`, estática via `headers()` do
     `next.config.ts`. Não há sessão renderizada nessas páginas nem sink de HTML cru
     (React escapa tudo; os únicos `dangerouslySetInnerHTML` são o JSON-LD da landing, que não executa, e o script anti-flash do next-themes).
   - O resto é igual nas duas: `default-src 'self'`, `object-src 'none'`,
     `base-uri 'self'`, `frame-ancestors 'none'`, `connect-src 'self'` (o Sentry vai
     pelo túnel `/monitoring`), `img-src 'self' data: blob: https:` (avatar de perfil é
     URL https arbitrária), `form-action 'self' https://accounts.google.com` (POST nativo
     do botão Google antes da hidratação).
2. **Report-only primeiro.** Header `Content-Security-Policy-Report-Only`, com
   `report-uri` apontando pro endpoint de security reports do Sentry derivado do DSN
   público (`/api/<project>/security/?sentry_key=…&sentry_environment=…`). Sem DSN, a
   política vai sem `report-uri`.
3. **Script do next-themes por hash.** O script inline anti-flash do tema não recebe o
   nonce (passá-lo exigiria ler `headers()` na root layout, o que tornaria `/` e `/p`
   dinâmicas). Ele entra por `'sha256-…'` só na variante com nonce (na pública, um hash
   desligaria o `'unsafe-inline'`). As props do provider moram em `lib/theme.ts` e um
   teste recalcula o hash do script renderizado, então drift quebra o CI.
4. **Cobertura travada por teste.** `__tests__/csp-coverage.test.ts` varre
   `app/**/page.tsx` e exige que cada página caia em exatamente uma variante (gateada
   pelo matcher XOR listada em `PUBLIC_HTML_SOURCES`).
5. **Gate de auth reescrito no handler.** Passar um handler pro `auth()` do Auth.js v5
   desliga o redirect default de não-autenticado (o `authorized` só manda quando retorna
   uma `Response`). `gatedResponse` refaz o 307 → `/signin?callbackUrl=<href>` idêntico
   ao do Auth.js, com teste.

## Promoção a enforce

Depois de pelo menos uma semana de tráfego real sem violações inesperadas no Sentry
(filtro de issues do tipo CSP):

- trocar `CSP_HEADER` pra `Content-Security-Policy` (uma linha; o Next lê o nonce dos dois);
- manter a variante pública com `'unsafe-inline'` enquanto `/p/[id]` depender de ISR.
  Endurecê-la exigiria hashes por página (inviável com o payload RSC inline) ou abrir
  mão do cache, o que reverte o ADR 0035.

Violações esperadas durante o report-only, que não pedem mudança: extensões de browser
(`chrome-extension://`, `moz-extension://`) e a toolbar da Vercel (`vercel.live`) em
deploys de preview.

## Promoção executada (2026-10-01)

`CSP_HEADER` virou `Content-Security-Policy`. Não houve leitura dos reports do Sentry (o
ambiente de agente não tem acesso); a checagem foi um `next build` local com a CSP em
enforce, rodando no Chromium as páginas que abrem sem banco. Ela achou três problemas
que o report-only escondia, corrigidos junto:

1. **Página gateada estática fica sem JS.** O Next só carimba o nonce em HTML renderizado
   por request; `/como-usar` (#537) saía pré-renderizada, e com `'strict-dynamic'` o
   browser bloqueava TODOS os scripts dela, chunks incluídos. Virou `force-dynamic`, e o
   `pnpm build` agora roda `scripts/check-csp-prerender.ts`, que derruba o build se o
   `prerender-manifest` tiver rota casada pelo matcher. Exceção: `/_not-found` (404
   default do Next pra URL desconhecida de quem está logado), que funciona sem JS.
2. **O hash do script de tema não batia em prod.** O next-themes monta o script com
   `Function.toString()` e o `next build` re-minifica a função, então o texto em prod
   difere do que o teste renderizava; o anti-flash era bloqueado em toda página gateada.
   O script do next-themes foi desligado (`scriptProps.type = "text/plain"`, bloco de
   dados) e a root layout renderiza `THEME_SCRIPT` (lib/theme.ts), string literal que o
   build não altera. `lib/theme.test.ts` compara o comportamento com o original do
   next-themes; `lib/security/csp.test.tsx` recalcula o hash.
3. **Zod 4 sonda `eval`.** Na primeira validação de objeto no browser o Zod testa
   `Function("")` pra decidir o JIT; a falha é silenciosa, mas vira report de violação a
   cada carga de página. `instrumentation-client.ts` liga `jitless`.

Rollback: voltar `CSP_HEADER` pra `Content-Security-Policy-Report-Only` (uma linha).

## Consequências

- **(+)** Scripts injetados nas rotas com dado de usuário ficam sem execução quando
  promovermos a enforce, sem custo de render (já eram dinâmicas).
- **(+)** Clickjacking, `<base>` injection e plugins ficam cobertos pela política nas
  duas variantes (`X-Frame-Options: DENY` segue como cinto).
- **(−)** A variante pública só protege contra host externo de script, não contra script
  inline. Aceito: não há sink de HTML nessas páginas e o custo da alternativa é o cache
  do `/p`.
- **(−)** Rota pública nova precisa entrar em dois lugares (matcher e
  `PUBLIC_HTML_SOURCES`); o teste de cobertura quebra se esquecer.

## Alternativas consideradas

1. **Nonce em tudo** (middleware em todas as rotas): rejeitado, porque força render
   dinâmico de `/p/[id]` e da landing e derruba o escudo de custo do ADR 0035.
2. **Hashes/SRI** (`experimental.sri`): cobre só os arquivos de script, não o payload
   RSC inline, que muda a cada render.
3. **Só a variante estática com `'unsafe-inline'` em tudo**: mais simples, mas não
   protege contra script inline em nenhuma rota, o que era o ponto do #467.
