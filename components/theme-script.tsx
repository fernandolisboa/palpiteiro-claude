import { THEME_SCRIPT } from "@/lib/theme";

/** Script anti-flash do tema (ver `THEME_SCRIPT`). Entra na CSP gateada por hash. */
export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}
