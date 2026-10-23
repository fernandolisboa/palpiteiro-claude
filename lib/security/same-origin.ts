// POST de mutação fora de server action (ADR 0064): o Next confere a origem das server
// actions sozinho; numa rota /api a conferência é nossa. O navegador sempre manda
// `Origin` num fetch POST; sem ele, ou com outro host, recusa. Atrás do proxy da
// Vercel o host público vem em `x-forwarded-host` (o mesmo que o Next usa nas actions).
export function isSameOriginPost(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
