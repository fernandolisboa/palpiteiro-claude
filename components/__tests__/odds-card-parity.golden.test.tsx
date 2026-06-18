import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { OddsCard } from "@/components/odds-card";
import { MatchRow } from "@/components/match-row";
import { UpcomingMatchesDesktop } from "@/components/upcoming-matches-desktop";
import type { MatchRowView, OddsView } from "@/lib/view/types";

// GOLDEN de paridade over/under (#173 PR-2). Congela o DOM BYTE-A-BYTE do card +
// chips ANTES do refactor N-vias. Desvia DE PROPÓSITO do idiom de substring do
// repo (toContain) — aqui a igualdade FULL-STRING é o ponto: o refactor p/
// grid-cols-{n} / outcomes[] precisa reproduzir o n=2 byte-idêntico. Ids do Radix
// (`useId`) são normalizados pra não flakar; todo o resto fica pinado.
function normalizeMarkup(html: string): string {
  return html
    .replace(/radix-[^"'\s>]+/g, "radix-ID")
    .replace(/:r[0-9a-z]+:/gi, ":rID:");
}

// Shape N-vias (#173 PR-2). Os MESMOS valores lógicos do binário pré-refactor —
// o snapshot esperado abaixo é INALTERADO, então a igualdade prova byte-paridade.
const OU_VIEW: OddsView = {
  marketLabel: "Over/Under gols",
  outcomes: [
    { label: "Over 2.5", odd: "1.92", pct: "50.7%" },
    { label: "Under 2.5", odd: "2.05", pct: "49.3%" },
  ],
  bookmaker: "Bet365",
  overround: "4.5%",
  updatedAgo: "5 min",
};

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
    homeScore: null,
    awayScore: null,
  };
}

describe("GOLDEN over/under — paridade byte ANTES do refactor N-vias (#173)", () => {
  it("OddsCard over/under (header + 2 cells + footer)", () => {
    const html = normalizeMarkup(
      renderToStaticMarkup(<OddsCard view={OU_VIEW} />),
    );
    expect(html).toMatchInlineSnapshot(`"<div data-slot="card" class="flex flex-col rounded-xl border bg-card text-card-foreground shadow-sm gap-0 overflow-hidden p-0"><div class="flex items-center justify-between px-4 pt-3.5 pb-3"><div class="flex items-center gap-2"><span class="text-body font-medium tracking-tight">Odds atuais</span><span data-slot="badge" data-variant="outline" class="inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden border py-0.5 font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&amp;&gt;svg]:pointer-events-none [&amp;&gt;svg]:size-3 border-border [a&amp;]:hover:bg-accent [a&amp;]:hover:text-accent-foreground h-[17px] rounded-full px-2 text-eyebrow-xs text-muted-foreground">Over/Under gols</span></div><span class="font-mono text-eyebrow text-muted-foreground">atualizado há 5 min</span></div><div data-orientation="horizontal" role="none" data-slot="separator" class="shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px"></div><div class="grid grid-cols-2"><div class="flex flex-col gap-1 border-r border-border-subtle px-4 py-3.5"><span class="flex items-center gap-1.5 text-meta uppercase tracking-label text-muted-foreground">Over 2.5</span><span class="font-mono text-[22px] font-medium tabular-nums tracking-tight">1.92</span><span class="flex items-center gap-1 font-mono text-eyebrow tabular-nums text-muted-foreground">50.7% normalizada<button type="button" aria-label="Ajuda: prob. do mercado (normalizada)" class="inline-flex size-[15px] shrink-0 items-center justify-center rounded-full border border-border-subtle font-mono text-eyebrow-xs leading-none text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none" aria-haspopup="dialog" aria-expanded="false" aria-controls="radix-ID" data-state="closed" data-slot="popover-trigger">?</button></span></div><div class="flex flex-col gap-1 px-4 py-3.5"><span class="flex items-center gap-1.5 text-meta uppercase tracking-label text-muted-foreground">Under 2.5</span><span class="font-mono text-[22px] font-medium tabular-nums tracking-tight">2.05</span><span class="font-mono text-eyebrow tabular-nums text-muted-foreground">49.3% normalizada</span></div></div><div data-orientation="horizontal" role="none" data-slot="separator" class="shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px"></div><div class="flex items-center justify-between px-4 py-2.5 font-mono text-eyebrow text-muted-fg-2"><span>bookmaker · Bet365</span><span class="flex items-center gap-1 tabular-nums">overround 4.5%<button type="button" aria-label="Ajuda: overround" class="inline-flex size-[15px] shrink-0 items-center justify-center rounded-full border border-border-subtle font-mono text-eyebrow-xs leading-none text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none" aria-haspopup="dialog" aria-expanded="false" aria-controls="radix-ID" data-state="closed" data-slot="popover-trigger">?</button></span></div></div>"`);
  });

  it("MatchRow chip over/under (mobile)", () => {
    const html = normalizeMarkup(
      renderToStaticMarkup(<MatchRow m={ouMatch()} last />),
    );
    expect(html).toMatchInlineSnapshot(`"<a class="block px-5 py-4 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset" href="/match/golden-1"><div class="flex items-center justify-between gap-3 pb-2.5"><div class="flex items-center gap-2"><span data-slot="badge" data-variant="outline" class="inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border py-0.5 font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&amp;&gt;svg]:pointer-events-none [&amp;&gt;svg]:size-3 border-border [a&amp;]:hover:bg-accent [a&amp;]:hover:text-accent-foreground h-[18px] px-2 text-eyebrow uppercase tracking-label text-muted-foreground">Copa do Mundo</span></div><span class="font-mono text-meta tabular-nums text-muted-foreground">10 jun, 16:00</span></div><div class="flex items-center justify-between gap-3"><div class="flex min-w-0 flex-col gap-1"><div class="flex items-center gap-2"><div aria-hidden="true" class="border-border inline-flex items-center justify-center rounded-full border font-medium" style="width:22px;height:22px;background:oklch(var(--ta-bg-l) 0.04 120);color:oklch(var(--ta-fg-l) 0.04 120);font-size:7.92px;letter-spacing:-0.02em">CA</div><span class="truncate text-label font-medium tracking-tight">Casa FC</span></div><div class="flex items-center gap-2"><div aria-hidden="true" class="border-border inline-flex items-center justify-center rounded-full border font-medium" style="width:22px;height:22px;background:oklch(var(--ta-bg-l) 0.04 210);color:oklch(var(--ta-fg-l) 0.04 210);font-size:7.92px;letter-spacing:-0.02em">FO</div><span class="truncate text-label font-medium tracking-tight">Fora FC</span></div></div><div class="flex shrink-0 items-center gap-2"><div class="flex flex-col items-end gap-1 font-mono text-body-sm tabular-nums"><span><span class="text-muted-foreground">Over</span> 1.92</span><span><span class="text-muted-foreground">Under</span> 2.05</span></div><span class="ml-1 text-muted-fg-2"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-right size-3.5" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg></span></div></div></a>"`);
  });

  it("UpcomingMatchesDesktop chip over/under (desktop)", () => {
    const html = normalizeMarkup(
      renderToStaticMarkup(<UpcomingMatchesDesktop matches={[ouMatch()]} />),
    );
    expect(html).toMatchInlineSnapshot(`"<div data-slot="card" class="flex flex-col rounded-xl border bg-card text-card-foreground shadow-sm gap-0 overflow-hidden p-0"><div class="grid grid-cols-[160px_1fr_160px_140px_40px] gap-4 border-b border-border px-5 py-3 font-mono text-eyebrow uppercase tracking-label text-muted-foreground"><span>liga · kickoff</span><span>jogo</span><span class="text-right">odds</span><span class="text-right">status</span><span></span></div><a class="grid grid-cols-[160px_1fr_160px_140px_40px] items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset " href="/match/golden-1"><div class="flex flex-col gap-1"><span data-slot="badge" data-variant="outline" class="inline-flex shrink-0 items-center justify-center gap-1 overflow-hidden border py-0.5 font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&amp;&gt;svg]:pointer-events-none [&amp;&gt;svg]:size-3 border-border [a&amp;]:hover:bg-accent [a&amp;]:hover:text-accent-foreground h-[18px] text-eyebrow w-fit rounded-full px-2 uppercase tracking-label text-muted-foreground">Copa do Mundo</span><span class="font-mono text-meta tabular-nums text-muted-foreground">10 jun, 16:00</span></div><div class="flex flex-col gap-1.5"><div class="flex items-center gap-2"><div aria-hidden="true" class="border-border inline-flex items-center justify-center rounded-full border font-medium" style="width:22px;height:22px;background:oklch(var(--ta-bg-l) 0.04 120);color:oklch(var(--ta-fg-l) 0.04 120);font-size:7.92px;letter-spacing:-0.02em">CA</div><span class="text-label font-medium tracking-tight">Casa FC</span></div><div class="flex items-center gap-2"><div aria-hidden="true" class="border-border inline-flex items-center justify-center rounded-full border font-medium" style="width:22px;height:22px;background:oklch(var(--ta-bg-l) 0.04 210);color:oklch(var(--ta-fg-l) 0.04 210);font-size:7.92px;letter-spacing:-0.02em">FO</div><span class="text-label font-medium tracking-tight">Fora FC</span></div></div><div class="flex flex-col items-end gap-1 font-mono text-body tabular-nums"><span><span class="text-muted-foreground">Over</span> 1.92</span><span><span class="text-muted-foreground">Under</span> 2.05</span></div><div class="flex flex-col items-end justify-center gap-1"><span class="font-mono text-eyebrow text-muted-fg-2">—</span></div><span class="justify-self-end text-muted-fg-2"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-right size-3.5" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg></span></a></div>"`);
  });
});
