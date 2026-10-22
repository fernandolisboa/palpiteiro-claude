import { appIconResponse } from "@/components/brand/app-icon-mark";

// Ícones do app (#440, report 06 rec. 2): PNG gerado em código, sem asset binário no repo.
// `/icon` (32px) é o favicon da aba; `/icon1` (192) e `/icon2` (512) são os que o manifest
// (app/manifest.ts) lista pra instalação. Estáticos, gerados no build.
//
// LANDMINE (report 06 achado #2): só alcançáveis sem sessão porque o matcher do middleware
// exclui `icon\d?$`. Ver middleware.ts.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return appIconResponse(size.width, true);
}
