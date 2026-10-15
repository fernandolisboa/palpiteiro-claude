import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { MatchRow } from "@/components/match-row";
import { UpcomingMatchesDesktop } from "@/components/upcoming-matches-desktop";
import type { MatchRowView } from "@/lib/view/types";

// GOLDEN dos chips de odds over/under da lista de jogos (#173 PR-2): MatchRow (celular) e
// UpcomingMatchesDesktop. Desvia DE PROPÓSITO do idiom de substring do repo (toContain):
// a igualdade FULL-STRING é o ponto. Ids do Radix (`useId`) são normalizados pra não
// flakar; todo o resto fica pinado. O caso do OddsCard saiu junto com o card (#576: a
// página do jogo lê as odds pela tabela de mercados).
function normalizeMarkup(html: string): string {
  return html
    .replace(/radix-[^"'\s>]+/g, "radix-ID")
    .replace(/:r[0-9a-z]+:/gi, ":rID:");
}

function ouMatch(): MatchRowView {
  return {
    id: "golden-1",
    home: { name: "Casa FC", short: "CAS", hue: 120 },
    away: { name: "Fora FC", short: "FOR", hue: 210 },
    league: "wc",
    kickoff: "10 jun, 16:00",
    when: "amanhã",
    odds: {
      outcomes: [
        { label: "Over", odd: "1.92" },
        { label: "Under", odd: "2.05" },
      ],
    },
    hasPrediction: false,
    status: "scheduled",
    isInProgress: false,
    homeScore: null,
    awayScore: null,
  };
}

describe("GOLDEN over/under — chips da lista de jogos (#173)", () => {
  it("MatchRow chip over/under (mobile)", () => {
    const html = normalizeMarkup(
      renderToStaticMarkup(<MatchRow m={ouMatch()} last />),
    );
    // #385: o campo isInProgress (false p/ scheduled) NÃO pode injetar a badge ao
    // vivo no DOM pinado — guarda a byte-paridade contra um `true` acidental futuro.
    expect(html).not.toContain("animate-pulse");
    expect(html).not.toContain("AO VIVO");
    expect(html).not.toContain("ao vivo");
    expect(html).toMatchInlineSnapshot(`"<a class="block px-5 py-4 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset" href="/match/golden-1"><div class="flex items-center justify-between gap-3 pb-2.5"><div class="flex items-center gap-2"><span data-slot="badge" data-variant="outline" class="inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border py-0.5 font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&amp;&gt;svg]:pointer-events-none [&amp;&gt;svg]:size-3 border-border [a&amp;]:hover:bg-accent [a&amp;]:hover:text-accent-foreground h-[18px] px-2 text-meta uppercase tracking-label text-muted-foreground">Copa do Mundo</span></div><span class="font-mono text-meta tabular-nums text-muted-foreground">10 jun, 16:00</span></div><div class="flex items-center justify-between gap-3"><div class="flex min-w-0 flex-col gap-1"><div class="flex items-center gap-2"><div aria-hidden="true" class="border-border inline-flex items-center justify-center rounded-full border font-medium" style="width:22px;height:22px;background:oklch(var(--ta-bg-l) 0.04 120);color:oklch(var(--ta-fg-l) 0.04 120)"></div><span class="truncate text-label font-medium tracking-tight">Casa FC</span></div><div class="flex items-center gap-2"><div aria-hidden="true" class="border-border inline-flex items-center justify-center rounded-full border font-medium" style="width:22px;height:22px;background:oklch(var(--ta-bg-l) 0.04 210);color:oklch(var(--ta-fg-l) 0.04 210)"></div><span class="truncate text-label font-medium tracking-tight">Fora FC</span></div></div><div class="flex shrink-0 items-center gap-2"><div class="flex flex-col items-end gap-1 text-body-sm"><span><span class="text-muted-foreground">Over</span> <span class="font-mono tabular-nums">1.92</span></span><span><span class="text-muted-foreground">Under</span> <span class="font-mono tabular-nums">2.05</span></span></div><span class="ml-1 text-muted-fg-2"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-right size-3.5" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg></span></div></div></a>"`);
  });

  it("UpcomingMatchesDesktop chip over/under (desktop)", () => {
    const html = normalizeMarkup(
      renderToStaticMarkup(<UpcomingMatchesDesktop matches={[ouMatch()]} />),
    );
    expect(html).toMatchInlineSnapshot(`"<div data-slot="card" class="flex flex-col rounded-xl border bg-card text-card-foreground shadow-sm gap-0 overflow-hidden p-0"><div class="grid grid-cols-[160px_1fr_160px_140px_40px] gap-4 border-b border-border px-5 py-3 text-meta uppercase tracking-label text-muted-foreground"><span>liga · kickoff</span><span>jogo</span><span class="text-right">odds</span><span class="text-right">status</span><span></span></div><a class="grid grid-cols-[160px_1fr_160px_140px_40px] items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset " href="/match/golden-1"><div class="flex flex-col gap-1"><span data-slot="badge" data-variant="outline" class="inline-flex shrink-0 items-center justify-center gap-1 overflow-hidden border py-0.5 font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&amp;&gt;svg]:pointer-events-none [&amp;&gt;svg]:size-3 border-border [a&amp;]:hover:bg-accent [a&amp;]:hover:text-accent-foreground h-[18px] text-meta w-fit rounded-full px-2 uppercase tracking-label text-muted-foreground">Copa do Mundo</span><span class="font-mono text-meta tabular-nums text-muted-foreground">10 jun, 16:00</span></div><div class="flex flex-col gap-1.5"><div class="flex items-center gap-2"><div aria-hidden="true" class="border-border inline-flex items-center justify-center rounded-full border font-medium" style="width:22px;height:22px;background:oklch(var(--ta-bg-l) 0.04 120);color:oklch(var(--ta-fg-l) 0.04 120)"></div><span class="text-label font-medium tracking-tight">Casa FC</span></div><div class="flex items-center gap-2"><div aria-hidden="true" class="border-border inline-flex items-center justify-center rounded-full border font-medium" style="width:22px;height:22px;background:oklch(var(--ta-bg-l) 0.04 210);color:oklch(var(--ta-fg-l) 0.04 210)"></div><span class="text-label font-medium tracking-tight">Fora FC</span></div></div><div class="flex flex-col items-end gap-1 text-body"><span><span class="text-muted-foreground">Over</span> <span class="font-mono tabular-nums">1.92</span></span><span><span class="text-muted-foreground">Under</span> <span class="font-mono tabular-nums">2.05</span></span></div><div class="flex flex-col items-end justify-center gap-1"><span class="text-meta text-muted-foreground">—</span></div><span class="justify-self-end text-muted-fg-2"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-right size-3.5" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg></span></a></div>"`);
  });
});
