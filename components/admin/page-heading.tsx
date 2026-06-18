import type { ReactNode } from "react";

import { BackLink } from "@/components/back-link";

type Props = {
  backLink?: { href: string; label: string };
  title: string;
  subtitle: ReactNode;
};

/**
 * Cabeçalho das páginas bare do admin (ADR 0029 / #324): BackLink opcional +
 * título `display-md` + subtítulo mono-`meta`. Consolida o bloco título+subtítulo
 * copy-paste das 5 páginas simples. NÃO confundir com a `PageHeader` de
 * `components/page-header.tsx` (chrome de shell mobile); o idioma DesktopShell
 * (`users/[userId]`) tem cabeçalho próprio inline (escala/largura distintas).
 */
export function PageHeading({ backLink, title, subtitle }: Props) {
  return (
    <>
      {backLink && <BackLink href={backLink.href} label={backLink.label} />}
      <h1 className="text-display-md font-medium tracking-tight">{title}</h1>
      <p className="pb-6 font-mono text-meta text-muted-foreground">{subtitle}</p>
    </>
  );
}
