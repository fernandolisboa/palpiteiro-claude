import { cva } from "class-variance-authority";

/**
 * Estilo compartilhado de link de nav (ADR 0029): foco visível + estado ativo
 * via `aria-[current=page]`. Forma `inline` (barra do computador,
 * `components/nav/desktop-nav.tsx`).
 */
const navLinkVariants = cva(
  "transition-colors focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
  {
    variants: {
      variant: {
        inline:
          "text-body-sm tracking-tight text-muted-foreground hover:text-foreground aria-[current=page]:text-foreground aria-[current=true]:text-foreground",
      },
    },
    defaultVariants: {
      variant: "inline",
    },
  }
);

export { navLinkVariants };
