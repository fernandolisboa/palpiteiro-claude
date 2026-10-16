// Idades do estado ao vivo (#580, ADR 0060 §2). A idade é sempre medida a partir de
// `match_live_states.fetched_at`, o instante da RESPOSTA do provider (não do upsert):
// um payload que ficou parado num cache em memória não pode parecer novo.

/** Row mais nova que isto não é buscada de novo (o cache entre instâncias). */
export const IN_PLAY_FRESH_MS = 60_000;

/**
 * Idade máxima para REGISTRAR (aposta, análise, Seu palpite, bolão com placar). Mais
 * velha, a action tenta buscar; sem sucesso, recusa (o bolão anota com o relógio).
 */
export const IN_PLAY_ACT_MAX_AGE_MS = 120_000;

/** Até aqui a tela mostra o placar com "atualizado há X"; depois, "indisponível". */
export const IN_PLAY_SHOW_MAX_AGE_MS = 10 * 60_000;

/**
 * Lease da busca na própria row (`match_live_states.claimed_at`, §5.2 passo 3): quem
 * ganhou tem este prazo para gravar; depois, outra instância pode tentar. Vence sozinho
 * se a busca falhar, sem precisar de limpeza.
 */
export const LIVE_STATE_LEASE_MS = 20_000;

/**
 * Janela de busca do estado ao vivo, `[kickoff − 5 min, kickoff + 4h]` (PLAN-580 §5.2
 * passo 1). 4h cobre 2º tempo + prorrogação + pênaltis com folga. Depois dela nada é
 * buscado: sem um terminal já lido, a tela e as actions voltam ao "já começou" de antes
 * do modo ao vivo (nunca um "indisponível, tente em um minuto" que não se resolve).
 */
export const IN_PLAY_WINDOW_BEFORE_MS = 5 * 60_000;
export const IN_PLAY_WINDOW_AFTER_MS = 4 * 60 * 60_000;

/** O apito foi há mais de `IN_PLAY_WINDOW_AFTER_MS`: o estado não é mais buscado. */
export function isPastInPlayWindow(
  kickoffAt: Date,
  now: Date = new Date()
): boolean {
  return now.getTime() > kickoffAt.getTime() + IN_PLAY_WINDOW_AFTER_MS;
}

/** Idade do estado em ms; `null` quando nunca houve busca bem-sucedida. */
export function liveStateAgeMs(
  fetchedAt: Date | null,
  now: Date = new Date()
): number | null {
  if (fetchedAt === null) return null;
  // Relógio da instância um pouco atrás do instante gravado: idade zero, não negativa.
  return Math.max(0, now.getTime() - fetchedAt.getTime());
}

function withinAge(
  fetchedAt: Date | null,
  maxAgeMs: number,
  now: Date
): boolean {
  const age = liveStateAgeMs(fetchedAt, now);
  return age !== null && age <= maxAgeMs;
}

/** Fresco o bastante para não buscar de novo (≤ 60 s). */
export function isLiveStateFresh(
  fetchedAt: Date | null,
  now: Date = new Date()
): boolean {
  return withinAge(fetchedAt, IN_PLAY_FRESH_MS, now);
}

/** Novo o bastante para registrar (≤ 2 min). */
export function isLiveStateActionable(
  fetchedAt: Date | null,
  now: Date = new Date()
): boolean {
  return withinAge(fetchedAt, IN_PLAY_ACT_MAX_AGE_MS, now);
}

/** Novo o bastante para mostrar o placar (≤ 10 min). */
export function isLiveStateShowable(
  fetchedAt: Date | null,
  now: Date = new Date()
): boolean {
  return withinAge(fetchedAt, IN_PLAY_SHOW_MAX_AGE_MS, now);
}
