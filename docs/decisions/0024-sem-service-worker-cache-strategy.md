# ADR 0024 — Sem service worker: cache-control no documento + version-poll com banner

**Data:** 2026-06-14  
**Status:** Aceito

## Contexto

O app não é PWA e não tem service worker nem manifest. O `next.config.ts` estava praticamente vazio (`{}`): nenhum `Cache-Control` era setado no documento HTML, o build id era aleatório a cada deploy, e nada expunha a versão/commit corrente ao cliente.

O sintoma concreto: no iOS, o Safari segura o HTML (e, por tabela, referências a assets antigos) por **dias** após um deploy — usuários ficam numa versão velha sem perceber, inclusive ao reabrir uma aba que estava em background ou ao voltar via gesto (back/forward), onde o **bfcache** serve a página em memória sem revalidar nada.

## Decisão

**Não** adotar service worker / PWA. Em vez disso, quatro peças complementares:

1. **Cache-control duro no documento HTML** — `Cache-Control: no-cache, must-revalidate` via `headers()` no `next.config.ts`. O `source` (`/:path((?!_next/|api/|monitoring(?:/|$)).*)`) exclui explicitamente os assets content-hashed de `_next/` (servidos `immutable` pela Vercel — sobrescrever clobbaria o cache imutável e mataria a performance), a `/api/*` (a `/api/version` manda seu próprio `no-store`) e o túnel do Sentry `/monitoring`. Em `headers()` o lookahead negativo precisa estar pendurado num param nomeado (`/:path(...)`), diferente do matcher do middleware (`/((?!...).*)`).
2. **Build id determinístico** do `VERCEL_GIT_COMMIT_SHA` via `generateBuildId` (fallback `null` = id aleatório default do Next em dev/local).
3. **SHA exposto ao cliente** por dois caminhos: `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` (mapeada de `VERCEL_GIT_COMMIT_SHA` em `next.config.ts`, **inlinada no bundle em build-time** — é a âncora da versão carregada) e a rota `GET /api/version` (`no-store`, `force-dynamic` — lê a env do deploy **vivo** por request).
4. **Detector no cliente** (`components/version-checker.tsx`) que polla `/api/version` em intervalo (60s, só com aba visível), em `visibilitychange`/`focus`, e em `pageshow` com `event.persisted` (caso bfcache). Quando o SHA vivo difere do carregado, mostra um **banner dismissível** "nova versão disponível — recarregar" com **ação explícita** do usuário. A comparação é uma função pura testável (`lib/version/compare.ts`).

## Alternativas consideradas

| Opção | Descarte |
|---|---|
| Service worker / PWA (`skipWaiting` + unregister) | Complexidade desproporcional pra side project solo: gestão do ciclo de vida do SW, risco de cache preso, debugging difícil. O ganho (offline) não é requisito. |
| Só HTTP cache-control, sem detector no cliente | Não cobre o bfcache do Safari nem a aba aberta por dias: a página em memória nunca re-busca o documento até um trigger explícito. O `pageshow`/`visibilitychange` é justamente o que fecha esse buraco. |
| Auto-reload silencioso ao detectar versão nova | Descarta um form meio preenchido sem aviso — UX ruim. Banner com ação explícita preserva o trabalho do usuário. |
| Expor o SHA via `__NEXT_DATA__` em vez de `env` pública | O codebase já lê `NEXT_PUBLIC_*` via `process.env.*` inline (`instrumentation-client.ts`); a env mapeada é o caminho idiomático e mínimo. |

## Consequências

- **Documento sempre revalida**: custo de um GET condicional por navegação — trivial. Em troca, deploy novo aparece pro usuário em vez de ficar preso dias.
- **Assets hashed continuam `immutable`**: o `source` exclui `_next/` inteiro (static + image), então não há regressão de performance de assets.
- **O SHA do commit é público** em `/api/version` e no bundle (`NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`): info de baixo risco, aceito em #260.
- **Duas fontes de verdade intencionais**: o SHA carregado é **assado em build-time** (muda só com redeploy); a `/api/version` lê o SHA **vivo** por request (`force-dynamic`). É exatamente essa divergência que detecta o deploy novo.
- **Invariante de inlining**: o `version-checker` precisa ler `process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` como **membro literal direto** — destructuring/chave computada não inlina e o detector viraria no-op silencioso. Não refatorar essa leitura.
- **Dev local é no-op**: sem `VERCEL_GIT_COMMIT_SHA`, o SHA cai no sentinela `"dev"` e o detector não polla nem renderiza banner.
- **Banner abaixo do overlay de nav** (`z-40` vs `z-50` do Sheet/Dialog do shadcn): não prende o drawer da MobileNav. Polish visual fica pra um passo `/impeccable` posterior.
- **Ponto de revisão (favicon/ícones estáticos)**: hoje não há `public/` nem ícone de metadata (`app/favicon.*`/`icon.*`), então o `source` não pega nenhum estático além de `_next/`. Se um ícone estático for adicionado, o `source` casaria `/favicon.ico` (etc.) e mandaria `no-cache, must-revalidate` nele em vez de cache longo. Ao adicionar, estender o lookahead negativo (ex.: `|favicon\.ico|icon|apple-icon`).
- **Ponto de revisão (PWA)**: se um dia o app virar PWA/offline-first, este ADR é o lugar pra reabrir a decisão.
