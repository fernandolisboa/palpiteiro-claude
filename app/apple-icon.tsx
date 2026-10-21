import { ImageResponse } from "next/og";

import { AppIconMark } from "@/components/brand/app-icon-mark";

// apple-touch-icon (#440): 180×180, quadrado (o iOS aplica a própria máscara). Rota
// `/apple-icon`, estática; liberada no matcher do middleware (`apple-icon$`).
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(<AppIconMark size={180} rounded={false} />, {
    ...size,
  });
}
