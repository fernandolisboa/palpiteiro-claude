import { AdminFlagControl } from "@/components/admin/admin-flag-control";
import { DefinitionRow } from "@/components/admin/definition-row";
import {
  adminFlagsFor,
  type AdminFlagArea,
  type AdminFlagDef,
  type AdminFlagValues,
} from "@/lib/config/admin-flags";

/**
 * Flags de uma área do admin (#633), renderizadas do registry
 * (`lib/config/admin-flags.ts`): flag nova entra lá, com a `area`, sem mexer aqui.
 */
export function FlagList({
  area,
  values,
  className = "pt-10",
}: {
  area: AdminFlagArea;
  values: AdminFlagValues;
  className?: string;
}) {
  return (
    <section className={className}>
      <h2 className="pb-3 font-mono text-meta uppercase tracking-label text-muted-foreground">
        flags
      </h2>
      <div className="rounded-md border border-border">
        {adminFlagsFor(area).map((flag) => {
          const current = values[flag.key];
          return (
            <DefinitionRow
              key={flag.key}
              className="items-start gap-4 px-4 py-3 last:border-b-0"
              label={
                <div className="flex flex-col gap-1">
                  <span className="text-body font-medium">
                    {flag.label} · {formatFlagValue(flag, current)}
                  </span>
                  <span className="text-body-sm text-muted-foreground">
                    {flag.description}
                  </span>
                  {"costNote" in flag && flag.costNote && (
                    <span className="font-mono text-meta text-muted-foreground">
                      custo: {flag.costNote}
                    </span>
                  )}
                </div>
              }
              value={<AdminFlagControl flag={flag} current={current} />}
            />
          );
        })}
      </div>
      <p className="pt-3 text-body-sm text-muted-foreground">
        Valem para todos os usuários, sem redeploy.
      </p>
    </section>
  );
}

function formatFlagValue(flag: AdminFlagDef, value: boolean | string): string {
  if (flag.kind === "boolean") return value ? "ligada" : "desligada";
  return flag.valueLabels?.[String(value)] ?? String(value);
}
