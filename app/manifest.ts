import type { MetadataRoute } from "next";

import { BRAND_BLUE } from "@/components/brand/app-icon-mark";

/**
 * `/manifest.webmanifest` (#440, report 06 rec. 2): deixa o app instalável na tela inicial.
 * SEM service worker (ADR 0024): o manifest sozinho basta pro "Adicionar à tela inicial",
 * e o cache continua sendo o do navegador.
 *
 * `start_url` é `/jogos` (a home logada): sem sessão o middleware manda pro login. Os
 * ícones são as rotas de app/icon.tsx. Só alcançável sem sessão porque o matcher do
 * middleware exclui `manifest\.webmanifest$` (ver middleware.ts).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Palpiteiro",
    short_name: "Palpiteiro",
    description:
      "Palpites de futebol com IA, suas apostas e o bolão entre amigos. Ferramenta de análise, não é casa de apostas.",
    lang: "pt-BR",
    start_url: "/jogos",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: BRAND_BLUE,
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png" },
      { src: "/icon/512", sizes: "512x512", type: "image/png" },
    ],
  };
}
