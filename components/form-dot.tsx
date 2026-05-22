type Result = "W" | "D" | "L";

const CONFIG: Record<Result, { className: string; label: string; title: string }> = {
  W: {
    className: "bg-form-win-bg text-form-win-fg",
    label: "V",
    title: "Vitória",
  },
  D: {
    className: "bg-form-draw-bg text-form-draw-fg",
    label: "E",
    title: "Empate",
  },
  L: {
    className: "bg-form-loss-bg text-form-loss-fg",
    label: "D",
    title: "Derrota",
  },
};

export function FormDot({ r }: { r: Result }) {
  const cfg = CONFIG[r];
  return (
    <span
      className={`inline-flex h-5 w-5 items-center justify-center rounded-full font-mono text-[10px] font-semibold ${cfg.className}`}
      aria-label={cfg.title}
    >
      {cfg.label}
    </span>
  );
}
