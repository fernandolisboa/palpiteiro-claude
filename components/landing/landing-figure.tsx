import type { ReactNode } from "react";

/**
 * Moldura das ilustrações da landing (ADR 0059). A prévia é texto fictício: fica
 * `aria-hidden` + `inert` (o leitor de tela não a lê como conteúdo e nada dentro dela
 * recebe foco), com uma descrição `sr-only` e a legenda visível que impede ler a
 * ilustração como registro de verdade (ADR 0048 D4).
 */
export function LandingFigure({
  description,
  children,
}: {
  /** O que a prévia mostra, pra leitor de tela. */
  description: string;
  children: ReactNode;
}) {
  return (
    <figure className="flex flex-col gap-2">
      <div aria-hidden="true" inert className="select-none">
        {children}
      </div>
      <figcaption className="text-meta tracking-tight text-muted-foreground">
        <span className="sr-only">{description} </span>
        Exemplo ilustrativo, com times fictícios.
      </figcaption>
    </figure>
  );
}
