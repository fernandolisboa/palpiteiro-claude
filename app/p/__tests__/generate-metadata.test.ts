// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SharedPalpite } from "@/app/p/[id]/load-shared-palpite";

// Mock do loader — generateMetadata é testado contra o loader stubado.
// vi.hoisted: a fn precisa existir ANTES do vi.mock hoisted (senão TDZ no factory).
const { loadSharedPalpite } = vi.hoisted(() => ({ loadSharedPalpite: vi.fn() }));
vi.mock("@/app/p/[id]/load-shared-palpite", async (orig) => {
  const actual =
    await orig<typeof import("@/app/p/[id]/load-shared-palpite")>();
  return { ...actual, loadSharedPalpite };
});

import { generateMetadata } from "@/app/p/[id]/page";
import { NEUTRAL_DESCRIPTION } from "@/app/p/[id]/load-shared-palpite";

const SHARED: SharedPalpite = {
  view: {
    verdict: "VEREDITO-NUNCA-NA-METADATA",
    probableScore: { home: 2, away: 1 },
    confidence: "media",
    narrative: "n",
    citedMarkets: [],
    badge: null,
    dimensions: [],
  },
  match: {
    homeTeam: "Palmeiras",
    awayTeam: "Corinthians",
    league: "brasileirao_a",
    finalScore: null,
  },
};

const params = Promise.resolve({ id: "11111111-1111-1111-1111-111111111111" });

beforeEach(() => {
  loadSharedPalpite.mockReset();
});

describe("generateMetadata — robots + description neutra em AMBOS os branches", () => {
  it("branch DATA: noindex/nofollow + og:title times + description neutra (sem veredito)", async () => {
    loadSharedPalpite.mockResolvedValue(SHARED);
    const meta = await generateMetadata({ params });
    const json = JSON.stringify(meta);

    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.description).toBe(NEUTRAL_DESCRIPTION);
    expect(meta.openGraph?.title).toBe("Palmeiras x Corinthians");
    expect(meta.openGraph?.description).toBe(NEUTRAL_DESCRIPTION);
    // @ts-expect-error twitter.card existe em runtime
    expect(meta.twitter?.card).toBe("summary_large_image");

    // O VEREDITO nunca entra na metadata.
    expect(json).not.toContain("VEREDITO-NUNCA-NA-METADATA");
    // A description "Recomendações de aposta" da root layout NUNCA cascateia.
    expect(json).not.toContain("Recomendações de aposta");
  });

  it("branch NO-DATA: noindex/nofollow + description neutra (não cai na root 'Recomendações de aposta')", async () => {
    loadSharedPalpite.mockResolvedValue(null);
    const meta = await generateMetadata({ params });
    const json = JSON.stringify(meta);

    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.description).toBe(NEUTRAL_DESCRIPTION);
    expect(json).not.toContain("Recomendações de aposta");
  });
});
