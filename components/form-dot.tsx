type Result = "W" | "D" | "L";

const CONFIG: Record<Result, { bg: string; fg: string; label: string; title: string }> = {
  W: { bg: "oklch(0.36 0.07 145)", fg: "oklch(0.85 0.13 145)", label: "V", title: "Vitória" },
  D: { bg: "oklch(0.32 0 0)", fg: "oklch(0.75 0 0)", label: "E", title: "Empate" },
  L: { bg: "oklch(0.32 0.06 25)", fg: "oklch(0.78 0.13 25)", label: "D", title: "Derrota" },
};

export function FormDot({ r }: { r: Result }) {
  const cfg = CONFIG[r];
  return (
    <span
      className="inline-flex h-5 w-5 items-center justify-center rounded-full font-mono text-[10px] font-semibold"
      style={{ background: cfg.bg, color: cfg.fg }}
      title={cfg.title}
    >
      {cfg.label}
    </span>
  );
}
