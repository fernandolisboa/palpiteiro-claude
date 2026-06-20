import { Check } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { LiveBadge } from "@/components/live-badge";
import type { MatchRowView } from "@/lib/view/types";

// Célula de status da grade desktop (home). Vive num arquivo próprio (NÃO pode
// ser export nomeado de app/page.tsx — Next rejeita exports não-padrão num page
// file) e por isso tem teste de render próprio. O marcador "analisado" aparece
// em jogos encerrados-já-analisados pra casar com o mobile
// (components/match-row.tsx), evitando que as duas superfícies divirjam (#99).
export function DesktopStatusCell({ m }: { m: MatchRowView }) {
  return (
    <div className="flex flex-col items-end justify-center gap-1">
      {m.status === "live" || m.isInProgress ? (
        // Em andamento (#385): o pulso amber em vez de '—'/'analisado'. Mesmo gate
        // OR do mobile — isInProgress pega o recém-apitado stale-`scheduled`.
        <LiveBadge />
      ) : m.status === "finished" ? (
        // Encerrado ainda surfaça "analisado" se o usuário já analisou: o
        // resultado read-only segue acessível na página de detalhe.
        <>
          <span className="font-mono text-eyebrow uppercase tracking-label text-muted-fg-2">
            encerrado
          </span>
          {m.hasPrediction && (
            <span className="inline-flex items-center gap-1 font-mono text-eyebrow text-accent-fg">
              <Check className="size-3" /> analisado
            </span>
          )}
        </>
      ) : m.status === "postponed" || m.status === "cancelled" ? (
        <span className="font-mono text-eyebrow text-muted-fg-2">—</span>
      ) : m.hasPrediction ? (
        <Badge
          variant="outline"
          size="sm"
          className="border-accent-border bg-accent-soft text-accent-fg"
        >
          <Check className="size-3" /> analisado
        </Badge>
      ) : (
        <span className="font-mono text-eyebrow text-muted-fg-2">—</span>
      )}
    </div>
  );
}
