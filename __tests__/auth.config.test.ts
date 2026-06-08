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
