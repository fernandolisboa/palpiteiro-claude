"use client";

import { useEffect, useRef, useState } from "react";

import { TeamAvatar } from "@/components/team-avatar";
import { cn } from "@/lib/utils";
import type { Team } from "@/lib/view/types";

type Props = { team: Team; size: number; priority?: boolean; className?: string };

/**
 * Escudo do time (#578). Ordem: bandeira da Copa → escudo do provider → monograma
 * (sigla + cor, `TeamAvatar`). Decorativo (o nome do time está ao lado): `alt=""` +
 * aria-hidden. Client só por causa do `onError`: escudo que falha (404, CDN fora)
 * cai no monograma, sem ícone de imagem quebrada.
 */
export function TeamCrest({ team, size, priority = false, className }: Props) {
  // Guarda o src que falhou (não um boolean), pra voltar a tentar se a URL mudar.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const src = team.flagCode ? undefined : team.crestUrl;

  // O `error` do <img> do HTML do servidor pode disparar ANTES da hidratação (o React
  // ainda não anexou o onError e o evento não é reemitido). Na montagem, imagem já
  // `complete` com naturalWidth 0 é falha. Imagem lazy ainda não pedida tem
  // complete=false, então não é marcada por engano.
  useEffect(() => {
    const img = imgRef.current;
    if (src && img && img.complete && img.naturalWidth === 0) setFailedSrc(src);
  }, [src]);

  if (team.flagCode) {
    return (
      <TeamAvatar
        initials={team.short}
        hue={team.hue}
        size={size}
        flagCode={team.flagCode}
        className={className}
      />
    );
  }

  if (src && failedSrc !== src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- escudo remoto pequeno; next/image exigiria remotePatterns e gastaria o otimizador
      <img
        ref={imgRef}
        src={src}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailedSrc(src)}
        className={cn("inline-block shrink-0 object-contain", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <TeamAvatar initials={team.short} hue={team.hue} size={size} className={className} />
  );
}
