import { cookies } from "next/headers";

import { resolveTimeZone } from "@/lib/view/timezone";

/**
 * Fuso horário de exibição do request atual: lê o cookie `tz` (setado no cliente
 * por <TimezoneSync>) e valida. Sem cookie/ inválido → `DEFAULT_TIME_ZONE` (BRT).
 * Server-only (usa `next/headers`). As páginas chamam isto e threadam o fuso pros
 * mappers de view; a função pura de validação fica em `lib/view/timezone`.
 */
export async function getRequestTimeZone(): Promise<string> {
  try {
    const raw = (await cookies()).get("tz")?.value;
    return resolveTimeZone(raw);
  } catch {
    // Fora de um request scope (ex.: testes de server action chamando direto, ou
    // render estático) `cookies()` lança → cai no default (BRT). Em prod as rotas
    // são dinâmicas (auth/force-dynamic), então isto só morde fora de request.
    return resolveTimeZone(undefined);
  }
}
