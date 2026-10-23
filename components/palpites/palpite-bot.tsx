"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/**
 * O robozinho do run do HERO (ADR 0065): flutua, olha de um lado pro outro, pisca, e a
 * bola da antena gira enquanto a análise roda. A cada etapa que termina ele dá um pulinho
 * (`beat` = etapas prontas), então o movimento acompanha o progresso de verdade.
 *
 * Motion (DESIGN.md): só as cores palpite-*, sem brilho nem gradiente. Com
 * prefers-reduced-motion nada se mexe: os olhos e a bola só respiram (opacidade lenta,
 * `palpite-calm` em globals.css), pra a tela não parecer congelada. Decorativo
 * (aria-hidden): o texto da etapa é o que o leitor de tela anuncia.
 */
export function PalpiteBot({ beat, className }: { beat: number; className?: string }) {
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
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    el.animate(
      [
        { transform: "translateY(0)" },
        { transform: "translateY(-4px)" },
        { transform: "translateY(0)" },
      ],
      { duration: 420, easing: "ease-out" },
    );
  }, [beat]);

  return (
    <svg
      viewBox="0 0 48 48"
      aria-hidden="true"
      data-testid="palpite-bot"
      className={cn("size-12 shrink-0 overflow-visible", className)}
    >
      <ellipse
        cx="24"
        cy="45.5"
        rx="9"
        ry="1.6"
        className="palpite-bot-shadow fill-palpite-border"
      />
      <g ref={hopRef} className="palpite-bot-part">
        <g className="palpite-bot-bob">
          {/* antena com a bola */}
          <line
            x1="24"
            y1="10"
            x2="24"
            y2="6.5"
            strokeWidth="1.5"
            strokeLinecap="round"
            className="stroke-palpite-border"
          />
          <g className="palpite-bot-spin">
            <circle
              cx="24"
              cy="4"
              r="3.2"
              strokeWidth="1.2"
              className="palpite-calm fill-palpite-soft stroke-palpite-strong-fg"
            />
            <path
              d="M24 2.6 L25.3 3.55 L24.8 5.05 L23.2 5.05 L22.7 3.55 Z"
              className="fill-palpite-strong-fg"
            />
          </g>
          {/* orelhas */}
          <rect x="6" y="18" width="3" height="8" rx="1.5" className="fill-palpite-border" />
          <rect x="39" y="18" width="3" height="8" rx="1.5" className="fill-palpite-border" />
          {/* cabeça e visor */}
          <rect
            x="9"
            y="10"
            width="30"
            height="24"
            rx="9"
            strokeWidth="1.5"
            className="fill-palpite-soft stroke-palpite-border"
          />
          <rect x="13" y="14.5" width="22" height="15" rx="6" className="fill-background" />
          <g className="palpite-bot-look">
            <g className="palpite-bot-blink">
              <rect
                x="17.5"
                y="18.5"
                width="3.5"
                height="5.5"
                rx="1.75"
                className="palpite-calm fill-palpite-strong-fg"
              />
              <rect
                x="27"
                y="18.5"
                width="3.5"
                height="5.5"
                rx="1.75"
                className="palpite-calm fill-palpite-strong-fg"
              />
            </g>
          </g>
          <path
            d="M21.5 26.2 Q24 27.8 26.5 26.2"
            fill="none"
            strokeWidth="1.3"
            strokeLinecap="round"
            className="stroke-palpite-strong-fg"
          />
          {/* corpinho */}
          <rect x="17" y="35.5" width="14" height="6" rx="3" className="fill-palpite-border" />
        </g>
      </g>
    </svg>
  );
}
