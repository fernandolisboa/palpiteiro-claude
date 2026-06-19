import {
  palpitesCartridge,
  type BuildPalpitesInputArgs,
  type PalpitesInput,
  type PalpitesOutput,
} from "./cartridges/cartridge";
import type { PalpiteCartridge } from "./types";

// Registry do cartucho de palpites (#315). Hoje há um único cartucho (palpites_v1,
// o MIX). Mantido como função de resolução (e não import direto) pra espelhar o
// padrão de getCartridge do mercado e abrir espaço pra versões futuras (v2) sem
// tocar o gerador. Retorna o cartucho CONCRETAMENTE tipado (o gerador lê
// output.palpites com o tipo exato — sem erasure/cast inseguro).
export function getPalpiteCartridge(): PalpiteCartridge<
  PalpitesInput,
  PalpitesOutput,
  BuildPalpitesInputArgs
> {
  return palpitesCartridge;
}
