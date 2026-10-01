/**
 * Props do ThemeProvider (next-themes) da root layout.
 *
 * `scriptProps.type = "text/plain"` desliga o script anti-flash do PRÓPRIO next-themes
 * (vira bloco de dados, que o browser não executa nem a CSP avalia). Motivo (#467, ADR
 * 0040): o next-themes monta o script com `Function.toString()`, e o `next build`
 * re-minifica a função — o texto em prod difere do de dev/teste, então nenhum hash fixo
 * na CSP bate nos dois. No lugar dele a root layout renderiza `THEME_SCRIPT`, string
 * literal que o minificador não toca.
 */
export const THEME_PROVIDER_PROPS = {
  attribute: "class",
  defaultTheme: "dark",
  enableSystem: true,
  disableTransitionOnChange: true,
  scriptProps: { type: "text/plain" },
} as const;

/**
 * Anti-flash do tema, equivalente ao script do next-themes 0.4 pra THEME_PROVIDER_PROPS
 * (storageKey "theme", temas light/dark, enableColorScheme ligado): aplica a classe do
 * tema salvo (ou do sistema) no <html> antes da primeira pintura. O hash dele está
 * fixado na CSP (`THEME_SCRIPT_HASH` em lib/security/csp.ts); lib/theme.test.ts compara
 * o comportamento com o script original do next-themes e lib/security/csp.test.tsx, o
 * hash. Mudar uma prop acima pode exigir mudar este script.
 */
export const THEME_SCRIPT =
  '(function(){try{var d=document.documentElement,t=localStorage.getItem("theme")||"dark";if(t==="system")t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";d.classList.remove("light","dark");d.classList.add(t);if(t==="light"||t==="dark")d.style.colorScheme=t}catch(e){}})()';
