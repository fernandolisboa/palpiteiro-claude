import { containsValueLanguage } from "@/lib/ai/palpites/value-language-guard";
import {
  NAO_VIRA,
  VIRA,
  codeJev,
  mr,
  ou,
  type Scenario,
} from "@/lib/ai/palpites/__tests__/weighed-fixtures";
import { resolvePregamePick } from "@/lib/ai/palpites/pick";
import {
  toWeighedView,
  type PalpiteWeighedView,
} from "@/lib/view/palpite-weighed";

// Firewall do HERO com o "o que pesou" (#683, emenda da ADR 0030 §3): o único `%`
// permitido é o dos rótulos da barra (`<span data-pesou-pct="">33%</span>`). Tira esses
// rótulos e exige zero `%` no resto; termo de valor (containsValueLanguage) nunca, no
// HTML inteiro.
const PCT_LABEL = /<span data-pesou-pct=""[^>]*>\d{1,3}%<\/span>/g;

export function leaksValueOutsideWeighedBar(html: string): boolean {
  if (containsValueLanguage(html)) return true;
  return /%/.test(html.replace(PCT_LABEL, ""));
}

export const WEIGHED_TEAMS = {
  home: { name: "Atlético-MG", short: "CAM" },
  away: { name: "Boca Juniors", short: "BOC" },
};

// O bloco dos dois cenários da v6, com o motor real.
export function weighedViewOf(s: Scenario, newsCount = 0): PalpiteWeighedView {
  const j = codeJev({ base: { home: 1, away: 1 }, jev: s.jev, user: s.user });
  const pick = resolvePregamePick([mr(s.odds, j), ou(...s.ou)]);
  return toWeighedView(pick, WEIGHED_TEAMS, { newsCount })!;
}

export const WEIGHED_VIRA = () => weighedViewOf(VIRA, 3);
export const WEIGHED_NAO_VIRA = () => weighedViewOf(NAO_VIRA);
