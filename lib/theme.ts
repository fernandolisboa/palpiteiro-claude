/**
 * Props do ThemeProvider (next-themes) da root layout. Fonte única porque o script
 * inline anti-flash que o next-themes injeta é derivado DESTAS props, e o hash dele
 * está fixado na CSP (`THEME_SCRIPT_HASH` em lib/security/csp.ts, ADR 0040). Mudar
 * uma prop aqui muda o script — o teste em lib/security/csp.test.tsx acusa o drift.
 */
export const THEME_PROVIDER_PROPS = {
  attribute: "class",
  defaultTheme: "dark",
  enableSystem: true,
  disableTransitionOnChange: true,
} as const;
