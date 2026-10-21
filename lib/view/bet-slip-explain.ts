import type { BetExplanation } from "@/lib/ai/bet-slip-explain/schema";
import type { BetExplainInput } from "@/lib/bets/explain-input";

// A explicação das apostas registradas (#562) pronta pra tela: o texto de cada perna
// sob o rótulo DELA (nunca pela posição no painel) e a nota de origem. Serializável.

export type BetSlipExplanationView = {
  source: "llm" | "template";
  summary: string;
  legs: { label: string; text: string }[];
  combo: string | null;
  note: string;
};

export const EXPLANATION_NOTE_LLM =
  "Texto gerado por IA a partir dos números acima; os números não mudam.";
export const EXPLANATION_NOTE_TEMPLATE =
  "Não consegui gerar a explicação com IA agora; esta é a leitura em código.";

export function toBetSlipExplanationView(
  explanation: BetExplanation,
  input: BetExplainInput,
  source: "llm" | "template"
): BetSlipExplanationView {
  const textByIndex = new Map(
    explanation.pernas.map((p) => [p.indice, p.texto])
  );
  return {
    source,
    summary: explanation.resumo,
    legs: input.legs.flatMap((l) => {
      const text = textByIndex.get(l.index);
      return text ? [{ label: l.label, text }] : [];
    }),
    combo: explanation.combinada,
    note: source === "llm" ? EXPLANATION_NOTE_LLM : EXPLANATION_NOTE_TEMPLATE,
  };
}
