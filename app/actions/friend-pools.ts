"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { auth } from "@/auth";
import { isEmailAllowed } from "@/lib/auth/whitelist";
import { getEnableLiveMode } from "@/lib/db/queries/ai-config";
import {
  deleteFriendPool,
  deleteFriendPoolEntry,
  getFriendPool,
  insertFriendPool,
  insertFriendPoolEntry,
  setFriendPoolBetsClosed,
  setFriendPoolBetsExtended,
  setFriendPoolManualScore,
} from "@/lib/db/queries/friend-pools";
import { getMatchById, type DbMatch } from "@/lib/db/queries/matches";
import { getUserAccessState } from "@/lib/db/queries/users";
import { isLiveStateActionable, IN_PLAY_ACT_MAX_AGE_MS } from "@/lib/live/freshness";
import { getInPlayState, type InPlayState } from "@/lib/live/in-play-state";
import { matchUnavailableReason } from "@/lib/live/phase";
import { buildLiveStamp, liveColumns, type LiveStamp } from "@/lib/live/stamp";
import {
  CreatePoolSchema,
  MAX_ENTRIES_PER_POOL,
  parseBettorName,
  parseManualScore,
  parsePoolBet,
} from "@/lib/pools/pool-schema";
import {
  POOL_EXTEND_PRESETS_MIN,
  poolBetsOpen,
  poolEntriesRemovable,
  poolExtendable,
  poolExtensionUntil,
  poolHasResult,
  poolManualScoreAllowed,
  poolOwnerClosable,
  poolWindowOpen,
  type PoolExtendPreset,
} from "@/lib/pools/pool-state";

// Bolão entre amigos (#567). Escrita só no nosso DB: sem LLM, sem Odds API. O dono vem
// SEMPRE do auth(); ids do form só endereçam, as queries filtram por userId. Com o
// modo ao vivo (#580, ADR 0060 §7), depois do apito o estado do jogo é relido AQUI no
// servidor (`getInPlayState`, que pode buscar na API-Football); nada de minuto ou
// placar vem do cliente.

export type PoolActionResult = { ok: true } | { ok: false; error: string };

const IdSchema = z.uuid();

async function requireUser(): Promise<{ id: string; role: "admin" | "user" } | { error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Faça login para usar o bolão." };
  const access = await getUserAccessState(session.user.id);
  if (!access) return { error: "Sua sessão expirou. Faça login novamente." };
  if (!access.allowed && !isEmailAllowed(session.user.email)) {
    return { error: "Seu acesso está bloqueado. Fale com o administrador." };
  }
  return { id: session.user.id, role: session.user.role === "admin" ? "admin" : "user" };
}

async function requireUserId(): Promise<string | { error: string }> {
  const user = await requireUser();
  return "error" in user ? user : user.id;
}

type PoolLiveContext = { liveMode: boolean; state: InPlayState | null };

/**
 * Flag e estado ao vivo para as regras do bolão. Antes do apito (ou com a flag
 * desligada) não lê estado nenhum. Depois, relê no servidor aceitando uma row de até
 * 2 min; mais velha, `getInPlayState` tenta buscar. Falha nunca bloqueia: sem estado,
 * as regras caem no relógio (apito + 15 min).
 */
async function readPoolLiveContext(match: DbMatch, now: Date): Promise<PoolLiveContext> {
  const liveMode = await getEnableLiveMode();
  if (!liveMode || matchUnavailableReason(match.status, match.kickoffAt, now) === null) {
    return { liveMode, state: null };
  }
  try {
    const state = await getInPlayState(match, { now, maxAgeMs: IN_PLAY_ACT_MAX_AGE_MS });
    return { liveMode, state };
  } catch (err) {
    console.warn(
      JSON.stringify({
        scope: "friend-pools",
        event: "in_play_state_failed",
        matchId: match.id,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return { liveMode, state: null };
  }
}

/**
 * Carimbo da aposta anotada depois do apito (ADR 0060 §7): minuto e placar do estado
 * lido no servidor quando ele tem no máximo 2 min; senão o carimbo de relógio, sem
 * placar (o bolão não depende do modelo, então não recusa). Antes do apito: `null`.
 */
function poolEntryStamp(match: DbMatch, ctx: PoolLiveContext, now: Date): LiveStamp | null {
  if (matchUnavailableReason(match.status, match.kickoffAt, now) === null) return null;
  const clock = (): LiveStamp =>
    buildLiveStamp({
      source: "clock",
      status: null,
      elapsed: null,
      extra: null,
      minuteLabel: null,
      score: null,
      red: null,
      fetchedAt: null,
      recordedAt: now,
    });
  const s = ctx.state;
  if (s === null || !isLiveStateActionable(s.fetchedAt, now)) return clock();
  try {
    return buildLiveStamp({
      source: "api_football",
      status: s.statusShort,
      elapsed: s.elapsed,
      extra: s.extra,
      minuteLabel: s.minuteLabel,
      score: s.score,
      red: s.red,
      fetchedAt: s.fetchedAt,
      recordedAt: now,
    });
  } catch {
    // Payload do provider fora dos limites do carimbo: anota pelo relógio, sem travar.
    return clock();
  }
}

function field(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

export async function createFriendPool(
  _prev: PoolActionResult | null,
  formData: FormData,
): Promise<PoolActionResult> {
  const parsed = CreatePoolSchema.safeParse({
    matchId: field(formData, "matchId"),
    title: field(formData, "title"),
    entryAmountCents: field(formData, "entryAmount"),
  });
  if (!parsed.success) {
    const badAmount = parsed.error.issues.some((i) => i.path[0] === "entryAmountCents");
    return {
      ok: false,
      error: badAmount
        ? "Valor por pessoa inválido. Use algo como 10 ou 10,50."
        : "Escolha um jogo da lista.",
    };
  }

  const userId = await requireUserId();
  if (typeof userId !== "string") return { ok: false, ...userId };

  const match = await getMatchById(parsed.data.matchId);
  if (!match) return { ok: false, error: "Jogo não encontrado." };
  const now = new Date();
  const ctx = await readPoolLiveContext(match, now);
  if (!poolWindowOpen(match, ctx.state, now, { liveMode: ctx.liveMode })) {
    return {
      ok: false,
      error: ctx.liveMode
        ? "As apostas desse jogo já fecharam (o bolão aceita apostas até os 15 minutos de jogo). Escolha outro jogo."
        : "Esse jogo já começou. Escolha um que ainda não começou.",
    };
  }

  const id = await insertFriendPool({ userId, ...parsed.data });
  revalidatePath("/bolao");
  redirect(`/bolao/${id}`);
}

export async function addFriendPoolEntry(
  _prev: PoolActionResult | null,
  formData: FormData,
): Promise<PoolActionResult> {
  const poolId = IdSchema.safeParse(field(formData, "poolId"));
  if (!poolId.success) return { ok: false, error: "Bolão não encontrado." };
  const bettorName = parseBettorName(field(formData, "bettorName"));
  if (!bettorName) return { ok: false, error: "Escreva o nome do apostador." };
  const bet = parsePoolBet({
    kind: field(formData, "kind"),
    pick: field(formData, "pick"),
    home: field(formData, "home"),
    away: field(formData, "away"),
  });
  if (!bet) return { ok: false, error: "Escolha a aposta (no placar, os dois números)." };

  const userId = await requireUserId();
  if (typeof userId !== "string") return { ok: false, ...userId };

  const pool = await getFriendPool(poolId.data, userId);
  if (!pool) return { ok: false, error: "Bolão não encontrado." };
  const now = new Date();
  const ctx = await readPoolLiveContext(pool.match, now);
  if (!poolBetsOpen(pool.pool, pool.match, ctx.state, now, { liveMode: ctx.liveMode })) {
    return {
      ok: false,
      error: poolHasResult(pool.pool, pool.match)
        ? "Este bolão já tem resultado: não entram mais apostas."
        : ctx.liveMode
          ? "As apostas deste bolão fecharam."
          : "O jogo já começou: as apostas deste bolão fecharam.",
    };
  }
  if (pool.entries.length >= MAX_ENTRIES_PER_POOL) {
    return { ok: false, error: `O bolão aceita até ${MAX_ENTRIES_PER_POOL} apostas.` };
  }

  await insertFriendPoolEntry({
    poolId: poolId.data,
    bettorName,
    ...bet,
    ...liveColumns(poolEntryStamp(pool.match, ctx, now)),
  });
  revalidatePath(`/bolao/${poolId.data}`);
  return { ok: true };
}

// Tirar aposta só antes do apito, com ou sem modo ao vivo (ADR 0060 §7): depois dele,
// tirar quem está perdendo mudaria o pote e a parte de cada ganhador.
export async function removeFriendPoolEntry(formData: FormData): Promise<void> {
  const poolId = IdSchema.safeParse(field(formData, "poolId"));
  const entryId = IdSchema.safeParse(field(formData, "entryId"));
  if (!poolId.success || !entryId.success) return;
  const userId = await requireUserId();
  if (typeof userId !== "string") return;
  const pool = await getFriendPool(poolId.data, userId);
  if (!pool || !poolEntriesRemovable(pool.match)) return;
  await deleteFriendPoolEntry({ entryId: entryId.data, poolId: poolId.data, userId });
  revalidatePath(`/bolao/${poolId.data}`);
}

export async function setFriendPoolScore(
  _prev: PoolActionResult | null,
  formData: FormData,
): Promise<PoolActionResult> {
  const poolId = IdSchema.safeParse(field(formData, "poolId"));
  if (!poolId.success) return { ok: false, error: "Bolão não encontrado." };
  const clear = field(formData, "intent") === "clear";
  const score = clear
    ? null
    : parseManualScore(field(formData, "home"), field(formData, "away"));
  if (!clear && !score) {
    return { ok: false, error: "Digite os dois números do placar (0 a 30)." };
  }

  const userId = await requireUserId();
  if (typeof userId !== "string") return { ok: false, ...userId };

  const pool = await getFriendPool(poolId.data, userId);
  if (!pool) return { ok: false, error: "Bolão não encontrado." };
  if (!clear) {
    const now = new Date();
    const ctx = await readPoolLiveContext(pool.match, now);
    if (!poolManualScoreAllowed(pool.pool, pool.match, ctx.state, now, { liveMode: ctx.liveMode })) {
      return { ok: false, error: "O placar só pode ser lançado depois que as apostas fecham." };
    }
  }

  await setFriendPoolManualScore({ poolId: poolId.data, userId, score });
  revalidatePath(`/bolao/${poolId.data}`);
  revalidatePath("/bolao");
  return { ok: true };
}

// "Fechar apostas" do dono (#580, ADR 0060 §7): só fecha, nunca reabre. Só o dono
// chega aqui (getFriendPool filtra por userId), só com as apostas abertas e só com o
// modo ao vivo (flag desligada = como antes, sem o controle).
export async function closeFriendPoolBets(formData: FormData): Promise<void> {
  const poolId = IdSchema.safeParse(field(formData, "poolId"));
  if (!poolId.success) return;
  const userId = await requireUserId();
  if (typeof userId !== "string") return;
  const pool = await getFriendPool(poolId.data, userId);
  if (!pool) return;
  const now = new Date();
  const ctx = await readPoolLiveContext(pool.match, now);
  if (!poolOwnerClosable(pool.pool, pool.match, ctx.state, now, { liveMode: ctx.liveMode })) {
    return;
  }
  await setFriendPoolBetsClosed({ poolId: poolId.data, userId, now });
  revalidatePath(`/bolao/${poolId.data}`);
  revalidatePath("/bolao");
}

const ExtendMinutesSchema = z.coerce
  .number()
  .int()
  .refine((n) => (POOL_EXTEND_PRESETS_MIN as readonly number[]).includes(n));

// "Estender prazo" do admin (#580, ADR 0060 §7): +15/+30/+60 min a partir de agora,
// teto apito + 3h. Só nos bolões do PRÓPRIO admin: getFriendPool filtra pelo userId da
// sessão, e não existe tela de admin de bolões alheios. Limpa o "fechar" do dono. Só
// depois do apito e sem resultado no bolão (`poolExtendable`).
export async function extendFriendPoolBets(formData: FormData): Promise<void> {
  const poolId = IdSchema.safeParse(field(formData, "poolId"));
  const minutes = ExtendMinutesSchema.safeParse(field(formData, "minutes"));
  if (!poolId.success || !minutes.success) return;
  const user = await requireUser();
  if ("error" in user || user.role !== "admin") return;
  const pool = await getFriendPool(poolId.data, user.id);
  if (!pool) return;
  const now = new Date();
  const ctx = await readPoolLiveContext(pool.match, now);
  if (!poolExtendable(pool.pool, pool.match, ctx.state, now, { liveMode: ctx.liveMode })) return;
  const until = poolExtensionUntil(pool.match, now, minutes.data as PoolExtendPreset);
  if (!until) return;
  await setFriendPoolBetsExtended({ poolId: poolId.data, userId: user.id, until, now });
  revalidatePath(`/bolao/${poolId.data}`);
  revalidatePath("/bolao");
}

export async function removeFriendPool(formData: FormData): Promise<void> {
  const poolId = IdSchema.safeParse(field(formData, "poolId"));
  if (!poolId.success) return;
  const userId = await requireUserId();
  if (typeof userId !== "string") return;
  await deleteFriendPool(poolId.data, userId);
  revalidatePath("/bolao");
  redirect("/bolao");
}
