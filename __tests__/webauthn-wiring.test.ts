import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Importa SÓ o config edge (`@/auth.config`) + o provider standalone. NÃO importar
// `@/auth` (Node), que puxa o DrizzleAdapter / Neon / @simplewebauthn/server e
// exigiria env de DB. As asserções do lado Node são por leitura do source —
// mesmo padrão dos guards em __tests__/auth.config.test.ts.
import { authConfig } from "@/auth.config";
import WebAuthn from "next-auth/providers/webauthn";

/**
 * Guarda de fiação do passkey/WebAuthn (#263, ADR 0023).
 *
 * Trava três invariantes load-bearing:
 *  1. O provider WebAuthn RESOLVE na versão instalada do @auth/core (prova que a
 *     fundação existe e que @simplewebauthn/* v9 satisfaz o import) — `.type` é
 *     "webauthn" mesmo quando o `id` é customizado ("passkey").
 *  2. O provider + flag `enableWebAuthn` vivem no `auth.ts` (Node, junto do
 *     adapter), NUNCA no edge — se vazasse pro middleware, o adapter +
 *     @simplewebauthn/server (Node-only) quebrariam o bundle edge.
 *  3. O config edge não contém NENHUM provider (continua `providers: []`).
 *
 * NÃO testa a cerimônia WebAuthn (startRegistration/verify): exige browser/WebAuthn
 * API, fora de escopo.
 */
describe("WebAuthn/passkey — guarda de fiação (#263)", () => {
  it("o provider WebAuthn resolve na versão instalada (type 'webauthn')", () => {
    // id customizado "passkey" não muda o `.type` — o `signIn` cliente valida por
    // `.type === "webauthn"`, então o id é só a chave/URL.
    const provider = WebAuthn({ id: "passkey" });
    expect(provider.type).toBe("webauthn");
    expect(provider.id).toBe("passkey");
  });

  it("o config edge não registra nenhum provider (providers: [])", () => {
    expect(authConfig.providers).toEqual([]);
  });

  it("auth.config.ts (edge) NÃO importa nem registra WebAuthn", () => {
    const source = readFileSync(join(process.cwd(), "auth.config.ts"), "utf8");
    expect(source).not.toMatch(/webauthn/i);
    expect(source).not.toMatch(/enableWebAuthn/);
  });

  it("auth.ts (Node) registra o provider WebAuthn e liga enableWebAuthn", () => {
    const source = readFileSync(join(process.cwd(), "auth.ts"), "utf8");
    expect(source).toMatch(/from "next-auth\/providers\/webauthn"/);
    expect(source).toMatch(/WebAuthn\(/);
    expect(source).toMatch(/enableWebAuthn:\s*true/);
    // a tabela de credenciais entra no DrizzleAdapter
    expect(source).toMatch(/authenticatorsTable:\s*authenticators/);
  });

  it("middleware.ts importa só o config edge (sem WebAuthn/adapter)", () => {
    const source = readFileSync(join(process.cwd(), "middleware.ts"), "utf8");
    expect(source).not.toMatch(/webauthn/i);
    expect(source).not.toMatch(/from "@\/auth"/);
  });
});
