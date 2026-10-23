import type { Metadata } from "next";
import { IntentLink } from "@/components/intent-link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { MODEL_REGISTRY, modelsForAudience } from "@/lib/ai/models";
import { getDefaultModelId } from "@/lib/db/queries/ai-config";
import { listAuthenticatorsByUserId } from "@/lib/db/queries/authenticators";
import { getUserProfile } from "@/lib/db/queries/users";
import {
  DATA_REQUEST_RESPONSE_DAYS,
  LEGAL_CONTACT_EMAIL,
} from "@/lib/legal/controller";

import { PasskeysSection } from "./passkeys-section";
import { PreferredModelForm } from "./preferred-model-form";
import { ProfileForm } from "./profile-form";
import { RevisitRefresh } from "@/components/revisit-refresh";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Perfil" };

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
    <div className="bg-background text-foreground">
      <RevisitRefresh />
      <PageContainer width="reading">
        <PageHeader title="Perfil" description="seu nome e avatar · visíveis no app" />

        <ProfileForm
          email={profile.email}
          initialName={profile.name ?? ""}
          initialImage={profile.image ?? ""}
        />

        <div id="modelo-de-analise" className="border-border mt-10 scroll-mt-20 border-t pt-8">
          <h2 className="text-display-sm font-medium tracking-tight">
            Modelo de análise
          </h2>
          <p className="text-muted-foreground pb-6 text-meta">
            usado nas suas análises · sobrescreve o padrão global
          </p>
          <PreferredModelForm
            models={selectableModels}
            preferredModelId={profile.preferredModelId}
            defaultModelLabel={defaultModelLabel}
          />
        </div>

        <div id="passkeys" className="border-border mt-10 scroll-mt-20 border-t pt-8">
          <h2 className="text-display-sm font-medium tracking-tight">
            Passkeys
          </h2>
          <p className="text-muted-foreground pb-6 text-meta">
            login sem senha · biometria ou PIN do dispositivo
          </p>
          <PasskeysSection authenticators={authenticators} />
        </div>

        {/* Caminho visível pros direitos do titular (LGPD art. 18) enquanto a exclusão
            self-serve (ADR 0046) não existe: o pedido sai do e-mail da conta, o que já
            confirma a titularidade. */}
        <div id="seus-dados" className="border-border mt-10 scroll-mt-20 border-t pt-8">
          <h2 className="text-display-sm font-medium tracking-tight">
            Seus dados
          </h2>
          <p className="text-muted-foreground pb-4 text-meta">
            cópia · correção · exclusão da conta · LGPD
          </p>
          <p className="text-body-sm leading-relaxed tracking-tight text-muted-foreground">
            Para pedir uma cópia dos seus dados ou excluir sua conta, escreva do e-mail
            desta conta para{" "}
            <a
              href={`mailto:${LEGAL_CONTACT_EMAIL}?subject=${encodeURIComponent("Meus dados no Palpiteiro")}`}
              className="text-foreground rounded-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {LEGAL_CONTACT_EMAIL}
            </a>
            . Respondemos em até {DATA_REQUEST_RESPONSE_DAYS} dias. O que é apagado e o
            que fica anonimizado está na{" "}
            <IntentLink
              href="/privacidade"
              className="text-foreground rounded-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              Política de Privacidade
            </IntentLink>
            .
          </p>
        </div>
      </PageContainer>
    </div>
  );
}
