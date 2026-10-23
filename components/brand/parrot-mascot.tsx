"use client";

import { useEffect, useRef } from "react";

import { MARK_BALL_COLOR, markBall } from "@/components/brand/brand-mark";
import { cn } from "@/lib/utils";

// Papagaio de perfil, olhando pra direita, no mesmo ladrilho azul do símbolo (viewBox 100×100).
// O bico é separado da cara por um vão na cor do fundo (`currentColor`, o azul do tema).
export const PARROT_BODY =
  "M20 90C14 66 16 36 36 24C50 16 64 18 70 28L80 60C72 68 64 76 61 90Z";
export const PARROT_BEAK =
  "M70 30C82 30 90 40 89 54C88 63 83 70 76 72C79 64 78 57 72 54C69 52 66 50 66 46C66 40 66 34 70 30Z";
export const PARROT_EYE = { cx: 52, cy: 40, r: 11 } as const;

// Trevo de quatro folhas: verde claro no mesmo tom do amarelo da bola (luz e saturação
// parecidas, sem neon), cada folha um coração com a ponta no centro do olho. O contorno na
// cor do fundo separa as folhas.
export const CLOVER_COLOR = "#6fcb60";
const CLOVER_STEM_COLOR = "#4a9c3b";
const CLOVER_LEAF =
  "M0 0C-2 -3 -8 -5 -8 -10C-8 -13 -5.5 -15 -3.5 -15C-1.8 -15 -0.5 -14 0 -12.5C0.5 -14 1.8 -15 3.5 -15C5.5 -15 8 -13 8 -10C8 -5 2 -3 0 0Z";

/**
 * O mascote (ADR 0068): o papagaio palpiteiro. O olho amarelo pisca, ganha os gomos da
 * bola, vira um trevo verde e o trevo cresce até tomar o ícone; depois volta. A bola do
 * olho é a MESMA bola do símbolo (brand-mark.tsx), só deslocada e reduzida até o olho. As
 * animações moram em globals.css (`.parrot-*`), sem CSS inline (CSP).
 *
 * `beat` sobe a cada passo (etapa pronta no run, próximo passo do tour) e o papagaio dá
 * um pulinho, pra o movimento acompanhar o que acontece de verdade.
 *
 * Anima mesmo com prefers-reduced-motion (`mascot-motion`, pedido do Fernando: parado ele
 * parece travado). Decorativo (aria-hidden): quem fala é o texto ao lado.
 */
export function ParrotMascot({
  beat = 0,
  className,
}: {
  beat?: number;
  className?: string;
}) {
  const hopRef = useRef<SVGGElement>(null);
  const lastBeat = useRef(beat);

  useEffect(() => {
    if (beat <= lastBeat.current) {
      lastBeat.current = beat;
      return;
    }
    lastBeat.current = beat;
    const el = hopRef.current;
    if (!el || typeof el.animate !== "function") return;
    el.animate(
      [
        { transform: "translateY(0)" },
        { transform: "translateY(-6px)" },
        { transform: "translateY(0)" },
      ],
      { duration: 420, easing: "ease-out" }
    );
  }, [beat]);

  const { cx, cy, r } = PARROT_EYE;
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
      data-testid="parrot-mascot"
      className={cn("mascot-motion size-12 shrink-0", className)}
    >
      <g className="text-primary">
        <rect width="100" height="100" rx="22" fill="currentColor" />
        <g ref={hopRef} className="parrot-hop">
          <g className="parrot-body">
            <path d={PARROT_BODY} fill="#ffffff" />
            <path
              d={PARROT_BEAK}
              fill="#ffffff"
              stroke="currentColor"
              strokeWidth={3.2}
            />
          </g>
          <g className="parrot-eye">
            <circle cx={cx} cy={cy} r={r} fill={MARK_BALL_COLOR} />
            <circle cx={53} cy={39} r={5.2} fill="currentColor" />
            <circle cx={54.6} cy={37.4} r={1.7} fill="#ffffff" />
          </g>
          <g className="parrot-ball">{markBall("currentColor")}</g>
          <g className="parrot-clover">
            <path
              d={`M${cx} ${cy}c3 7 7 13 13 17`}
              fill="none"
              stroke={CLOVER_STEM_COLOR}
              strokeWidth={2.6}
              strokeLinecap="round"
            />
            {[45, 135, 225, 315].map((a) => (
              <path
                key={a}
                d={CLOVER_LEAF}
                transform={`translate(${cx} ${cy}) rotate(${a})`}
                fill={CLOVER_COLOR}
                stroke="currentColor"
                strokeWidth={1.3}
                strokeLinejoin="round"
              />
            ))}
            <circle cx={cx} cy={cy} r={2.2} fill={CLOVER_STEM_COLOR} />
          </g>
        </g>
      </g>
    </svg>
  );
}
