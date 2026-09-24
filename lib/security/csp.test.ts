import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildCsp,
  cspForEnv,
  CSP_HEADER,
  generateNonce,
  sentryCspReportUri,
} from "@/lib/security/csp";

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp.split("; ").map((d) => {
      const [name, ...values] = d.split(" ");
      return [name ?? "", values];
    })
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buildCsp", () => {
  it("variante com nonce: nonce + strict-dynamic, SEM unsafe-inline em script-src", () => {
    const d = directives(buildCsp({ nonce: "abc123==" }));
    expect(d.get("script-src")).toEqual([
      "'self'",
      "'nonce-abc123=='",
      "'strict-dynamic'",
    ]);
  });

  it("variante estática (páginas públicas): unsafe-inline, sem nonce", () => {
    const d = directives(buildCsp());
    expect(d.get("script-src")).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it("unsafe-eval só em dev", () => {
    expect(directives(buildCsp({ isDev: true })).get("script-src")).toContain(
      "'unsafe-eval'"
    );
    expect(buildCsp()).not.toContain("unsafe-eval");
  });

  it("diretivas de hardening fixas", () => {
    const d = directives(buildCsp());
    expect(d.get("default-src")).toEqual(["'self'"]);
    expect(d.get("object-src")).toEqual(["'none'"]);
    expect(d.get("base-uri")).toEqual(["'self'"]);
    expect(d.get("frame-ancestors")).toEqual(["'none'"]);
    // Sentry vai pelo túnel same-origin — nenhum host externo em connect-src.
    expect(d.get("connect-src")).toEqual(["'self'"]);
    expect(d.get("form-action")).toEqual([
      "'self'",
      "https://accounts.google.com",
    ]);
  });

  it("report-uri só quando informado", () => {
    expect(buildCsp()).not.toContain("report-uri");
    expect(
      directives(buildCsp({ reportUri: "https://r.example/x" })).get(
        "report-uri"
      )
    ).toEqual(["https://r.example/x"]);
  });

  it("fase 1 é report-only", () => {
    expect(CSP_HEADER).toBe("Content-Security-Policy-Report-Only");
  });
});

describe("sentryCspReportUri", () => {
  it("deriva o endpoint security do DSN", () => {
    expect(
      sentryCspReportUri("https://pubkey@o123.ingest.us.sentry.io/4567")
    ).toBe(
      "https://o123.ingest.us.sentry.io/api/4567/security/?sentry_key=pubkey"
    );
  });

  it("anexa o environment quando informado", () => {
    expect(
      sentryCspReportUri("https://k@o1.ingest.sentry.io/9", "preview")
    ).toBe(
      "https://o1.ingest.sentry.io/api/9/security/?sentry_key=k&sentry_environment=preview"
    );
  });

  it("null pra DSN ausente ou malformado", () => {
    for (const bad of [
      undefined,
      "",
      "not a url",
      "https://o1.ingest.sentry.io/9",
      "https://k@o1.ingest.sentry.io/abc",
    ]) {
      expect(sentryCspReportUri(bad), String(bad)).toBeNull();
    }
  });
});

describe("generateNonce", () => {
  it("base64 de 16 bytes, diferente a cada chamada", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(a).not.toBe(b);
  });
});

describe("cspForEnv", () => {
  it("usa o DSN público e o ambiente da Vercel", () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://k@o1.ingest.sentry.io/9");
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "production");
    expect(cspForEnv("n0nce")).toContain(
      "report-uri https://o1.ingest.sentry.io/api/9/security/?sentry_key=k&sentry_environment=production"
    );
    expect(cspForEnv("n0nce")).toContain("'nonce-n0nce'");
  });
});
