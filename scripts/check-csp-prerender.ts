/**
 * Pós-build (#467, ADR 0040): falha se alguma página GATEADA saiu pré-renderizada.
 *
 * O middleware manda a CSP com nonce + `'strict-dynamic'` pras rotas gateadas, mas o
 * HTML estático foi gerado no build, sem nonce — com a CSP em enforce a página fica sem
 * JS. Corrigir tornando a página dinâmica (`export const dynamic = "force-dynamic"` ou
 * lendo a sessão), não liberando aqui.
 *
 * Roda no `pnpm build` (o build da Vercel), depois do `next build`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  findStaticGatedRoutes,
  gatedMatcherRegex,
} from "../lib/security/gated-routes";

type PrerenderManifest = {
  routes: Record<string, unknown>;
  dynamicRoutes: Record<string, unknown>;
};

const manifest = JSON.parse(
  readFileSync(join(process.cwd(), ".next", "prerender-manifest.json"), "utf8")
) as PrerenderManifest;

const matcher = gatedMatcherRegex();
const offenders = findStaticGatedRoutes(
  [...Object.keys(manifest.routes), ...Object.keys(manifest.dynamicRoutes)],
  (path) => matcher.test(path)
);

if (offenders.length > 0) {
  console.error(
    `CSP (#467): página gateada pré-renderizada sem nonce — ficaria sem JS com a CSP em enforce:\n` +
      offenders.map((r) => `  - ${r}`).join("\n") +
      `\nTorne a página dinâmica (export const dynamic = "force-dynamic").`
  );
  process.exit(1);
}
console.log("CSP (#467): nenhuma página gateada pré-renderizada.");
