import { ResultBadge } from "@/components/result-badge";
import { Badge } from "@/components/ui/badge";
import type { PalpiteLineView } from "@/lib/view/palpites";

// Rótulo do TIPO do palpite ("placar exato"/"cartão vermelho"/"escanteios").
// Badge outline size=xs, neutro — identifica a categoria sem competir com o estado.
export function TypeBadge({ label }: { label: string }) {
  return (
    <Badge variant="outline" size="xs" className="tracking-tight">
      {label}
    </Badge>
  );
}

// Estado de um palpite SETTLEABLE (exact_score), PLAN §5: o selo único de resultado
// (`ResultBadge`, ADR 0056), sempre com a palavra ("Em aberto"/"Acertou"/"Errou").
export function SettleableBadge({
  state,
}: {
  state: Extract<PalpiteLineView["state"], { kind: "pending" | "settled" }>;
}) {
  return <ResultBadge result={state.kind === "pending" ? "pending" : state.result} />;
}

// Palpite NÃO-liquidável (red_card/corners): tag muted PERMANENTE "só por
// diversão". Honestidade de settleable (PLAN §0.4): fun nunca vira acertou/errou.
export function NonSettleableTag() {
  return (
    <span className="text-meta tracking-tight text-muted-foreground">
      só por diversão
    </span>
  );
}
