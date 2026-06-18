import { describe, expect, it } from "vitest";

import { cn } from "@/lib/utils";

// Guard pro #333: os tokens custom de font-size do @theme (ADR 0029) precisam estar
// registrados no extendTailwindMerge (lib/utils.ts) pra NÃO serem classificados como
// COR. Se um token novo entrar no globals.css @theme sem ser adicionado lá, este teste
// falha — o token seria descartado ao competir com um `text-*` de cor (o bug que fez os
// badges renderizarem `text-xs` 12px em vez do tamanho pretendido). Manter em sincronia
// com os `--text-*` do @theme em app/globals.css.
const FONT_SIZE_TOKENS = [
  "text-eyebrow-xs",
  "text-eyebrow",
  "text-meta",
  "text-body-sm",
  "text-body",
  "text-label",
  "text-display-sm",
  "text-display-md",
  "text-display-lg",
];

describe("cn — tokens custom de font-size (extendTailwindMerge, #333)", () => {
  it.each(FONT_SIZE_TOKENS)(
    "%s sobrevive ao merge com um text-* de cor (não tratado como cor)",
    (token) => {
      const out = cn(token, "text-muted-foreground").split(" ");
      expect(out).toContain(token);
      expect(out).toContain("text-muted-foreground");
    },
  );

  it("eixo size do Badge: text-eyebrow vence o text-xs da base + cor do consumer (10px, não 12px)", () => {
    const out = cn("text-xs text-eyebrow", "text-muted-foreground").split(" ");
    expect(out).toContain("text-eyebrow");
    expect(out).not.toContain("text-xs");
  });

  it("dois tokens de font-size deduplicam (o último vence)", () => {
    const out = cn("text-display-sm", "text-display-md").split(" ");
    expect(out).toContain("text-display-md");
    expect(out).not.toContain("text-display-sm");
  });

  it("cor continua deduplicando normalmente (não quebrada pelo registro de font-size)", () => {
    const out = cn("text-edge-fg", "text-muted-foreground").split(" ");
    expect(out).toContain("text-muted-foreground");
    expect(out).not.toContain("text-edge-fg");
  });
});
