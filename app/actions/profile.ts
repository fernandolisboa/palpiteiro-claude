"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth, unstable_update } from "@/auth";
import { updateUser } from "@/lib/db/queries/users";

export type UpdateProfileResult = { ok: boolean; error?: string };

// Schemas locais (mesmo padrão de app/actions/invites.ts: trim manual antes do
// safeParse, já que z.string()/z.url() não fazem trim).
const nameSchema = z.string().min(1).max(80);
const urlSchema = z.url();

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
  // (trigger "update"), refletindo o nome/avatar na hora.
  await unstable_update({ user: { name, image } });

  revalidatePath("/perfil");
  revalidatePath("/", "layout");
  return { ok: true };
}
