"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { DEFAULT_TIME_ZONE } from "@/lib/view/timezone";

function readCookie(name: string): string | null {
  const hit = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${name}=`));
  // Valor cru: gravamos sem encode, então read e write casam. (No server, o
  // next/headers cookies() faz decodeURIComponent na leitura, mas é no-op em
  // nomes IANA — sem '%'; '+'/'_' passam intactos —, então o round-trip é fiel.)
  return hit ? hit.slice(name.length + 1) : null;
}

/**
 * Detecta o fuso do navegador e o persiste no cookie `tz` (lido server-side por
 * getRequestTimeZone) pra que as datas sejam formatadas no fuso do usuário (#1).
 * Sem deps novas, sem login. Roda no root layout (todas as rotas).
 *
 * Após setar o cookie pela 1ª vez (ou ao mudar de fuso) dispara um router.refresh
 * pra re-renderizar os Server Components no fuso certo. Evita refresh à toa: se já
 * sincronizado, ou se for a 1ª visita E o fuso == default (que o server já usou),
 * não refresha.
 */
export function TimezoneSync() {
  const router = useRouter();
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return;
    const existing = readCookie("tz");
    if (existing === tz) return; // já sincronizado
    // SEM encodeURIComponent: nomes IANA (ex.: "America/Sao_Paulo", "Etc/GMT+3")
    // são cookie-safe e o decodeURIComponent que o server aplica na leitura é
    // no-op neles, então gravar cru é round-trip-safe. resolveTimeZone valida
    // de qualquer forma (cookie forjado → default).
    document.cookie = `tz=${tz}; path=/; max-age=31536000; samesite=lax`;
    // 1ª visita + fuso == default: o server já renderizou nesse fuso → sem refresh.
    if (existing === null && tz === DEFAULT_TIME_ZONE) return;
    router.refresh();
  }, [router]);
  return null;
}
