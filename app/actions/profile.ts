"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth, unstable_update } from "@/auth";
import { updateUser } from "@/lib/db/queries/users";

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
