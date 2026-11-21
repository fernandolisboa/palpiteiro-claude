import {
  palpitesLlmPickCartridge,
  type BuildPalpitesInputArgs,
  type PalpitesInput,
  type PalpiteSynthesisOutput,
} from "./cartridges/cartridge";
import {
  palpitesModelPickCartridge,
  type BuildModelPickInputArgs,
  type PalpiteModelPickOutput,
  type PalpitesModelPickInput,
} from "./cartridges/model-pick";
import type { PalpiteCartridge } from "./types";

// Registry do cartucho de palpites. Dois cartuchos de pré-jogo desde o #668 (ADR 0072):
// - "model_pick" (palpites_v13): resultado e placar decididos em código, o LLM escreve;
// - "llm_pick" (palpites_v12): sem nenhuma fonte de λ no run, o LLM escolhe, como antes.
// Retorna o cartucho CONCRETAMENTE tipado (o gerador lê a manchete com o tipo exato).
export function getPalpiteCartridge(
  kind: "model_pick",
): PalpiteCartridge<PalpitesModelPickInput, PalpiteModelPickOutput, BuildModelPickInputArgs>;
export function getPalpiteCartridge(
  kind: "llm_pick",
): PalpiteCartridge<PalpitesInput, PalpiteSynthesisOutput, BuildPalpitesInputArgs>;
export function getPalpiteCartridge(kind: "model_pick" | "llm_pick") {
  return kind === "model_pick" ? palpitesModelPickCartridge : palpitesLlmPickCartridge;
}
