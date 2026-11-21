// Segunda tentativa do narrador (#669, adendo do ADR 0041 §4). Quando a nossa
// conferência reprova a narração (fora do formato ou fora dos números), o predict
// chama de novo UMA vez, com o motivo no fim da mensagem do usuário. Só a mensagem
// muda: system e tool ficam idênticos, e o prefixo cacheado (ADR 0071) é lido na 2ª
// chamada. Puro, sem I/O; vale pros dois cartuchos (pré-jogo e ao vivo).

export type NarrationRejection = "format" | "fidelity";

export const REJECTION_FEEDBACK_MAX_CHARS = 500;

function cap(text: string): string {
  return text.length <= REJECTION_FEEDBACK_MAX_CHARS
    ? text
    : `${text.slice(0, REJECTION_FEEDBACK_MAX_CHARS - 1)}…`;
}

/** Issues do Zod em "caminho: mensagem" (a mensagem do Zod fica em inglês). */
export function zodRejectionFeedback(
  issues: readonly { path: readonly PropertyKey[]; message: string }[]
): string {
  return cap(
    issues
      .map((i) => {
        const path = i.path.map(String).join(".");
        return path === "" ? i.message : `${path}: ${i.message}`;
      })
      .join("; ")
  );
}

/**
 * Motivo da fidelidade sem a lista "[58.40, 50.20, …]" do fim: os números com ponto
 * decimal confundiriam o modelo (o texto usa vírgula) e ele não precisa da lista, que
 * já está no bloco da decisão.
 */
export function fidelityRejectionFeedback(reason: string): string {
  return cap(reason.replace(/\s*\[[^\]]*\]\s*$/, "").trim());
}

export const TOOL_MISSING_FEEDBACK =
  "a resposta não chamou a ferramenta submit_narration";

export function rejectionBlock(
  kind: NarrationRejection,
  feedback: string
): string[] {
  const reason = feedback.replace(/\.+$/, "");
  const why =
    kind === "format"
      ? `- A resposta anterior veio fora do formato pedido: ${reason}.`
      : `- A resposta anterior não passou na conferência com os números e o lado da decisão: ${reason}.`;
  return [
    "## Tentativa anterior reprovada",
    why,
    "- Escreva de novo seguindo as regras e o formato. A decisão e os números não mudaram.",
  ];
}

/**
 * Põe o bloco de reprovação antes da última linha da mensagem (a instrução "Escreva …
 * via submit_narration."), separado por linha em branco. Os dois cartuchos terminam a
 * mensagem nessa linha (há teste travando isso).
 */
export function withRejection(
  message: string,
  block: readonly string[]
): string {
  const cut = message.lastIndexOf("\n");
  if (cut < 0) return [...block, "", message].join("\n");
  const head = message.slice(0, cut);
  const last = message.slice(cut + 1);
  return `${head.replace(/\n*$/, "")}\n\n${block.join("\n")}\n\n${last}`;
}
