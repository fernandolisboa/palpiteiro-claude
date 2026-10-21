import { ImageResponse } from "next/og";

import { AppIconMark } from "@/components/brand/app-icon-mark";

// Ícones do app (#440, report 06 rec. 2): PNG gerado em código, sem asset binário no repo.
// 32px vira o favicon da aba; 192/512 são os que o manifest (app/manifest.ts) lista pra
// instalação. Rotas `/icon/<id>`, estáticas (geradas no build).
//
// LANDMINE (report 06 achado #2): só alcançáveis sem sessão porque o matcher do middleware
// exclui `icon(?:/[^/]+)?$`. Ver middleware.ts e next.config.ts (cache).
export const contentType = "image/png";
// Gera os 3 PNGs no build (com generateImageMetadata a rota sairia dinâmica, ƒ).
export const dynamic = "force-static";

const ICON_SIZES = [32, 192, 512] as const;

export function generateImageMetadata() {
  return ICON_SIZES.map((px) => ({
    id: String(px),
    size: { width: px, height: px },
    contentType,
  }));
}

export default function Icon({ id }: { id: string }) {
  const px = Number(id);
  return new ImageResponse(<AppIconMark size={px} rounded />, {
    width: px,
    height: px,
  });
}
