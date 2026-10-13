"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { auth } from "@/auth";
import { isEmailAllowed } from "@/lib/auth/whitelist";
import {
  deleteFriendPool,
  deleteFriendPoolEntry,
  getFriendPool,
  insertFriendPool,
  insertFriendPoolEntry,
  setFriendPoolManualScore,
} from "@/lib/db/queries/friend-pools";
import { getMatchById } from "@/lib/db/queries/matches";
import { getUserAccessState } from "@/lib/db/queries/users";
import {
  CreatePoolSchema,
  MAX_ENTRIES_PER_POOL,
  parseBettorName,
  parseManualScore,
  parsePoolBet,
} from "@/lib/pools/pool-schema";
import { poolBetsOpen } from "@/lib/pools/pool-state";

// Bolão entre amigos (#567). Só escrita no nosso DB: sem LLM, sem Odds API, sem
// provider. O dono vem SEMPRE do auth(); ids do form só endereçam, as queries filtram
// por userId.

export type PoolActionResult = { ok: true } | { ok: false; error: string };

const IdSchema = z.uuid();

async function requireUserId(): Promise<string | { error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Faça login para usar o bolão." };
  const access = await getUserAccessState(session.user.id);
  if (!access) return { error: "Sua sessão expirou. Faça login novamente." };
  if (!access.allowed && !isEmailAllowed(session.user.email)) {
    return { error: "Seu acesso está bloqueado. Fale com o administrador." };
  }
  return session.user.id;
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
  if (!poolBetsOpen(match)) {
    return { ok: false, error: "Esse jogo já começou. Escolha um que ainda não começou." };
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
  if (!poolBetsOpen(pool.match)) {
    return { ok: false, error: "O jogo já começou: as apostas deste bolão fecharam." };
  }
  if (pool.entries.length >= MAX_ENTRIES_PER_POOL) {
    return { ok: false, error: `O bolão aceita até ${MAX_ENTRIES_PER_POOL} apostas.` };
  }

  await insertFriendPoolEntry({ poolId: poolId.data, bettorName, ...bet });
  revalidatePath(`/bolao/${poolId.data}`);
  return { ok: true };
}

export async function removeFriendPoolEntry(formData: FormData): Promise<void> {
  const poolId = IdSchema.safeParse(field(formData, "poolId"));
  const entryId = IdSchema.safeParse(field(formData, "entryId"));
  if (!poolId.success || !entryId.success) return;
  const userId = await requireUserId();
  if (typeof userId !== "string") return;
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
  if (!clear && poolBetsOpen(pool.match)) {
    return { ok: false, error: "O placar só pode ser lançado depois que o jogo começa." };
  }

  await setFriendPoolManualScore({ poolId: poolId.data, userId, score });
  revalidatePath(`/bolao/${poolId.data}`);
  revalidatePath("/bolao");
  return { ok: true };
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
