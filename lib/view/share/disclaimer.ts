// Disclaimers do boundary público /p (ADR 0035 §10 / #384), single-sourced. A página
// pública renderiza 3 blocos (palpite + risco + não-operador) + selo 18+ + link CVV; a
// imagem OG carrega só a TIRA comprimida (OG_DISCLAIMER_STRIP), DERIVADA do PALPITE_DISCLAIMER
// (não um literal solto — um copy-edit no disclaimer não pode dessincronizar a tira em
// silêncio; pinado por teste). Textos copiados VERBATIM de docs/ops/05-legal-compliance.md.

import { PALPITE_DISCLAIMER } from "@/lib/view/palpites-headline";

export { PALPITE_DISCLAIMER };

// §3 (aviso de risco) — docs/ops/05-legal-compliance.md:102-105, verbatim.
export const RISK_DISCLAIMER =
  "Aposta não é investimento. As recomendações do Palpiteiro são análises e não garantem resultado. Aposte com responsabilidade, só o que você pode perder, e nunca para recuperar perdas. Se a aposta deixou de ser diversão, procure ajuda." as const;

// §7 footer (mini-disclaimer de não-operador) — :251-256, verbatim.
export const NON_OPERATOR_DISCLAIMER =
  "Palpiteiro é uma ferramenta de análise. Não é casa de apostas e não aceita dinheiro real." as const;

// Canal de ajuda (CVV 188) — :111.
export const CVV_HELP = {
  label: "CVV 188",
  href: "https://www.cvv.org.br/",
} as const;

// Tira comprimida pra OG, DERIVADA do PALPITE_DISCLAIMER + o selo "18+": strippa o prefixo
// "É só um palpite, " e o ponto final, prepende "18+ · ". Resultado p/ o disclaimer atual:
// "18+ · não é recomendação de aposta". A DERIVAÇÃO (não o literal) é a fonte da verdade —
// pinada por teste, então um edit no PALPITE_DISCLAIMER reflete aqui sem dessincronizar.
export const OG_DISCLAIMER_STRIP = `18+ · ${PALPITE_DISCLAIMER.replace(
  /^É só um palpite, /,
  "",
).replace(/\.$/, "")}` as const;
