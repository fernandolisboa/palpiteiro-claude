import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Leitura do matcher do middleware.ts fora do runtime (testes e scripts de build, #467).
 * O `config.matcher` precisa ser literal no próprio middleware.ts (o Next o analisa
 * estaticamente), então ele é lido do texto do arquivo em vez de importado — importar o
 * middleware puxaria o Auth.js. Só a PRIMEIRA entrada gateia; a segunda (`"/"`) só
 * redireciona quem está logado na landing (ver `landingResponse`).
 */
export function gatedMatcherRegex(cwd: string = process.cwd()): RegExp {
  const source = readFileSync(join(cwd, "middleware.ts"), "utf8");
  const match = source.match(/matcher:\s*\[\s*"([^"]+)"/);
  if (!match?.[1]) throw new Error("não achei o matcher em middleware.ts");
  return new RegExp(`^${match[1].replace(/\\\\/g, "\\")}$`);
}

/**
 * Rotas pré-renderizadas que caem no matcher e por isso receberiam a CSP com nonce sem
 * ter o nonce no HTML. Com `'strict-dynamic'`, o browser ignora `'self'` e bloqueia
 * TODOS os scripts da página (inline do Next e chunks): a página não hidrata.
 *
 * `/_not-found` fica de fora de propósito: é o 404 default do Next, servido pra URL
 * desconhecida de quem está logado. Sem JS ele continua legível (HTML e links puros) e o
 * script de tema entra por hash, então não vale tornar o 404 dinâmico.
 */
export const STATIC_GATED_ALLOWLIST = ["/_not-found"] as const;

// Segmento dinâmico (`[id]`, `[...slug]`, `[[...slug]]`) vira um valor de exemplo pra testar o matcher.
const SAMPLE_SEGMENT = "3f2b8a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

export function findStaticGatedRoutes(
  prerenderedRoutes: readonly string[],
  isGated: (path: string) => boolean
): string[] {
  const allow = new Set<string>(STATIC_GATED_ALLOWLIST);
  return prerenderedRoutes.filter(
    (route) =>
      !allow.has(route) &&
      isGated(route.replace(/\[\[?[^/\]]+\]?\]/g, SAMPLE_SEGMENT))
  );
}
