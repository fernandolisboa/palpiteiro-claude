import { cn } from "@/lib/utils";

type Props = {
  initials: string;
  hue: number;
  size?: number;
  className?: string;
};

export function TeamAvatar({ initials, hue, size = 32, className }: Props) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "border-border inline-flex items-center justify-center rounded-full border font-medium",
        className
      )}
      style={{
        width: size,
        height: size,
        // Lightness via token por-tema (ADR 0029); o hue fica inline/intocado
        // (identidade estável). Light = 0.32/0.88 (paridade); só o dark é novo.
        background: `oklch(var(--ta-bg-l) 0.04 ${hue})`,
        color: `oklch(var(--ta-fg-l) 0.04 ${hue})`,
        fontSize: size * 0.36,
        letterSpacing: "-0.02em",
      }}
    >
      {initials}
    </div>
  );
}
