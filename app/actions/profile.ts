"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth, unstable_update } from "@/auth";
import { isModelAllowedForAudience } from "@/lib/ai/models";
import { deleteAuthenticator } from "@/lib/db/queries/authenticators";
import { setPreferredModelId, updateUser } from "@/lib/db/queries/users";

export type UpdateProfileResult = { ok: boolean; error?: string };

// Schemas locais. Trim manual antes do safeParse — mesma convenção de
// app/actions/invites.ts, que apara antes do z.email() (z.string()/z.url() não
// aparam). A URL do avatar é restrita a http(s): z.url() sozinho aceitaria
// javascript:/data:/mailto: (não é XSS no <img>, mas o contrato é imagem http).
const nameSchema = z.string().min(1).max(80);
const urlSchema = z.url({ protocol: /^https?$/ });

export async function updateProfile(
  _prev: UpdateProfileResult | null,
  formData: FormData
): Promise<UpdateProfileResult> {
  // Gate por dono: edita SÓ o usuário da sessão. Nunca recebe id de terceiro —
  // o id vem da sessão, não do formData.
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Sessão inválida." };
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!nameSchema.safeParse(name).success) {
    return { ok: false, error: "Nome deve ter entre 1 e 80 caracteres." };
  }

  const rawImage = String(formData.get("image") ?? "").trim();
  let image: string | null = null;
  if (rawImage.length > 0) {
    if (!urlSchema.safeParse(rawImage).success) {
      return { ok: false, error: "URL de avatar inválida." };
    }
    image = rawImage;
  }

  await updateUser(session.user.id, { name, image });

  // Sessão é JWT: o token carrega name/picture desde o login e não revalida
  // contra o DB. Sem isto, o shell (que lê da sessão) mostraria o valor antigo
  // até o próximo login. `unstable_update` reemite o cookie pelo callback `jwt`
  // (trigger "update"), refletindo o nome/avatar na hora. Best-effort: o DB já
  // é a fonte da verdade, então uma falha de refresh não derruba o save (o
  // revalidatePath puxa os valores novos no próximo render).
  try {
    await unstable_update({ user: { name, image } });
  } catch {
    // refresh best-effort; valor já persistido no DB.
  }

  revalidatePath("/perfil");
  revalidatePath("/", "layout");
  return { ok: true };
}

// Sentinela do <select>: "Usar padrão global" → grava null (sem preferência).
const DEFAULT_SENTINEL = "default";

/**
 * Atualiza a preferência pessoal de modelo (ADR 0013). Action SEPARADA do
 * `updateProfile` de propósito: o JWT (`unstable_update`) só carrega name/image,
 * e a preferência mora só no DB (lida na cascata de predict). Mantê-las isoladas
 * evita acoplar a preferência ao refresh do cookie e isola falhas.
 *
 * Gate por dono (id vem da sessão, nunca do form) + revalidação de audiência
 * (ADR 0013): usuário comum não pode persistir um modelo admin-only (defense in
 * depth além de limitar a lista no <select>).
 */
export async function updatePreferredModel(
  _prev: UpdateProfileResult | null,
  formData: FormData,
): Promise<UpdateProfileResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Sessão inválida." };
  }
  const isAdmin = session.user.role === "admin";

  const raw = String(formData.get("preferredModelId") ?? "").trim();
  // Sentinela ou vazio → limpa a preferência (cai no default global).
  if (!raw || raw === DEFAULT_SENTINEL) {
    await setPreferredModelId(session.user.id, null);
    revalidatePath("/perfil");
    revalidatePath("/", "layout");
    return { ok: true };
  }
  // Valida contra o registry E a audiência num passo (type guard estreita pra
  // AIModelId). Um modelo admin-only vindo de usuário comum é recusado.
  if (!isModelAllowedForAudience(raw, isAdmin)) {
    return { ok: false, error: "Modelo indisponível para a sua conta." };
  }
  await setPreferredModelId(session.user.id, raw);
  revalidatePath("/perfil");
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Remove uma passkey do próprio usuário (#255). O REGISTRO de passkey NÃO é uma
 * server action: a cerimônia WebAuthn roda no browser via
 * `signIn("passkey", { action: "register" })` (next-auth/webauthn) — só a remoção
 * é mutação de DB. Gate por dono em duas camadas: o `userId` vem SEMPRE da sessão
 * (`auth()`), nunca do form; o `deleteAuthenticator` filtra por (userId,
 * credentialID). Sem mexer no JWT (remover passkey não muda role/allowed), então
 * sem `unstable_update` — só `revalidatePath` pra repopular a lista.
 */
export async function removePasskey(
  _prev: UpdateProfileResult | null,
  formData: FormData,
): Promise<UpdateProfileResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Sessão inválida." };
  }
  const credentialID = String(formData.get("credentialID") ?? "").trim();
  if (!credentialID) {
    return { ok: false, error: "Passkey inválida." };
  }
  const removed = await deleteAuthenticator(session.user.id, credentialID);
  if (removed === 0) {
    return { ok: false, error: "Passkey não encontrada." };
  }
  revalidatePath("/perfil");
  return { ok: true };
}
