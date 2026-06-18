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
