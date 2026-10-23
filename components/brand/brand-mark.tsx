import { cn } from "@/lib/utils";

// Símbolo da marca (ADR 0066, #629): o "p" do ícone (#616) com o bojo virado medidor de
// probabilidade, 68% do anel cheio e o resto atenuado. Geometria única num viewBox 100×100,
// usada pelo Satori (ícones e cards OG, via app-icon-mark.tsx) e pelo DOM (Wordmark).
// Só atributos de SVG, sem `style` nem CSS: o Satori e o resvg leem os dois iguais.
//
// Anel: centro (53, 41), raio 15, traço 11. Ângulos no sentido horário da tela, 0° = 3h.
// O trecho cheio sai de 180° (atrás da haste) e vai até 425° (≈ 5h); o atenuado vai de 437°
// a 518° e para antes da haste, pra não virar mancha entre a haste e o bojo.
export const MARK_FILLED_ARC = "M38 41A15 15 0 1 1 59.34 54.59";
export const MARK_REST_ARC = "M56.37 55.62A15 15 0 0 1 39.09 46.62";
export const MARK_FILLED_SHARE = (425 - 180) / 360;
export const MARK_RING_STROKE = 11;
export const MARK_REST_OPACITY = 0.38;
export const MARK_STEM = { x: 27, y: 20.5, width: 11, height: 59.5 } as const;

/** Os três traços do glifo, numa cor só (o trecho atenuado usa a mesma cor com opacidade). */
export function markGlyph(color: string) {
  return [
    <path
      key="filled"
      d={MARK_FILLED_ARC}
      fill="none"
      stroke={color}
      strokeWidth={MARK_RING_STROKE}
    />,
    <path
      key="rest"
      d={MARK_REST_ARC}
      fill="none"
      stroke={color}
      strokeOpacity={MARK_REST_OPACITY}
      strokeWidth={MARK_RING_STROKE}
    />,
    <rect key="stem" {...MARK_STEM} fill={color} />,
  ];
}

/**
 * O símbolo em azul da marca, pro DOM (header e telas públicas). O azul é o `--primary` do
 * tema, então acompanha claro/escuro; decorativo, quem dá nome é o texto ao lado.
 */
export function BrandSymbol({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
    >
      <rect width="100" height="100" rx="22" className="fill-primary" />
      {markGlyph("#ffffff")}
    </svg>
  );
}
