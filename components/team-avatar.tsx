import { cn } from "@/lib/utils";

type Props = {
  initials: string;
  hue: number;
  size?: number;
  className?: string;
  src?: string | null;
};

export function TeamAvatar({
  initials,
  hue,
  size = 32,
  className,
  src,
}: Props) {
  if (src) {
    return (
      // Avatar pode ser uma URL arbitrária fornecida pelo usuário; next/image
      // exigiria whitelist de domínios remotos (impraticável pra hosts
      // desconhecidos), então <img> é o caminho correto aqui.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        className={cn(
          "border-border inline-block rounded-full border object-cover",
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
