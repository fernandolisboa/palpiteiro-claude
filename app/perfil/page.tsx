import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { auth } from "@/auth";
import { getUserProfile } from "@/lib/db/queries/users";

import { ProfileForm } from "./profile-form";

export const dynamic = "force-dynamic";

export default async function PerfilPage() {
  // O middleware já exige sessão; o guard é defensivo e estreita o tipo.
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  // Sessão JWT pode apontar pra um id que não existe mais (reset + claim-admin);
  // trata como sessão órfã, igual ao guard de `userExists` no fluxo de predição.
  const profile = await getUserProfile(session.user.id);
  if (!profile) redirect("/signin");

  return (
    <div className="bg-background text-foreground min-h-screen">
      <div className="mx-auto w-full max-w-[640px] px-6 py-8">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 pb-6"
        >
          <ChevronLeft className="size-3.5" />
          <span className="text-[12.5px] tracking-tight">jogos</span>
        </Link>

        <h1 className="text-[20px] font-medium tracking-[-0.02em]">Perfil</h1>
        <p className="text-muted-foreground pb-6 font-mono text-[11px]">
          seu nome e avatar · visíveis no app
        </p>

        <ProfileForm
          email={profile.email}
          initialName={profile.name ?? ""}
          initialImage={profile.image ?? ""}
        />
      </div>
    </div>
  );
}
