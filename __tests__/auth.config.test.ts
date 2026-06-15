import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// IMPORTANTE: importa SÓ o config edge (`@/auth.config`). NÃO importar `@/auth`,
// que puxa o DrizzleAdapter / Neon e exigiria env de DB pra rodar o teste.
import { authConfig } from "@/auth.config";

/**
 * Guarda de regressão do bug `MissingAdapter` (PR fix/auth-missingadapter-middleware).
 *
 * Sintoma: um provider que exige adapter (type "email", ex.: Resend) estava no
 * `auth.config.ts` edge. O `assertConfig` do @auth/core roda em TODA invocação de
 * `Auth()` — inclusive a leitura de sessão que o middleware faz a cada navegação —
 * e exige um adapter sempre que há provider de email/webauthn. O edge não tem
 * adapter, então isso disparava `MissingAdapter`: o middleware abortava antes de
 * decodificar o cookie e toda rota protegida virava loop de redirect pro /signin.
 *
 * Correção: esses providers vivem só no `auth.ts` (Node), junto do adapter. Este
 * teste falha se alguém re-adicionar um provider type "email"/"webauthn" ao config
 * edge — exatamente o que causou o outage.
 */

// Providers do Next.js podem vir como objeto (com `.type`) ou como factory
// (função que retorna o config). Resolvemos ambos pra ler o `type`.
function resolveProviderType(provider: unknown): string | undefined {
  const resolved = typeof provider === "function" ? (provider as () => unknown)() : provider;
  if (resolved && typeof resolved === "object" && "type" in resolved) {
    return (resolved as { type?: unknown }).type as string | undefined;
  }
  return undefined;
}

const ADAPTER_REQUIRING_TYPES = new Set(["email", "webauthn"]);

describe("auth.config (edge) — guarda MissingAdapter", () => {
  it("não contém nenhum provider que exija adapter (type email/webauthn)", () => {
    const offendingTypes = authConfig.providers
      .map(resolveProviderType)
      .filter((type): type is string => type !== undefined && ADAPTER_REQUIRING_TYPES.has(type));

    expect(offendingTypes).toEqual([]);
  });
});

/**
 * Guarda da fronteira DB-in-edge (ADR 0009).
 *
 * O signIn DB-aware (whitelist em tabela) lê o DB e vive SÓ no `auth.ts` (Node).
 * Se um refactor re-adicionasse um signIn DB-backed — ou qualquer import de
 * `@/lib/db` / `whitelist-db` — ao `auth.config.ts` edge, o cliente Neon entraria
 * no bundle do middleware: compila, passa todos os testes atuais, e só quebra em
 * runtime no edge (a mesma classe de outage que o teste MissingAdapter acima
 * previne). Estes asserts travam essa fronteira.
 */
describe("auth.config (edge) — guarda DB-in-edge (ADR 0009)", () => {
  it("não define o callback signIn no config edge (o DB-aware vive no auth.ts Node)", () => {
    // `satisfies NextAuthConfig` dá a `callbacks` um tipo literal sem a chave
    // `signIn`; checamos a ausência pela lista de chaves (type-safe).
    expect(Object.keys(authConfig.callbacks ?? {})).not.toContain("signIn");
  });

  it("não importa código de DB (whitelist-db / @/lib/db)", () => {
    // vitest roda na raiz do repo; o config edge vive em ./auth.config.ts.
    const source = readFileSync(join(process.cwd(), "auth.config.ts"), "utf8");
    expect(source).not.toMatch(/whitelist-db/);
    expect(source).not.toMatch(/@\/lib\/db/);
  });

  it("não referencia o gate de signIn DB-aware do #257 (vive no auth.ts Node)", () => {
    // O signIn DB-aware do self-provision aberto (#257) lê o DB por e-mail via
    // `isSignInAllowed` → `getUserAllowedByEmail`. Se qualquer um vazasse pro
    // config edge, o cliente Neon entraria no bundle do middleware (mesma classe
    // de outage do teste MissingAdapter). Travamos pela ausência de ambos.
    const source = readFileSync(join(process.cwd(), "auth.config.ts"), "utf8");
    expect(source).not.toMatch(/isSignInAllowed/);
    expect(source).not.toMatch(/getUserAllowedByEmail/);
  });

  it("não revalida role/allowed contra o DB no jwt() edge (#252/ADR 0023: vive no auth.ts Node)", () => {
    // A revalidação de role+allowed por request (#252) lê o DB e DEVE morar no
    // override do jwt() em auth.ts (Node). Se vazasse pro config edge, o cliente
    // Neon entraria no bundle do middleware (mesma classe de outage do teste
    // MissingAdapter). Travamos pela ausência da query/helper de revalidação.
    const source = readFileSync(join(process.cwd(), "auth.config.ts"), "utf8");
    expect(source).not.toMatch(/getUserAccessState/);
    expect(source).not.toMatch(/jwt-revalidate/);
  });

  it("não registra o provider Google no config edge (OAuth vive no auth.ts Node — ADR 0023)", () => {
    // O provider Google mora no auth.ts (Node), junto do adapter. Mantê-lo fora
    // do edge evita puxar o DrizzleAdapter pro bundle do middleware. Lemos o
    // source porque importar @/auth (Node) exigiria env de DB no sandbox.
    const source = readFileSync(join(process.cwd(), "auth.config.ts"), "utf8");
    expect(source).not.toMatch(/providers\/google/);
  });
});

/**
 * Guarda do provider Google (issue #256, ADR 0023).
 *
 * O provider OAuth Google vive no `auth.ts` (Node), com
 * `allowDangerousEmailAccountLinking: true` (e-mail Google verificado → linka ao
 * mesmo `users` do magic link). Importar `@/auth` aqui puxaria o DrizzleAdapter /
 * Neon e exigiria env de DB; por isso afirmamos por leitura do source, mesmo
 * padrão `readFileSync` dos guards acima.
 */
describe("auth.ts (Node) — provider Google (#256)", () => {
  it("registra o provider Google com allowDangerousEmailAccountLinking", () => {
    const source = readFileSync(join(process.cwd(), "auth.ts"), "utf8");
    expect(source).toMatch(/from "next-auth\/providers\/google"/);
    // Asserts independentes (não regex posicional): o Google() pode receber
    // clientId/clientSecret explícitos ANTES da flag no futuro — o guard só exige
    // que ambos existam, não a ordem das chaves.
    expect(source).toMatch(/Google\(/);
    expect(source).toMatch(/allowDangerousEmailAccountLinking:\s*true/);
  });
});
