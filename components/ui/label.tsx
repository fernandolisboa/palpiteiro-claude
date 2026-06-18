import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Label primitivo (ADR 0029): `<label>` nativo estilizado, consistente com o
 * Input. Pareia com o Select via `htmlFor`. Criado como fundação; consumidores
 * (perfil/admin) migram nos heirs.
 */
function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-body-sm leading-none font-medium select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
