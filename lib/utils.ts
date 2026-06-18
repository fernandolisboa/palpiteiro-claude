import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Os tokens custom de font-size do @theme (ADR 0029) precisam ser registrados no
// tailwind-merge, senão ele classifica `text-eyebrow`/`text-meta`/… como COR e os
// descarta quando o consumer passa um `text-*` de cor — quebrando o eixo `size` do
// Badge (renderizava 12px em vez de 10px). Ver #333.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "eyebrow-xs",
            "eyebrow",
            "meta",
            "body-sm",
            "body",
            "label",
            "display-sm",
            "display-md",
            "display-lg",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
