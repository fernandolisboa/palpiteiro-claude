import { redirect } from "next/navigation";

import { BackLink } from "@/components/back-link";
import { auth } from "@/auth";
import { MODEL_REGISTRY, modelsForAudience } from "@/lib/ai/models";
import { getDefaultModelId } from "@/lib/db/queries/ai-config";
import { listAuthenticatorsByUserId } from "@/lib/db/queries/authenticators";
import { getUserProfile } from "@/lib/db/queries/users";

import { PasskeysSection } from "./passkeys-section";
import { PreferredModelForm } from "./preferred-model-form";
import { ProfileForm } from "./profile-form";

export const dynamic = "force-dynamic";

export default async function PerfilPage() {
  // O middleware já exige sessão; o guard é defensivo e estreita o tipo.
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  // Sessão JWT pode apontar pra um id que não existe mais (reset + claim-admin);
  // trata como sessão órfã, igual ao guard de `getUserAccessState` no fluxo de
  // predição (e ao drop de sessão no jwt() do Node — #252).
  const [profile, defaultModelId, authenticators] = await Promise.all([
    getUserProfile(session.user.id),
    getDefaultModelId(),
    listAuthenticatorsByUserId(session.user.id),
  ]);
  if (!profile) redirect("/signin");
  const defaultModelLabel = MODEL_REGISTRY[defaultModelId].label;

  // Lista de modelos por audiência (ADR 0013), serializável ({id,label}) pra
  // cruzar a fronteira Server→Client. O gate efetivo é revalidado na action
  // updatePreferredModel.
  const isAdmin = session.user.role === "admin";
  const selectableModels = modelsForAudience(isAdmin).map((m) => ({
    id: m.id,
    label: m.label,
  }));

  return (
    <div className="bg-background text-foreground min-h-screen">
      <div className="mx-auto w-full max-w-reading px-6 py-8">
        <BackLink href="/" label="jogos" />

        <h1 className="text-display-md font-medium tracking-tight">Perfil</h1>
        <p className="text-muted-foreground pb-6 font-mono text-meta">
          seu nome e avatar · visíveis no app
        </p>

        <ProfileForm
          email={profile.email}
          initialName={profile.name ?? ""}
          initialImage={profile.image ?? ""}
        />

        <div className="border-border mt-10 border-t pt-8">
          <h2 className="text-display-sm font-medium tracking-tight">
            Modelo de análise
          </h2>
          <p className="text-muted-foreground pb-6 font-mono text-meta">
            usado nas suas análises · sobrescreve o padrão global
          </p>
          <PreferredModelForm
            models={selectableModels}
            preferredModelId={profile.preferredModelId}
            defaultModelLabel={defaultModelLabel}
          />
        </div>

        <div className="border-border mt-10 border-t pt-8">
          <h2 className="text-display-sm font-medium tracking-tight">
            Passkeys
          </h2>
          <p className="text-muted-foreground pb-6 font-mono text-meta">
            login sem senha · biometria ou PIN do dispositivo
          </p>
          <PasskeysSection authenticators={authenticators} />
        </div>
      </div>
    </div>
  );
}
