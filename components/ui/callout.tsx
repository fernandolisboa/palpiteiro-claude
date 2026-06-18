import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const calloutVariants = cva(
  "flex items-start gap-3 rounded-xl border px-5 py-4 text-card-foreground",
  {
    variants: {
      variant: {
        info: "border-accent-border bg-accent-soft",
        warn: "border-warn-border bg-card",
        destructive: "border-destructive/40 bg-card",
      },
    },
    defaultVariants: {
      variant: "info",
    },
  }
)

const calloutIconColor: Record<
  NonNullable<VariantProps<typeof calloutVariants>["variant"]>,
  string
> = {
  info: "text-accent-fg",
  warn: "text-warn-fg",
  destructive: "text-destructive",
}

/**
 * Callout/Alert único (ADR 0029): ícone opcional + título + corpo, com variante
 * semântica (info/warn/destructive) mapeada pros tokens de cor. Substitui as
 * cópias divergentes (analysis-error-card, error.tsx, market-run-summary, odds).
 * Nesta fatia só `error.tsx` o adota; os de conteúdo migram nos heirs.
 */
function Callout({
  className,
  variant = "info",
  icon,
  title,
  children,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof calloutVariants> & {
    icon?: React.ReactNode
    title?: React.ReactNode
  }) {
  return (
    <div
      data-slot="callout"
      data-variant={variant}
      className={cn(calloutVariants({ variant }), className)}
      {...props}
    >
      {icon && (
        <span className={cn("shrink-0 pt-0.5", calloutIconColor[variant ?? "info"])}>
          {icon}
        </span>
      )}
      <div className="flex flex-1 flex-col gap-2">
        {title && (
          <span className="text-label font-medium tracking-tight">{title}</span>
        )}
        {children}
      </div>
    </div>
  )
}

export { Callout, calloutVariants }
