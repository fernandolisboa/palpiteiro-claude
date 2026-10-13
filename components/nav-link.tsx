import { cva } from "class-variance-authority";

/**
 * Estilo compartilhado de link de nav (ADR 0029): foco visível + estado ativo
 * via `aria-[current=page]`. Duas formas: `inline` (barra do computador,
 * `components/nav/desktop-nav.tsx`) e `row` (linhas do drawer do celular).
 */
const navLinkVariants = cva(
  "transition-colors focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
  {
    variants: {
      variant: {
        inline:
          "text-body-sm tracking-tight text-muted-foreground hover:text-foreground aria-[current=page]:text-foreground",
        row: "flex min-h-11 items-center rounded-md px-3 py-3 text-label tracking-tight text-muted-foreground hover:bg-accent hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-foreground",
      },
    },
    defaultVariants: {
      variant: "inline",
    },
  }
);

export { navLinkVariants };
