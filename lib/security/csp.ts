/**
 * Content-Security-Policy do app (#467, report 01 achado #2, ADR 0040).
 *
 * Fase 1 = REPORT-ONLY: o browser avalia a política e reporta violações pro Sentry,
 * mas não bloqueia nada. Promover a enforce = trocar `CSP_HEADER` depois que os
 * reports de prod estiverem limpos (ADR 0040 §Promoção).
 *
 * Duas variantes, mesma política exceto `script-src`:
 *  - rotas GATEADAS (middleware): nonce por request + `'strict-dynamic'`. Essas rotas
 *    já são dinâmicas (leem a sessão), então o nonce não custa cache. O Next lê o nonce
 *    do header de CSP da REQUEST (inclusive `-report-only`) e o aplica nos próprios
 *    scripts inline.
 *  - rotas PÚBLICAS (next.config headers): estática com `'unsafe-inline'`. Nonce exige
 *    render dinâmico por request, o que mataria o cache de CDN do snapshot `/p/[id]`
 *    (escudo de custo do ADR 0035) e a landing estática. Nessas páginas não há sessão
 *    renderizada nem sink de HTML cru (report 01: zero `dangerouslySetInnerHTML`).
 */

/**
 * Sources (sintaxe de `headers()` do next.config) das páginas PÚBLICAS que levam a
 * variante estática — exatamente as rotas de HTML que o matcher do middleware.ts NÃO
 * gateia. As gateadas recebem a variante com nonce no middleware; manter os dois
 * conjuntos disjuntos evita duas políticas no mesmo response. Guardado por
 * __tests__/csp-coverage.test.ts — rota pública nova entra aqui E no matcher.
 */
export const PUBLIC_HTML_SOURCES = [
  "/",
  "/:path(signin|como-funciona|termos|privacidade)",
  "/p/:id",
] as const;

// Fase 1. Trocar por "Content-Security-Policy" pra enforce (o Next lê os dois).
export const CSP_HEADER = "Content-Security-Policy-Report-Only";

type CspOptions = {
  /** Nonce base64 por request (rotas gateadas). Sem nonce → variante estática. */
  nonce?: string;
  isDev?: boolean;
  /** Endpoint de report (Sentry security). Omitido quando não há DSN. */
  reportUri?: string | null;
};

export function buildCsp({ nonce, isDev = false, reportUri }: CspOptions = {}) {
  const scriptSrc = nonce
    ? ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"]
    : ["'self'", "'unsafe-inline'"];
  // React Refresh / webpack dev usam eval.
  if (isDev) scriptSrc.push("'unsafe-eval'");

  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["script-src", scriptSrc],
    // Atributos `style={}` do React e os <style> do next/font são inline — nonce em
    // style-src desligaria o 'unsafe-inline' e quebraria os atributos.
    ["style-src", ["'self'", "'unsafe-inline'"]],
    // Avatar de perfil é URL https arbitrária (components/user-avatar.tsx); o resto é local.
    ["img-src", ["'self'", "data:", "blob:", "https:"]],
    ["font-src", ["'self'", "data:"]],
    // Sentry passa pelo túnel same-origin `/monitoring`; nada de fetch cross-origin.
    ["connect-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    // O botão Google é server action: sem JS (antes da hidratação) vira POST nativo com
    // 303 pro consent do Google, que `form-action` também avalia.
    ["form-action", ["'self'", "https://accounts.google.com"]],
    ["frame-ancestors", ["'none'"]],
  ];
  if (reportUri) directives.push(["report-uri", [reportUri]]);

  return directives.map(([k, v]) => `${k} ${v.join(" ")}`).join("; ");
}

/**
 * Endpoint de security reports do Sentry derivado do DSN público:
 * `https://<key>@<host>/<project>` → `https://<host>/api/<project>/security/?sentry_key=<key>`.
 * DSN ausente/malformado → null (a política vai sem report-uri; o browser só loga no console).
 */
export function sentryCspReportUri(
  dsn: string | undefined,
  environment?: string
): string | null {
  if (!dsn) return null;
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }
  const projectId = url.pathname.replace(/^\/+|\/+$/g, "");
  if (!url.username || !/^\d+$/.test(projectId)) return null;
  const params = new URLSearchParams({ sentry_key: url.username });
  if (environment) params.set("sentry_environment", environment);
  return `${url.protocol}//${url.host}/api/${projectId}/security/?${params}`;
}

/** Nonce de 128 bits em base64 — Web Crypto (roda no edge, sem Buffer). */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/** Política pro ambiente atual (env de build/runtime). */
export function cspForEnv(nonce?: string): string {
  return buildCsp({
    nonce,
    isDev: process.env.NODE_ENV === "development",
    reportUri: sentryCspReportUri(
      process.env.NEXT_PUBLIC_SENTRY_DSN,
      process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV
    ),
  });
}
