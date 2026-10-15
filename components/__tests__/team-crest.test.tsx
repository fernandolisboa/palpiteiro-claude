import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { TeamCrest } from "@/components/team-crest";
import type { Team } from "@/lib/view/types";

const CREST = "https://media.api-sports.io/football/teams/121.png";
const CREST_2 = "https://media.api-sports.io/football/teams/127.png";
const PAL: Team = { name: "Palmeiras", short: "PAL", hue: 145, crestUrl: CREST };

// Getters do <img> no jsdom, sobrescritos por teste (o jsdom não carrega imagem).
const proto = HTMLImageElement.prototype;
const original = {
  complete: Object.getOwnPropertyDescriptor(proto, "complete"),
  naturalWidth: Object.getOwnPropertyDescriptor(proto, "naturalWidth"),
};
function stubImage(complete: boolean, naturalWidth: number) {
  Object.defineProperty(proto, "complete", { configurable: true, get: () => complete });
  Object.defineProperty(proto, "naturalWidth", { configurable: true, get: () => naturalWidth });
}

let root: Root | null = null;
async function mount(team: Team, size = 22) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<TeamCrest team={team} size={size} />);
  });
  return container;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  for (const [key, desc] of Object.entries(original)) {
    if (desc) Object.defineProperty(proto, key, desc);
    else delete (proto as unknown as Record<string, unknown>)[key];
  }
});

describe("TeamCrest (#578)", () => {
  it("com crestUrl renderiza o <img> decorativo, lazy e sem referrer", () => {
    const html = renderToStaticMarkup(<TeamCrest team={PAL} size={22} />);
    expect(html).toContain(`src="${CREST}"`);
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).toContain('alt=""');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('width="22"');
    expect(html).toContain('height="22"');
    expect(html).not.toContain("rounded-full");
  });

  it("com priority, loading eager", () => {
    const html = renderToStaticMarkup(<TeamCrest team={PAL} size={56} priority />);
    expect(html).toContain('loading="eager"');
  });

  it("sem crestUrl cai no monograma", () => {
    const html = renderToStaticMarkup(
      <TeamCrest team={{ ...PAL, crestUrl: undefined }} size={56} />,
    );
    expect(html).not.toContain("<img");
    expect(html).toMatch(/>\s*PAL\s*</);
  });

  it("com flagCode usa a bandeira mesmo havendo crestUrl", () => {
    const html = renderToStaticMarkup(
      <TeamCrest team={{ ...PAL, flagCode: "br" }} size={22} />,
    );
    expect(html).toContain('src="/flags/wc/br.svg"');
    expect(html).not.toContain(CREST);
  });

  it("onError troca pro monograma", async () => {
    stubImage(false, 0);
    const c = await mount(PAL, 56);
    const img = c.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(CREST);
    await act(async () => {
      img.dispatchEvent(new Event("error"));
    });
    expect(c.querySelector("img")).toBeNull();
    expect(c.textContent).toBe("PAL");
  });

  it("erro antes da hidratação (complete && naturalWidth 0) também cai no monograma", async () => {
    stubImage(true, 0);
    const c = await mount(PAL, 56);
    expect(c.querySelector("img")).toBeNull();
    expect(c.textContent).toBe("PAL");
  });

  it("imagem já carregada (naturalWidth > 0) fica", async () => {
    stubImage(true, 64);
    const c = await mount(PAL);
    expect(c.querySelector("img")?.getAttribute("src")).toBe(CREST);
  });

  it("trocar o crestUrl depois de uma falha volta a tentar a imagem", async () => {
    stubImage(false, 0);
    const c = await mount(PAL, 56);
    await act(async () => {
      c.querySelector("img")!.dispatchEvent(new Event("error"));
    });
    expect(c.querySelector("img")).toBeNull();
    await act(async () => {
      root!.render(<TeamCrest team={{ ...PAL, crestUrl: CREST_2 }} size={56} />);
    });
    expect(c.querySelector("img")?.getAttribute("src")).toBe(CREST_2);
  });
});
