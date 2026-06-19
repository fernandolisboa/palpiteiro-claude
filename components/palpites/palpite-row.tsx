import {
  NonSettleableTag,
  SettleableBadge,
  TypeBadge,
} from "@/components/palpites/palpite-badges";
import type { PalpiteLineView } from "@/lib/view/palpites";

// Uma LINHA de palpite: a frase humana + TypeBadge + (SettleableBadge | NonSettleableTag).
// O estado já vem DERIVADO do mapper (lib/view/palpites) — aqui só se ramifica por
// `state.kind` pra escolher o sufixo. exact_score (pending/settled) → SettleableBadge;
// fun (red_card/corners) → NonSettleableTag permanente.
export function PalpiteRow({ line }: { line: PalpiteLineView }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-body tracking-tight text-foreground">{line.text}</p>
      <div className="flex flex-wrap items-center gap-2">
        <TypeBadge label={line.typeLabel} />
        {line.state.kind === "fun" ? (
          <NonSettleableTag />
        ) : (
          <SettleableBadge state={line.state} />
        )}
      </div>
    </div>
  );
}
