import { createHash } from "node:crypto";

import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/theme-provider";
import { ThemeScript } from "@/components/theme-script";
import { THEME_PROVIDER_PROPS } from "@/lib/theme";

import {
  buildCsp,
  cspForEnv,
  CSP_HEADER,
  generateNonce,
  sentryCspReportUri,
  THEME_SCRIPT_HASH,
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
      THEME_SCRIPT_HASH,
      "'strict-dynamic'",
    ]);
  });

  it("THEME_SCRIPT_HASH bate com o script de tema que a root layout renderiza", () => {
    // Drift aqui = o anti-flash do tema passaria a violar a CSP das rotas gateadas em
    // TODA view (tema errado até a hidratação). Atualize o hash.
    const html = renderToString(<ThemeScript />);
    const body = /<script[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
    expect(body).toBeTruthy();
    const hash = createHash("sha256")
      .update(body ?? "")
      .digest("base64");
    expect(THEME_SCRIPT_HASH).toBe(`'sha256-${hash}'`);
  });

  it("o script do próprio next-themes não executa (bloco de dados)", () => {
    // O next-themes monta o script por Function.toString(), que o build re-minifica:
    // o hash dele em prod não bate com o de teste. Por isso ele vai como text/plain.
    const html = renderToString(
      <ThemeProvider {...THEME_PROVIDER_PROPS}>
        <div />
      </ThemeProvider>
    );
    const tags = html.match(/<script[^>]*>/g) ?? [];
    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain('type="text/plain"');
  });

  it("variante estática NÃO leva o hash (desligaria o unsafe-inline)", () => {
    expect(buildCsp()).not.toContain("sha256-");
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

  it("fase 2 é enforce", () => {
    expect(CSP_HEADER).toBe("Content-Security-Policy");
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
