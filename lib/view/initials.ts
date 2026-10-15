// Iniciais do avatar da conta (#574 linha 28a). Puro, seguro no cliente.
// "Fernando Lisboa" → "FL" (primeiro e último nome); "fernando.lisboa@x" → "FL";
// "fernando" → "FE"; acentos preservados ("Érica Souza" → "ÉS"). Sem letra → "??".
export function userInitials(label: string): string {
  const base = label.includes("@") ? (label.split("@")[0] ?? "") : label;
  const tokens = base
    .split(label.includes("@") ? /[._\-\s]+/ : /\s+/)
    .map((t) => t.replace(/[^\p{L}]/gu, ""))
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return "??";
  const initials =
    tokens.length >= 2
      ? `${firstLetter(tokens[0])}${firstLetter(tokens[tokens.length - 1])}`
      : Array.from(tokens[0]).slice(0, 2).join("");
  return initials.toLocaleUpperCase("pt-BR");
}

function firstLetter(token: string): string {
  return Array.from(token)[0] ?? "";
}
