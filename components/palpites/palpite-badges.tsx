import { Badge } from "@/components/ui/badge";
import type { PalpiteLineView } from "@/lib/view/palpites";

// Rótulo do TIPO do palpite ("placar exato"/"cartão vermelho"/"escanteios").
// Badge outline size=xs, neutro — identifica a categoria sem competir com o estado.
export function TypeBadge({ label }: { label: string }) {
  return (
    <Badge variant="outline" size="xs" className="font-mono tracking-tight">
      {label}
    </Badge>
  );
}

// Estado de um palpite SETTLEABLE (exact_score), PLAN §5. A11y: o estado nunca
// depende só de cor — o par tint (form-*) vem com a PALAVRA ("aguardando placar"/
// "acertou"/"errou"). pending é neutro (muted), distinto de fun. won/lost reusam a
// família form-* (consistente com FormDot/o resto do app — settlement lê igual).
export function SettleableBadge({
  state,
}: {
  state: Extract<PalpiteLineView["state"], { kind: "pending" | "settled" }>;
}) {
  if (state.kind === "pending") {
    return (
      <Badge variant="secondary" size="xs" className="tracking-tight">
        aguardando placar
      </Badge>
    );
  }
  if (state.result === "won") {
    return (
      <Badge
        size="xs"
        className="border-transparent bg-form-win-bg tracking-tight text-form-win-fg"
      >
        acertou
      </Badge>
    );
  }
  return (
    <Badge
      size="xs"
      className="border-transparent bg-form-loss-bg tracking-tight text-form-loss-fg"
    >
      errou
    </Badge>
  );
}

// Palpite NÃO-liquidável (red_card/corners): tag muted PERMANENTE "só por
// diversão". Honestidade de settleable (PLAN §0.4): fun nunca vira acertou/errou.
export function NonSettleableTag() {
  return (
    <span className="text-eyebrow tracking-tight text-muted-fg-2">
      só por diversão
    </span>
  );
}
