type BrandMarkProps = {
  size?: number;
  accent?: boolean;
  monogram?: boolean;
};

export function BrandMark({ size = 16, accent = false, monogram = false }: BrandMarkProps) {
  if (monogram) {
    return (
      <span
        aria-hidden="true"
        style={{
          fontFamily: "var(--font-sans)",
          fontWeight: 700,
          fontSize: size,
          lineHeight: 1,
          letterSpacing: "-0.04em",
          color: accent ? "var(--accent)" : "currentColor",
        }}
      >
        p.
      </span>
    );
  }
  return (
    <span
      aria-label="palpiteiro"
      style={{
        fontFamily: "var(--font-sans)",
        fontWeight: 600,
        fontSize: size,
        lineHeight: 1,
        letterSpacing: "-0.025em",
        color: "currentColor",
        whiteSpace: "nowrap",
      }}
    >
      palpiteiro
      <span
        style={{
          color: accent ? "var(--accent)" : "var(--fg-3)",
          fontWeight: 500,
          marginLeft: 1,
        }}
      >
        .
      </span>
    </span>
  );
}
