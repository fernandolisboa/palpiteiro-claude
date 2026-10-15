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
 * Nenhuma rota fica de fora. O `/_not-found` já foi liberado aqui (404 legível sem JS),
 * mas sem JS ele saía sem o menu da conta e com o tema errado; desde o #574 o
 * `app/not-found.tsx` é dinâmico, e este check derruba o build se ele voltar a ser
 * estático. Allowlist mantida (vazia) pra uma exceção futura documentada.
 */
export const STATIC_GATED_ALLOWLIST: readonly string[] = [];

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
