import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// "Atualizar placar" usa o router do App Router (router.refresh).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { MatchHero } from "@/components/match-hero";
import type { MatchHeroView } from "@/lib/view/types";

function heroView(): MatchHeroView {
  return {
    id: "m1",
    home: { name: "Brasil", short: "BRA", hue: 120 },
    away: { name: "Argentina", short: "ARG", hue: 210 },
    league: "wc",
    kickoff: "em 2h",
    when: "hoje, 18:00",
    odds: null,
    hasPrediction: false,
    status: "scheduled",
    isInProgress: false,
    homeScore: null,
    awayScore: null,
  };
}

// Após extrair a LiveBadge compartilhada (#385), o pill do hero deixa de ser
// in-line e passa a usar "AO VIVO" (era "LIVE"). Guarda o refactor + o gate.
describe("MatchHero — pill ao vivo (#385)", () => {
  it("status='live' renderiza o pulso (animate-pulse + warn-fg + 'AO VIVO')", () => {
    const html = renderToStaticMarkup(
      <MatchHero view={heroView()} status="live" />,
    );
    expect(html).toContain("animate-pulse");
    expect(html).toContain("text-warn-fg");
    expect(html).toContain("AO VIVO");
  });

  it("status='scheduled' NÃO renderiza pill ao vivo", () => {
    const html = renderToStaticMarkup(
      <MatchHero view={heroView()} status="scheduled" />,
    );
    expect(html).not.toContain("animate-pulse");
    expect(html).not.toContain("AO VIVO");
  });
});

describe("MatchHero — placar parcial (#574)", () => {
  it("com liveScore e sem placar final: mostra o parcial e a legenda, sem 'encerrado'", () => {
    const html = renderToStaticMarkup(
      <MatchHero
        view={{
          ...heroView(),
          status: "live",
          liveScore: { home: 2, away: 1, caption: "parcial · atualizado há 2h" },
        }}
        status="live"
      />,
    );
    expect(html).toMatch(/2<span[^>]*>–<\/span>1/);
    expect(html).toContain("parcial · atualizado há 2h");
    expect(html).not.toContain("encerrado");
    expect(html).not.toContain(">vs<");
  });

  it("placar final tem prioridade e mantém 'encerrado'", () => {
    const html = renderToStaticMarkup(
      <MatchHero
        view={{
          ...heroView(),
          liveScore: { home: 2, away: 1, caption: "parcial" },
        }}
        status="finished"
        score={{ home: 3, away: 1 }}
      />,
    );
    expect(html).toContain("encerrado");
    expect(html).not.toContain("parcial");
  });
});

describe("MatchHero — estado ao vivo (#580)", () => {
  const live = {
    home: 1,
    away: 0,
    caption: "63' · atualizado há 20 s",
    live: true as const,
    red: { home: 0, away: 2 },
    ended: false,
  };

  it("placar, minuto com idade, expulsões (form-loss) e 'Atualizar placar'", () => {
    const html = renderToStaticMarkup(
      <MatchHero
        view={{ ...heroView(), status: "live", liveScore: live }}
        status="live"
        live={{ note: null }}
      />,
    );
    expect(html).toMatch(/1<span[^>]*>–<\/span>0/);
    expect(html).toContain("63&#x27; · atualizado há 20 s");
    // Texto para o leitor de tela (sr-only), não um aria-label que ele ignora.
    expect(html).toContain('<span class="sr-only"> (2 expulsos)</span>');
    expect(html).not.toMatch(/aria-label="\d+ expulsos?"/);
    expect(html).not.toContain("1 expulso");
    expect(html).toContain("bg-form-loss-fg");
    expect(html).toContain("Atualizar placar");
    // Alvo de toque de 44px no celular.
    expect(html).toMatch(/<button[^>]*min-h-11[^>]*>[\s\S]*?Atualizar placar/);
    expect(html).toContain("AO VIVO");
  });

  it("sem placar ao vivo utilizável: 'placar ao vivo indisponível' sob o vs", () => {
    const html = renderToStaticMarkup(
      <MatchHero
        view={{ ...heroView(), isInProgress: true }}
        status="live"
        live={{ note: "placar ao vivo indisponível" }}
      />,
    );
    expect(html).toContain(">vs<");
    expect(html).toContain("placar ao vivo indisponível");
    expect(html).toContain("Atualizar placar");
  });

  it("fim de jogo pelo provider: sem o selo AO VIVO", () => {
    const html = renderToStaticMarkup(
      <MatchHero
        view={{
          ...heroView(),
          isInProgress: true,
          liveScore: {
            ...live,
            caption: "fim de jogo · atualizado há 20 s",
            ended: true,
          },
        }}
        status="live"
      />,
    );
    expect(html).not.toContain("AO VIVO");
    expect(html).toContain("fim de jogo");
  });

  it("sem `live` (flag desligada / pré-jogo): sem botão de atualizar", () => {
    const html = renderToStaticMarkup(<MatchHero view={heroView()} />);
    expect(html).not.toContain("Atualizar placar");
    expect(html).not.toContain("expulso");
  });
});
