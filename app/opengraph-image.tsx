import { ImageResponse } from "next/og";

import { AppIconMark } from "@/components/brand/app-icon-mark";
import { OG_DISCLAIMER_STRIP } from "@/lib/view/share/disclaimer";

// Card de compartilhamento da landing (#442, report 06 rec. 4): todo link de palpiteiro.live
// no WhatsApp/X sai com marca + tagline + a tira "18+ · não é recomendação de aposta".
// Estático (gerado no build), 1200×630. Vale pra toda rota sem imagem própria; o /p tem a
// sua (app/p/[id]/opengraph-image.tsx). O X usa esta mesma imagem (sem twitter-image).
//
// Só alcançável sem sessão porque o matcher do middleware exclui `opengraph-image$` na
// raiz (ver middleware.ts). Cores em hex: o Satori não resolve OKLCH.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Palpiteiro: palpites de futebol com IA e bolão entre amigos";

const OG_TAGLINE = "Palpites de futebol com IA";
const OG_SUBLINE = "Com o porquê, mais suas apostas e o bolão da turma";

export default function OpengraphImage() {
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
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <div style={{ display: "flex", width: 96, height: 96 }}>
            <AppIconMark size={96} rounded />
          </div>
          <div style={{ display: "flex", fontSize: 72, letterSpacing: -2 }}>
            palpiteiro
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", fontSize: 64, lineHeight: 1.1 }}>
            {OG_TAGLINE}
          </div>
          <div style={{ display: "flex", fontSize: 34, color: "#a8a29e" }}>
            {OG_SUBLINE}
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 26, color: "#78716c" }}>
          {OG_DISCLAIMER_STRIP}
        </div>
      </div>
    ),
    { ...size },
  );
}
