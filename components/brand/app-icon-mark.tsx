import { ImageResponse } from "next/og";

import { markGlyph } from "@/components/brand/brand-mark";

// Marca do ícone do app (favicon, apple-touch-icon, ícones do manifest — #440). É o subtree
// que entra no `new ImageResponse(...)` de app/icon*.tsx e app/apple-icon.tsx, então segue
// as regras do Satori: só flexbox e cores sRGB em hex (o Satori não resolve OKLCH).
//
// O "p" é desenhado em SVG (haste + anel-medidor, ADR 0065), não com texto: o next/og só
// traz a Noto Sans regular, fina demais pra ler a 16px na aba. A geometria mora em
// brand-mark.tsx, a mesma do símbolo no header.

// `--primary` do tema claro (oklch(0.48 0.18 258), app/globals.css) convertido pra sRGB.
export const BRAND_BLUE = "#0057c0";
export const BRAND_WHITE = "#ffffff";

export function AppIconMark({
  size,
  rounded,
}: {
  size: number;
  // Cantos arredondados na aba/manifest; o apple-touch-icon sai quadrado (o iOS aplica a
  // própria máscara e cantos transparentes viram preto).
  rounded: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        backgroundColor: BRAND_BLUE,
        borderRadius: rounded ? size * 0.22 : 0,
      }}
    >
      <svg width={size} height={size} viewBox="0 0 100 100">
        {markGlyph(BRAND_WHITE)}
      </svg>
    </div>
  );
}

// PNG quadrado do ícone. Um arquivo por tamanho (app/icon.tsx, icon1.tsx, icon2.tsx) em vez
// de generateImageMetadata: assim cada um sai pronto do build, sem rota dinâmica `/icon/[id]`.
// O próprio ImageResponse manda `immutable` (as URLs do HTML levam `?<hash>` do conteúdo).
export function appIconResponse(px: number, rounded: boolean) {
  return new ImageResponse(<AppIconMark size={px} rounded={rounded} />, {
    width: px,
    height: px,
  });
}
