import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";

/**
 * Layout de toda tela logada (#553). Página nova que exige sessão entra neste grupo
 * e já nasce com o menu; `__tests__/app-shell-coverage.test.ts` trava isso. O grupo
 * não muda URL nenhuma.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
