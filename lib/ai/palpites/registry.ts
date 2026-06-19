import {
  palpitesCartridge,
  type BuildPalpitesInputArgs,
  type PalpitesInput,
  type PalpiteSynthesisOutput,
} from "./cartridges/cartridge";
import type { PalpiteCartridge } from "./types";

// Registry do cartucho de palpites. Hoje há um único cartucho (palpites_v2, a
// SÍNTESE palpite-first, ADR 0030 / #353). Mantido como função de resolução (e não
// import direto) pra espelhar o padrão de getCartridge do mercado e abrir espaço pra
// versões futuras sem tocar o gerador. Retorna o cartucho CONCRETAMENTE tipado (o
// gerador lê a manchete com o tipo exato — sem erasure/cast inseguro).
export function getPalpiteCartridge(): PalpiteCartridge<
  PalpitesInput,
  PalpiteSynthesisOutput,
  BuildPalpitesInputArgs
> {
  return palpitesCartridge;
}
