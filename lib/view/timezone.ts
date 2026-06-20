/**
 * Fuso horário de exibição (#1 timezone). As datas/horas do app são formatadas
 * no fuso do USUÁRIO — detectado no navegador (`Intl`) e persistido num cookie
 * `tz`, lido server-side. As páginas (Server Components) resolvem o fuso aqui e
 * threadam pros mappers/format helpers. Funções puras (seam de teste).
 */

// Default quando não há cookie (1ª visita) ou o valor é inválido. O público é
// majoritariamente BR; o cookie corrige pra qualquer outro fuso no 1º mount.
export const DEFAULT_TIME_ZONE = "America/Sao_Paulo";

/**
 * Valida um IANA time zone cru (do cookie) e devolve um fuso utilizável: o
 * próprio se válido, senão `DEFAULT_TIME_ZONE`. Validação via `Intl` (lança
 * `RangeError` em fuso desconhecido) — também blinda os format helpers de um
 * cookie forjado/corrompido.
 */
export function resolveTimeZone(raw: string | undefined | null): string {
  if (raw) {
    try {
      // Lança se `raw` não for um time zone reconhecido.
      new Intl.DateTimeFormat("en-US", { timeZone: raw });
      return raw;
    } catch {
      // inválido → cai no default
    }
  }
  return DEFAULT_TIME_ZONE;
}
