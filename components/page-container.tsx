import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const WIDTH = {
  wide: "max-w-wide",
  content: "max-w-content",
  reading: "max-w-reading",
} as const;

/**
 * Wrapper das telas logadas de usuário e públicas (ADR 0056, ADR 0059): três larguras
 * (`content` 1040 pra listas e painéis, `reading` 640 pro resto e `wide` 1280 SÓ pra
 * página do jogo, que tem a coluna de 340px do Suas apostas ao lado) e um gutter só. A
 * lista sangrada do celular de `/jogos` e `/time` não usa (cada bloco tem o próprio
 * `px-5`). O `data-page-width` é lido pelo `app/globals.css` pra o rodapé global seguir
 * a largura da coluna (`body:has(...) [data-footer-column]`).
 */
export function PageContainer({
  width,
  className,
  children,
}: {
  width: keyof typeof WIDTH;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-page-width={width}
      className={cn(
        "mx-auto w-full px-5 pt-6 pb-16 lg:px-8 lg:pt-10",
        WIDTH[width],
        className,
      )}
    >
      {children}
    </div>
  );
}
