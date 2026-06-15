/**
 * Decide se o cliente deve ver o banner de "nova versão disponível".
 *
 * Retorna `true` SOMENTE quando ambos os SHAs estão presentes, são reais (não o
 * sentinela "dev" de dev local) e DIFEREM. Qualquer null/undefined/""/"dev" em
 * qualquer lado → `false` (no-op): builds locais e falhas transitórias de fetch
 * nunca disparam o banner.
 *
 * Comparação é desigualdade pura (sem ordenação de SHA): qualquer divergência
 * entre a versão carregada e a do servidor — inclusive um rollback, onde o
 * servidor "regride" — pede reload. É o comportamento de produto correto.
 */
export function isNewVersionAvailable(
  loaded: string | null | undefined,
  current: string | null | undefined,
): boolean {
  if (!loaded || !current) return false;
  if (loaded === "dev" || current === "dev") return false;
  return loaded !== current;
}
