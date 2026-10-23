import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MARK_BALL_PATCHES, MARK_FRAME } from "@/components/brand/brand-mark";
import {
  PARROT_BEAK,
  PARROT_BODY,
  ParrotMascot,
} from "@/components/brand/parrot-mascot";

/**
 * Mascote (ADR 0068, #640). A bola do olho e a trave são as do símbolo da marca, e o
 * estado parado (sem animação) é o papagaio: é o que fica com prefers-reduced-motion.
 */

describe("desenho", () => {
  const html = renderToStaticMarkup(<ParrotMascot />);

  it("papagaio no ladrilho azul do tema, decorativo", () => {
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(
      '<g class="text-primary"><rect width="100" height="100" rx="22" fill="currentColor"'
    );
    expect(html).toContain(`d="${PARROT_BODY}"`);
    expect(html).toContain(`d="${PARROT_BEAK}"`);
  });

  it("a bola e a trave são as mesmas do símbolo da marca", () => {
    expect(html).toContain(`d="${MARK_FRAME}"`);
    for (const d of MARK_BALL_PATCHES)
      expect(html).toContain(`d="${d}" fill="currentColor"`);
  });

  it("o olho respira com movimento reduzido", () => {
    expect(html).toContain('class="parrot-eye palpite-calm"');
  });
});

describe("estado parado em globals.css", () => {
  const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
  // Só as regras próprias do seletor (precedidas de "}"), não o grupo
  // `.parrot-hop, .parrot-eye, ...`; falha se o seletor sumir, em vez de passar vazio.
  const rule = (sel: string) => {
    const re = new RegExp(`\\}\\n\\${sel} \\{([^}]*)\\}`, "g");
    const bodies = [...css.matchAll(re)].map((m) => m[1]);
    expect(bodies.length, `${sel} sem regra própria em globals.css`).toBeGreaterThan(0);
    return bodies.join("\n");
  };

  it("sem animação, aparece só o papagaio: bola e trave escondidas", () => {
    expect(rule(".parrot-ball")).toContain("opacity: 0");
    expect(rule(".parrot-goal")).toContain("opacity: 0");
    expect(rule(".parrot-body")).not.toContain("opacity");
    expect(rule(".parrot-eye")).not.toContain("opacity");
  });
});

describe("pulinho a cada passo", () => {
  let container: HTMLDivElement;
  let root: Root;
  const animate = vi.fn();

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    animate.mockClear();
    (SVGElement.prototype as unknown as { animate: typeof animate }).animate =
      animate;
  });
  const originalMatchMedia = window.matchMedia;
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (SVGElement.prototype as unknown as { animate?: unknown }).animate;
    window.matchMedia = originalMatchMedia;
  });

  const reduced = (matches: boolean) => {
    window.matchMedia = (() => ({
      matches,
    })) as unknown as typeof window.matchMedia;
  };

  it("pula quando o beat sobe, não quando fica igual ou volta", () => {
    reduced(false);
    act(() => root.render(<ParrotMascot beat={0} />));
    expect(animate).not.toHaveBeenCalled();
    act(() => root.render(<ParrotMascot beat={1} />));
    expect(animate).toHaveBeenCalledTimes(1);
    act(() => root.render(<ParrotMascot beat={1} />));
    act(() => root.render(<ParrotMascot beat={0} />));
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("com movimento reduzido não pula", () => {
    reduced(true);
    act(() => root.render(<ParrotMascot beat={0} />));
    act(() => root.render(<ParrotMascot beat={2} />));
    expect(animate).not.toHaveBeenCalled();
  });
});
