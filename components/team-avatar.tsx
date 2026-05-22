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
      className={cn(
        "inline-flex items-center justify-center rounded-full border border-border font-medium",
        className,
      )}
      style={{
        width: size,
        height: size,
        background: `oklch(0.32 0.04 ${hue})`,
        color: `oklch(0.88 0.04 ${hue})`,
        fontSize: size * 0.36,
        letterSpacing: "-0.02em",
      }}
    >
      {initials}
    </div>
  );
}
