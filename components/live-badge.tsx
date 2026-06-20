// Indicador único "ao vivo" (#385): fonte da verdade do pulso amber pras quatro
// superfícies (hero, linha mobile, célula de status desktop, célula de odds
// desktop) — extraído verbatim de match-hero.tsx, com o label "AO VIVO" (PT-BR,
// casa com a copy "Jogo em andamento"; uppercase casa o eyebrow mono). Reusa o
// token sancionado warn-fg + o pulso reduced-motion-correto (a11y).
export function LiveBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-warn-fg">
      <span className="size-1.5 rounded-full bg-warn-fg animate-pulse motion-reduce:animate-none" />
      AO VIVO
    </span>
  );
}
