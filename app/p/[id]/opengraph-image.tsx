import { ImageResponse } from "next/og";

import { leagueToKey } from "@/lib/format";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import { teamToTeam } from "@/lib/view/team";
import { OG_DISCLAIMER_STRIP } from "@/lib/view/share/disclaimer";
import {
  buildOgTextPieces,
  OgPalpiteImage,
} from "@/components/palpites/og-palpite-image";
import { loadSharedPalpite } from "@/app/p/[id]/load-shared-palpite";

// Imagem OG do /p (ADR 0035 §4/§9 / #384). Edge runtime, 1200×630, PNG. Imagem ÚNICA (sem
// generateImageMetadata, sem twitter-image separado) — mantém a âncora do middleware estreita.
export const runtime = "edge";
export const revalidate = 86400;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Palpite no Palpiteiro";

// Fallback NEUTRO sem veredito (sem dados / 404): marca + disclaimer, sem times/placar.
function fallbackImage() {
  return new ImageResponse(
    (
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
        <div style={{ display: "flex", fontSize: 40, color: "#a8a29e" }}>
          palpiteiro
        </div>
        <div style={{ display: "flex", fontSize: 26, color: "#78716c" }}>
          {OG_DISCLAIMER_STRIP}
        </div>
      </div>
    ),
    { ...size },
  );
}

export default async function OpengraphImage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // MESMO loader mapper-inclusive da página: 404-fallback nos 3 triggers (não só "sem row").
  const shared = await loadSharedPalpite(id);
  if (!shared) return fallbackImage();

  const { view, match } = shared;
  const leagueKey = leagueToKey(match.league as SupportedLeague);
  const home = teamToTeam(match.homeTeam, leagueKey);
  const away = teamToTeam(match.awayTeam, leagueKey);

  const pieces = buildOgTextPieces(view, {
    homeName: home.name,
    awayName: away.name,
    homeShort: home.short,
    awayShort: away.short,
  });

  return new ImageResponse(<OgPalpiteImage pieces={pieces} />, { ...size });
}
