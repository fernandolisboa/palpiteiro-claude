import { randomUUID } from "node:crypto";

import { RevisitRefreshClient } from "@/components/revisit-refresh-client";
import { LIVE_REVISIT_MAX_AGE_MS, REVISIT_MAX_AGE_MS } from "@/lib/nav/router-cache";

/**
 * Toda página logada renderiza um (#639; `__tests__/revisit-refresh-coverage.test.ts`
 * trava). Reaberta do cache do roteador, a página aparece na hora e é relida em
 * segundo plano se o que está na tela passou de 30s; `live` (jogo rolando) relê
 * sempre. Fica na página, não no layout: o layout não é re-renderizado entre
 * navegações, então o id dele não diria nada sobre a idade da página.
 */
export function RevisitRefresh({ live = false }: { live?: boolean }) {
  return (
    <RevisitRefreshClient
      renderId={randomUUID()}
      maxAgeMs={live ? LIVE_REVISIT_MAX_AGE_MS : REVISIT_MAX_AGE_MS}
    />
  );
}
