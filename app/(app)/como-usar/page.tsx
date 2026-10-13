import type { Metadata } from "next";

import { ComoUsarContent } from "./como-usar-content";

// Página gateada: recebe a CSP com nonce do middleware, e o Next só carimba o nonce em
// HTML renderizado por request. Estática, ela sairia do build sem nonce e, com a CSP em
// enforce, sem JS nenhum (#467; scripts/check-csp-prerender.ts trava isso no build).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Como usar",
  description:
    "Guia de uso do Palpiteiro: achar um jogo, gerar o palpite, ler a análise, registrar sua aposta e acompanhar os resultados.",
};

/**
 * Guia de uso `/como-usar` (logado — o botão do tour leva pra `/jogos`, que é
 * gateada). O menu vem do layout do grupo `(app)`.
 */
export default function ComoUsarPage() {
  return (
    <div className="mx-auto w-full max-w-reading px-6 py-8">
      <ComoUsarContent />
    </div>
  );
}
