// Artefato puro da imagem OG do /p (ADR 0035 §4/§9 / #384). É o subtree EXATO que entra no
// `new ImageResponse(...)` da rota opengraph-image — e é o artefato que os testes de
// firewall/privacidade renderizam (renderToStaticMarkup), fechando o gap do "teste sobre a
// const de input": uma edição futura que interpole view.narrative/match.id/view.sources
// direto na <div> FALHA o teste, porque ele assere sobre a ÁRVORE renderizada.
//
// EXAUSTIVIDADE (firewall BLOCKER 2): a árvore JSX não tem NENHUM literal de texto além de
// separadores ("·") e iniciais de time; todo nó de texto vem de `Object.values(pieces)`.
// O componente NUNCA desestrutura view.sources / view.narrative / view.citedMarkets nem a
// row crua de match — eles são estruturalmente ausentes da imagem.
//
// GUARD DE RENDER (firewall BLOCKER 1): buildOgTextPieces roda `unsafeForPublic`
// (lib/view/share/public-text-guard.ts) sobre `view.verdict` — containsValueLanguage
// (denylist de 13 termos) NÃO basta porque não bane "%" nem um preço solto ("2.10"). A imagem vira PNG permanente que nenhum check downstream
// lê, então um hit degrada pra forma SEM VEREDITO (times + placar + disclaimer), nunca
// assando um preço no PNG.

import type { PalpiteHeadlineView } from "@/lib/view/palpites-headline";
import { OG_DISCLAIMER_STRIP } from "@/lib/view/share/disclaimer";
import { unsafeForPublic } from "@/lib/view/share/public-text-guard";

// Rótulo qualitativo da confiança — definido LOCAL (não importado do palpite-hero.tsx, que é
// "use client" e arrasta analyzeBestBet). Firewall-safe: palavra, nunca dígito/%.
const CONFIDENCE_LABEL: Record<PalpiteHeadlineView["confidence"], string> = {
  baixa: "confiança baixa",
  media: "confiança média",
  alta: "confiança alta",
};

export type OgTextPieces = {
  // Veredito GUARDADO: a prosa do LLM se passar o guard estrito, senão "" (forma sem veredito).
  verdict: string;
  // Placar provável "home–away" (en-dash). É o placar PREVISTO (inteiros 0–20), nunca uma odd.
  probableScore: string;
  // Rótulo qualitativo da confiança (palavra).
  confidence: string;
  // "Mandante x Visitante".
  teams: string;
  // Iniciais (≤2) de cada time pro chip (flags não rasterizam no Satori).
  homeInitials: string;
  awayInitials: string;
  // A tira de disclaimer comprimida (18+ · …).
  disclaimer: string;
};

// Iniciais ≤2 de um nome de time — Satori não rasteriza /flags/*.svg, então o chip é
// iniciais sRGB. Fallback robusto pra string vazia (nunca deve acontecer).
function initialsOf(short: string): string {
  return short.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "··";
}

// Monta as peças de texto da imagem a partir da view + nomes/short de time já resolvidos.
// `homeName`/`awayName` são os nomes de exibição; `homeShort`/`awayShort` as siglas pro chip.
export function buildOgTextPieces(
  view: PalpiteHeadlineView,
  match: {
    homeName: string;
    awayName: string;
    homeShort: string;
    awayShort: string;
  },
): OgTextPieces {
  // GUARD (defesa em profundidade — o loader já 404a veredito inseguro): a imagem é PNG
  // irrevogável, então um hit aqui cai pra forma sem-veredito ("").
  const verdict = unsafeForPublic(view.verdict) ? "" : view.verdict;
  return {
    verdict,
    // Placar PREVISTO (inteiros) com en-dash — case /^\d{1,2}[–-]\d{1,2}$/, nunca decimal.
    probableScore: `${view.probableScore.home}–${view.probableScore.away}`,
    confidence: CONFIDENCE_LABEL[view.confidence],
    teams: `${match.homeName} x ${match.awayName}`,
    homeInitials: initialsOf(match.homeShort),
    awayInitials: initialsOf(match.awayShort),
    disclaimer: OG_DISCLAIMER_STRIP,
  };
}

// Chip de iniciais sRGB neutro (Satori não resolve OKLCH; flags não rasterizam).
function InitialsChip({ initials }: { initials: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 96,
        height: 96,
        borderRadius: 9999,
        backgroundColor: "#27272a",
        color: "#e4e4e7",
        fontSize: 40,
        fontWeight: 600,
      }}
    >
      {initials}
    </div>
  );
}

/**
 * Subtree puro da imagem OG (ADR 0035 §9). 1200×630, sRGB plano (Satori). Renderiza SÓ as
 * peças de `pieces` (Object.values) + separadores/iniciais. Quando `verdict` é "" (guard de
 * valor disparou), a forma sem-veredito mostra só times + placar + disclaimer.
 */
export function OgPalpiteImage({ pieces }: { pieces: OgTextPieces }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: "100%",
        height: "100%",
        padding: 72,
        backgroundColor: "#0c0a09",
        color: "#fafaf9",
        fontFamily: "sans-serif",
      }}
    >
      {/* Topo: marca + confiança */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", fontSize: 28, color: "#a8a29e" }}>
          palpiteiro
        </div>
        <div style={{ display: "flex", fontSize: 28, color: "#a8a29e" }}>
          {pieces.confidence}
        </div>
      </div>

      {/* Meio: times (chips) + veredito (se seguro) + placar provável */}
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <InitialsChip initials={pieces.homeInitials} />
          <div style={{ display: "flex", fontSize: 40, color: "#d6d3d1" }}>
            {pieces.teams}
          </div>
          <InitialsChip initials={pieces.awayInitials} />
        </div>

        {pieces.verdict !== "" && (
          <div
            style={{
              display: "flex",
              fontSize: 64,
              fontWeight: 600,
              lineHeight: 1.1,
              color: "#fafaf9",
            }}
          >
            {pieces.verdict}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", fontSize: 32, color: "#a8a29e" }}>
            provável
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 56,
              fontWeight: 600,
              color: "#e7e5e4",
            }}
          >
            {pieces.probableScore}
          </div>
        </div>
      </div>

      {/* Base: tira de disclaimer */}
      <div style={{ display: "flex", fontSize: 26, color: "#78716c" }}>
        {pieces.disclaimer}
      </div>
    </div>
  );
}
