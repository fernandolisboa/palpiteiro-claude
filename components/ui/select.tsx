import * as React from "react"
import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Select primitivo (ADR 0029): `<select>` NATIVO estilizado — não Radix. Os
 * consumidores (perfil/admin) já são selects nativos, então é drop-in e não muda
 * o modelo de interação. `color-scheme` deixa o dropdown nativo reagir ao tema.
 * Nesta fatia é criado como fundação; os consumidores migram nos heirs.
 */
function Select({
  className,
  children,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <div className="relative inline-flex w-full">
      <select
        data-slot="select"
        className={cn(
          "h-9 w-full appearance-none rounded-md border border-input bg-transparent px-3 py-1 pr-8 text-body-sm shadow-xs transition-[color,box-shadow] outline-none [color-scheme:light] dark:[color-scheme:dark]",
          "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
          "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  )
}

export { Select }
