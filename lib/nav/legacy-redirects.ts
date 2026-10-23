/**
 * Endereços antigos do admin (antes do #633) → novos. Viram redirects em
 * `next.config.ts`, pra favorito e link velho seguirem abrindo (a query vai junto).
 * Sem imports: o next.config não resolve o alias `@/`.
 */
export const LEGACY_ADMIN_REDIRECTS = [
  { source: "/admin/settings", destination: "/admin/ia" },
  { source: "/admin/costs", destination: "/admin/ia/custos" },
  { source: "/admin/calibration", destination: "/admin/motor/calibracao" },
] as const;
