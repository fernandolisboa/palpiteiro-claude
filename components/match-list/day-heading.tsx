import { cn } from "@/lib/utils";

// Cabeçalho de dia da lista de jogos (#577): "Hoje", "Amanhã", "Sábado 17/10", no
// fuso do usuário (lib/view/match.ts). No celular fica fora do cartão, na sangria da
// lista (`bleed`); no desktop é a faixa de grupo dentro do cartão (`band`).
export function DayHeading({
  label,
  variant,
  className,
}: {
  label: string;
  variant: "bleed" | "band";
  className?: string;
}) {
  return (
    <h2
      className={cn(
        "text-body-sm font-medium tracking-tight text-foreground",
        variant === "bleed"
          ? "px-5 pt-5 pb-2"
          : "border-b border-border-subtle bg-surface-2 px-5 py-2",
        className,
      )}
    >
      {label}
    </h2>
  );
}
