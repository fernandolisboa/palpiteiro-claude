import { AdminSubTabs } from "@/components/admin/admin-sub-tabs";
import { FlagList } from "@/components/admin/flag-list";
import { PageHeading } from "@/components/admin/page-heading";
import { getAdminFlagValues } from "@/lib/db/queries/ai-config";

import { TeamRatingsPanel } from "./team-ratings-panel";
import { RevisitRefresh } from "@/components/revisit-refresh";

export const dynamic = "force-dynamic";
// "Reajustar agora" roda o refit do Dixon-Coles na server action desta página.
export const maxDuration = 300;

// Motor e calibração · motor (#633; antes parte do /admin/settings): o motor de
// análise e as flags que decidem as probabilidades, mais o Dixon-Coles. As flags do
// modelo de linguagem moram em /admin/ia. Gateado por app/(app)/admin/layout.tsx.
export default async function AdminEnginePage() {
  const flagValues = await getAdminFlagValues();

  return (
    <div className="bg-background text-foreground">
      <RevisitRefresh />
      <div className="mx-auto w-full max-w-reading px-6 py-8">
        <PageHeading
          title="Motor e calibração"
          subtitle="quem decide as probabilidades · Dixon-Coles · JEV · stake"
        />
        <AdminSubTabs section="/admin/motor" current="/admin/motor" />

        <FlagList area="motor" values={flagValues} className="" />

        <TeamRatingsPanel enabled={flagValues.enableDixonColes === true} />
      </div>
    </div>
  );
}
