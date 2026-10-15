import { cn } from "@/lib/utils";

type Props = {
  initials: string;
  hue: number;
  size?: number;
  className?: string;
  // Bandeira circular (#341): quando presente, substitui as iniciais+hue pelo SVG
  // vendorizado em public/flags/wc/<flagCode>.svg. Só seleções da Copa têm.
  flagCode?: string;
};

// Piso de 11px (ADR 0056, #578): a fonte do monograma nunca fica abaixo de 11px.
// Se a sigla não cabe no círculo a 11px, devolve null e o círculo sai só com a cor
// (é aria-hidden; o nome do time está ao lado). 0,75em é a largura de maiúscula do
// Geist Sans médio com folga (M/W largos de "MUN", "NEW"); 6px de respiro na borda.
export const MONOGRAM_MIN_FONT_PX = 11;

export function monogramFontPx(size: number, chars: number): number | null {
  const font = Math.max(MONOGRAM_MIN_FONT_PX, Math.round(size * 0.36));
  return chars * font * 0.75 <= size - 6 ? font : null;
}

export function TeamAvatar({
  initials,
  hue,
  size = 32,
  className,
  flagCode,
}: Props) {
  // Bandeira tem prioridade sobre as iniciais. O SVG já é circular (circle-flags);
  // rounded-full + border só fecham a moldura. Decorativo (o nome do time é o
  // rótulo semântico adjacente), então alt="" + aria-hidden.
  if (flagCode) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- SVG estático local; next/image não otimiza SVG e avisa
      <img
        aria-hidden="true"
        alt=""
        src={`/flags/wc/${flagCode}.svg`}
        width={size}
        height={size}
        className={cn(
          "border-border inline-block shrink-0 rounded-full border",
          className
        )}
        style={{ width: size, height: size }}
      />
    );
  }
  const fontPx = monogramFontPx(size, initials.length);
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
        ...(fontPx === null ? {} : { fontSize: fontPx, letterSpacing: "-0.02em" }),
      }}
    >
      {fontPx === null ? null : initials}
    </div>
  );
}
