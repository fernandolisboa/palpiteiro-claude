import { TOUR_RESTART_HREF } from "@/lib/tour/steps";

/**
 * Modelo único do menu do app (#553). O header do computador e o drawer do celular
 * leem daqui, então ordem, rótulos e o gate de admin não divergem mais entre os dois.
 *
 * Agrupamento: as telas de uso ficam soltas na barra (`PRIMARY_NAV`); ajuda e admin
 * viram grupos (dropdown no computador, seção no drawer); a conta fica no avatar.
 */
export type NavItem = {
  href: string;
  label: string;
  /** Linha de apoio mostrada no índice do admin. */
  description?: string;
  /** Abas internas da tela (só seções do admin). */
  children?: readonly NavItem[];
};

export type NavGroup = {
  id: "ajuda" | "admin";
  label: string;
  items: readonly NavItem[];
};

export const PRIMARY_NAV: readonly NavItem[] = [
  { href: "/jogos", label: "jogos" },
  { href: "/apostas", label: "suas apostas" },
  { href: "/bolao", label: "bolão" },
  { href: "/dashboard", label: "desempenho" },
];

export const HELP_NAV: NavGroup = {
  id: "ajuda",
  label: "ajuda",
  items: [
    { href: "/como-usar", label: "como usar" },
    { href: "/como-funciona", label: "como funciona" },
    { href: TOUR_RESTART_HREF, label: "rever o tour" },
  ],
};

/**
 * Seções do admin (#633). O dropdown "admin" do header, a faixa de abas do layout do
 * admin e o índice `/admin` leem daqui. `children` são as abas internas de uma seção
 * (o seletor no topo da página); a primeira tem o mesmo href da seção.
 */
export const ADMIN_SECTIONS: readonly NavItem[] = [
  {
    href: "/admin/ia",
    label: "assistente de IA",
    description: "modelos · parâmetros · custos · flags de IA",
    children: [
      { href: "/admin/ia", label: "modelos" },
      { href: "/admin/ia/custos", label: "custos" },
    ],
  },
  {
    href: "/admin/motor",
    label: "motor e calibração",
    description: "motor de análise · Dixon-Coles · calibração · flags do motor",
    children: [
      { href: "/admin/motor", label: "motor" },
      { href: "/admin/motor/calibracao", label: "calibração" },
    ],
  },
  {
    href: "/admin/leagues",
    label: "ligas e odds",
    description: "ligar/desligar ligas · créditos da Odds API · sem deploy",
  },
  {
    href: "/admin/users",
    label: "usuários",
    description: "auditar o tracking de qualquer usuário · busca por e-mail",
  },
];

export const ADMIN_NAV: NavGroup = {
  id: "admin",
  label: "admin",
  items: [{ href: "/admin", label: "visão geral" }, ...ADMIN_SECTIONS],
};

export const ACCOUNT_NAV: readonly NavItem[] = [{ href: "/perfil", label: "perfil" }];

export function navGroups(isAdmin: boolean): NavGroup[] {
  return isAdmin ? [HELP_NAV, ADMIN_NAV] : [HELP_NAV];
}

/**
 * True se `href` é a rota ativa: raiz casa exata; o resto casa exato OU como prefixo
 * delimitado por "/" (ex.: "/dashboard" ativa "/dashboard/123", mas NÃO
 * "/dashboard-foo"). Query string do `href` é ignorada.
 */
export function isActivePath(pathname: string, href: string): boolean {
  const path = href.split("?")[0] ?? href;
  if (path === "/") return pathname === "/";
  return pathname === path || pathname.startsWith(path + "/");
}

/**
 * Item ativo de um grupo. Só o mais específico vence: em `/admin/users` o ativo é
 * "usuários", não "visão geral" (`/admin` também casaria por prefixo). Links com
 * query (o tour) nunca ficam ativos: levam pra outra tela.
 */
export function activeItemHref(
  pathname: string,
  items: readonly NavItem[]
): string | null {
  const matches = items.filter(
    (item) => !item.href.includes("?") && isActivePath(pathname, item.href)
  );
  if (matches.length === 0) return null;
  return matches.reduce((a, b) => (b.href.length > a.href.length ? b : a)).href;
}

/**
 * `aria-current` de um item ativo: "page" quando é a própria tela, "true" quando é a
 * seção de uma sub-tela (ex.: "usuários" em `/admin/users/abc`).
 */
export function ariaCurrentFor(
  pathname: string,
  href: string
): "page" | "true" {
  return pathname === (href.split("?")[0] ?? href) ? "page" : "true";
}
