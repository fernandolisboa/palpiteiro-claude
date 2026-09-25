"use client";

import { useActionState } from "react";

import {
  updateAdminFlag,
  type UpdateAdminFlagResult,
} from "@/app/actions/ai-config";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { AdminFlagDef } from "@/lib/config/admin-flags";

type Props = {
  flag: AdminFlagDef;
  current: boolean | string;
};

/**
 * Controle de uma flag do registry (#514): boolean → botão Ligar/Desligar (como o
 * LeagueToggle); enum → select + salvar. O server revalida key e valor.
 */
export function AdminFlagControl({ flag, current }: Props) {
  const [state, action, pending] = useActionState<
    UpdateAdminFlagResult | null,
    FormData
  >(updateAdminFlag, null);

  return (
    <form action={action} className="flex shrink-0 flex-col items-end gap-1">
      <input type="hidden" name="key" value={flag.key} />
      {flag.kind === "boolean" ? (
        <>
          <input type="hidden" name="value" value={current ? "false" : "true"} />
          <Button
            type="submit"
            size="sm"
            variant={current ? "outline" : "default"}
            disabled={pending}
            aria-label={`${current ? "Desligar" : "Ligar"} ${flag.label}`}
          >
            {pending ? "Salvando…" : current ? "Desligar" : "Ligar"}
          </Button>
        </>
      ) : (
        <div className="flex items-center gap-2">
          <Select
            name="value"
            defaultValue={String(current)}
            aria-label={flag.label}
          >
            {flag.values.map((v) => (
              <option
                key={v}
                value={v}
                className="bg-popover text-popover-foreground"
              >
                {flag.valueLabels?.[v] ?? v}
              </option>
            ))}
          </Select>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      )}
      {state && !state.ok && (
        <p
          className="max-w-aside text-body-sm text-destructive text-right"
          role="alert"
          aria-live="assertive"
        >
          {state.error}
        </p>
      )}
    </form>
  );
}
