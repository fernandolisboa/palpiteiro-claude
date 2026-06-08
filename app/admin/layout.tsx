import type { ReactNode } from "react";
import { notFound } from "next/navigation";

import { auth } from "@/auth";

/**
 * Gate de admin pra toda rota sob `/admin`. O middleware só exige sessão — não
 * checa role —, então um usuário whitelisted comum (role "user") passaria pela
 * UI de override de settlement, que muta outcomes passados (integridade de
 * Yield; ver CLAUDE.md). `notFound()` (em vez de redirect) não revela que a
 * rota existe. Defense-in-depth com o gate na própria action.
 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth();
  if (session?.user?.role !== "admin") notFound();
  return <>{children}</>;
}
