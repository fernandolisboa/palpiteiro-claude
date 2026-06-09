"use client";

import { useState } from "react";

import { TeamAvatar } from "@/components/team-avatar";
import { cn } from "@/lib/utils";

type Props = {
  initials: string;
  hue: number;
  size?: number;
  className?: string;
  src?: string | null;
};

/**
 * Avatar do usuário: renderiza a imagem (`src`, URL arbitrária do perfil) e cai
 * pras iniciais (`TeamAvatar`) quando não há imagem OU quando ela falha ao
 * carregar (404/hotlink bloqueado). É a versão client do avatar — o `onError`
 * exige cliente; o `TeamAvatar` segue puro/server pros monogramas de times.
 */
export function UserAvatar({
  initials,
  hue,
  size = 32,
  className,
  src,
}: Props) {
  // Guarda o src que falhou (em vez de um boolean) pra resetar o fallback quando
  // o avatar muda pra uma URL nova após editar o perfil.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (src && failedSrc !== src) {
    return (
      // URL arbitrária do usuário; next/image exigiria whitelist de domínios.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        onError={() => setFailedSrc(src)}
        className={cn(
          "border-border inline-block rounded-full border object-cover",
          className
        )}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <TeamAvatar
      initials={initials}
      hue={hue}
      size={size}
      className={className}
    />
  );
}
