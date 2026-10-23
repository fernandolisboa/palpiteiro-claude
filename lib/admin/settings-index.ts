import {
  ADMIN_FLAGS,
  type AdminFlagArea,
  type AdminFlagDef,
} from "@/lib/config/admin-flags";
import { LEAGUE_LABEL, leagueToKey } from "@/lib/format";
import { ADMIN_SECTIONS } from "@/lib/nav/menu";
import {
  SUPPORTED_LEAGUES,
  type SupportedLeague,
} from "@/lib/providers/sports-data/leagues";

/**
 * Índice da busca de configurações do admin. As flags e as ligas saem dos próprios
 * registries (flag ou liga nova entra sozinha); o resto é a lista fixa abaixo. Cada
 * entrada com `#âncora` aponta pra um `id` na página (teste pina que o id existe).
 */
export type SettingKind = "flag" | "ajuste" | "página";

export type SettingEntry = {
  /** Único no índice; também a chave do React. */
  id: string;
  label: string;
  description: string;
  /** Rota, com `#âncora` quando a configuração é um bloco da página. */
  href: string;
  /** Onde fica: "Assistente de IA › modelos". */
  where: string;
  kind: SettingKind;
  /** Sinônimos e termos técnicos que não estão no texto (não aparecem na tela). */
  keywords: readonly string[];
  /** Texto a mais que a busca lê com peso baixo (a nota de custo das flags). */
  detail?: string;
};

const AREA_HREF: Record<AdminFlagArea, string> = {
  ia: "/admin/ia",
  motor: "/admin/motor",
};

export function flagAnchorId(key: AdminFlagDef["key"]): string {
  return `flag-${key}`;
}

export function leagueAnchorId(league: SupportedLeague): string {
  return `liga-${leagueToKey(league)}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Assistente de IA › modelos", a partir do menu do admin. */
export function whereFor(path: string): string {
  if (path === "/perfil") return "Perfil";
  for (const section of ADMIN_SECTIONS) {
    const tab = section.children?.find((child) => child.href === path);
    if (tab) return `${capitalize(section.label)} › ${tab.label}`;
    if (section.href === path) return capitalize(section.label);
  }
  return "Admin";
}

type StaticEntry = Omit<SettingEntry, "where" | "kind"> & {
  kind?: SettingKind;
};

const STATIC_ENTRIES: readonly StaticEntry[] = [
  {
    id: "page-ia",
    kind: "página",
    label: "Assistente de IA",
    description: "Modelos, parâmetros de geração e flags de IA.",
    href: "/admin/ia",
    keywords: ["llm", "claude", "anthropic", "configurações", "settings"],
  },
  {
    id: "model-versions",
    label: "Versões de modelo",
    description:
      "Haiku, Sonnet e Opus: a versão em uso, o fallback, o preço oficial a confirmar e as falhas do teste diário.",
    href: "/admin/ia#versoes-de-modelo",
    keywords: [
      "haiku",
      "sonnet",
      "opus",
      "preço",
      "confirmar preço",
      "fallback",
      "anthropic",
      "versão nova",
    ],
  },
  {
    id: "default-model",
    label: "Modelo padrão global",
    description:
      "Família usada nas análises de quem não escolheu um modelo no perfil.",
    href: "/admin/ia#padrao-global",
    keywords: ["haiku", "sonnet", "opus", "família", "default", "padrão"],
  },
  {
    id: "generation-params",
    label: "Parâmetros de geração",
    description:
      "max_tokens e effort da análise, para todos os usuários. Começam bloqueados.",
    href: "/admin/ia#parametros-de-geracao",
    keywords: [
      "max_tokens",
      "tokens",
      "effort",
      "raciocínio",
      "thinking",
      "teto de saída",
    ],
  },
  {
    id: "ai-costs",
    kind: "página",
    label: "Custos de IA",
    description: "Gasto agregado por dia, usuário e modelo, em USD.",
    href: "/admin/ia/custos",
    keywords: [
      "custo",
      "gasto",
      "usd",
      "dólar",
      "tokens",
      "ai_calls",
      "fatura",
    ],
  },
  {
    id: "page-motor",
    kind: "página",
    label: "Motor e calibração",
    description: "Motor de análise, flags do motor e o Dixon-Coles.",
    href: "/admin/motor",
    keywords: ["engine", "probabilidade", "code_jev"],
  },
  {
    id: "dixon-coles",
    label: "Modelo de placar · Dixon-Coles",
    description:
      "Último ajuste por liga e o botão Reajustar agora (refit diário às 07:00 UTC).",
    href: "/admin/motor#dixon-coles",
    keywords: [
      "refit",
      "reajustar",
      "ratings",
      "team ratings",
      "gols esperados",
      "lambda",
      "heurístico",
    ],
  },
  {
    id: "calibration",
    kind: "página",
    label: "Calibração",
    description:
      "Probabilidade do modelo contra os resultados, por mercado, motor e versão.",
    href: "/admin/motor/calibracao",
    keywords: ["brier", "confiabilidade", "bins", "clv", "backtest", "yield"],
  },
  {
    id: "kelly-gate",
    label: "Gate do Kelly",
    description: "Se o quarter-Kelly já pode substituir as bandas de stake.",
    href: "/admin/motor/calibracao#gate-do-kelly",
    keywords: ["kelly", "stake", "bandas", "fase c"],
  },
  {
    id: "odds-budget",
    label: "Orçamento da Odds API",
    description: "Créditos estimados das ligas ativas e o saldo real do mês.",
    href: "/admin/leagues#orcamento-odds-api",
    keywords: ["créditos", "cota", "quota", "saldo", "the odds api", "500"],
  },
  {
    id: "leagues",
    label: "Ligar ou desligar ligas",
    description: "Quais ligas o app busca e analisa, sem deploy.",
    href: "/admin/leagues#ligas",
    keywords: ["liga", "competição", "ativar", "desativar", "campeonato"],
  },
  {
    id: "users",
    kind: "página",
    label: "Usuários",
    description:
      "Auditar o tracking de qualquer usuário, papel e acesso. Busca por e-mail.",
    href: "/admin/users",
    keywords: [
      "e-mail",
      "email",
      "role",
      "admin",
      "acesso",
      "whitelist",
      "conta",
    ],
  },
  {
    id: "settlement-override",
    label: "Corrigir resultado de um palpite",
    description:
      "Override manual do settlement: abra o usuário e depois a análise.",
    href: "/admin/users",
    keywords: [
      "settlement",
      "override",
      "anular",
      "void",
      "placar corrigido",
      "liquidação",
    ],
  },
  {
    id: "profile",
    kind: "página",
    label: "Nome e avatar",
    description: "Seu nome e foto, visíveis no app.",
    href: "/perfil",
    keywords: ["perfil", "foto", "imagem", "conta"],
  },
  {
    id: "profile-model",
    label: "Seu modelo de análise",
    description:
      "Família usada nas suas análises; sobrescreve o padrão global.",
    href: "/perfil#modelo-de-analise",
    keywords: ["haiku", "sonnet", "opus", "preferência", "perfil"],
  },
  {
    id: "passkeys",
    label: "Passkeys",
    description: "Login sem senha com biometria ou PIN do dispositivo.",
    href: "/perfil#passkeys",
    keywords: [
      "login",
      "biometria",
      "face id",
      "touch id",
      "webauthn",
      "senha",
    ],
  },
  {
    id: "my-data",
    label: "Seus dados",
    description: "Cópia, correção ou exclusão da conta (LGPD).",
    href: "/perfil#seus-dados",
    keywords: ["lgpd", "excluir conta", "privacidade", "exportar"],
  },
];

function flagEntries(): SettingEntry[] {
  // Pela união larga (AdminFlagDef): `valueLabels[v]` não indexa a união literal.
  return (ADMIN_FLAGS as readonly AdminFlagDef[]).map((flag) => {
    const path = AREA_HREF[flag.area];
    const values =
      flag.kind === "enum"
        ? flag.values.flatMap((v) => [v, flag.valueLabels?.[v] ?? v])
        : [];
    return {
      id: `flag:${flag.key}`,
      kind: "flag",
      label: flag.label,
      description: flag.description,
      href: `${path}#${flagAnchorId(flag.key)}`,
      where: whereFor(path),
      keywords: [flag.key, "flag", "toggle", ...values],
      detail: "costNote" in flag ? flag.costNote : undefined,
    };
  });
}

function leagueEntries(): SettingEntry[] {
  return SUPPORTED_LEAGUES.map((league) => ({
    id: `league:${league}`,
    kind: "ajuste",
    label: LEAGUE_LABEL[leagueToKey(league)],
    description:
      "Ligar ou desligar a liga e ver quantos créditos da Odds API ela gasta.",
    href: `/admin/leagues#${leagueAnchorId(league)}`,
    where: whereFor("/admin/leagues"),
    keywords: [league, "liga", "competição"],
  }));
}

export const SETTINGS_INDEX: readonly SettingEntry[] = [
  ...STATIC_ENTRIES.map(({ kind = "ajuste", ...entry }) => ({
    ...entry,
    kind,
    where: whereFor(entry.href.split("#")[0] ?? entry.href),
  })),
  ...flagEntries(),
  ...leagueEntries(),
];

/** Minúsculas e sem acento: "calibração" casa com "calibracao". */
export function normalizeForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

type Field = { text: string; weight: number };

function fieldsOf(entry: SettingEntry): Field[] {
  return [
    { text: entry.label, weight: 4 },
    { text: entry.keywords.join(" · "), weight: 2 },
    { text: entry.where, weight: 1 },
    { text: entry.description, weight: 1 },
    { text: entry.detail ?? "", weight: 1 },
  ].map((f) => ({ ...f, text: normalizeForSearch(f.text) }));
}

/** Começo de palavra vale mais que meio de palavra ("liga" > "desligar"). */
function tokenScore(fields: Field[], token: string): number {
  let best = 0;
  for (const { text, weight } of fields) {
    const at = text.indexOf(token);
    if (at === -1) continue;
    const wordStart = at === 0 || !/[a-z0-9]/.test(text.charAt(at - 1));
    best = Math.max(best, weight * (wordStart ? 2 : 1));
  }
  return best;
}

/**
 * Busca no índice: todas as palavras da consulta têm que aparecer (sem acento, sem
 * caixa) em algum campo da entrada. Ordena pelo peso do campo onde casou (rótulo >
 * sinônimos > onde fica / descrição), com empate na ordem do índice.
 */
export function searchSettings(
  query: string,
  {
    limit = 10,
    index = SETTINGS_INDEX,
  }: { limit?: number; index?: readonly SettingEntry[] } = {}
): SettingEntry[] {
  const tokens = normalizeForSearch(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const scored: { entry: SettingEntry; score: number; order: number }[] = [];
  index.forEach((entry, order) => {
    const fields = fieldsOf(entry);
    let score = 0;
    for (const token of tokens) {
      const s = tokenScore(fields, token);
      if (s === 0) return;
      score += s;
    }
    const label = normalizeForSearch(entry.label);
    if (label.startsWith(tokens.join(" "))) score += 4;
    scored.push({ entry, score, order });
  });
  return scored
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((s) => s.entry);
}
