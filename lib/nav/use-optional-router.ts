import { useContext } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

/**
 * `useRouter` sem o erro fora do App Router (#639): `IntentLink` e `RevisitRefresh`
 * são enfeites de navegação e entram em componentes renderizados soltos (testes,
 * `renderToStaticMarkup`), onde não há roteador. `null` = não faz nada.
 */
export function useOptionalRouter() {
  return useContext(AppRouterContext);
}
