"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { fanArcs } from "@/lib/view/palpite-weighed-arcs";
import type { PalpiteWeighedView } from "@/lib/view/palpite-weighed";

// Parte cliente do "o que pesou" (#683): os arcos da barra (medem a largura) e o gatilho
// da animação. Tudo aria-hidden: o bloco já diz em palavras o que os arcos desenham.

const MAX_DOTS = 4;
const ARC_DOT_DELAY_S = 0.16;
// Um ciclo da sequência (app/globals.css, "o que pesou"): 2 ciclos e para.
const CYCLE_MS = 5400;
const PLAY_MS = 2 * CYCLE_MS + 200;

/**
 * Arcos em leque sobre a barra. No SSR (largura desconhecida) sai só a caixa com a
 * altura certa; os arcos entram depois de medir, sem salto de layout, e refazem no resize.
 */
export function WeighedFlows({ bar }: { bar: PalpiteWeighedView["bar"] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.round(el.clientWidth));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (bar.arcsHeight === 0) return null;
  const arcs = width > 0 ? fanArcs(bar.flows, width, bar.arcsHeight) : null;
  return (
    <div
      ref={ref}
      className="pesou-flows"
      style={{ height: bar.arcsHeight }}
      aria-hidden="true"
      data-pesou-flows=""
    >
      {arcs && (
        <>
          <svg>
            {arcs.paths.map((p, i) => (
              <g key={i} data-k={p.tint} className="pesou-arc">
                <path
                  d={p.d}
                  fill="none"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                />
                <path d={p.tip} strokeWidth={1} strokeLinejoin="round" />
              </g>
            ))}
            {arcs.origins.map((o, i) => (
              <circle
                key={i}
                data-k={o.tint}
                className="pesou-origin"
                cx={o.cx}
                cy={o.cy}
                r={2.25}
              />
            ))}
          </svg>
          {arcs.paths.map((p, i) => (
            <span
              key={i}
              data-k={p.tint}
              className={p.label.onLine ? "on-line" : undefined}
              style={{ left: p.label.x, top: p.label.y }}
            >
              <b>{p.pts}</b> {p.pts === 1 ? "pt" : "pts"}
            </span>
          ))}
          {arcs.paths.flatMap((p, i) =>
            Array.from({ length: Math.min(p.pts, MAX_DOTS) }, (_, k) => (
              <i
                key={`${i}-${k}`}
                data-k={p.tint}
                className={`pesou-fly pesou-q${p.slot}`}
                style={{
                  offsetPath: `path('${p.d}')`,
                  animationDelay: `${(k * ARC_DOT_DELAY_S).toFixed(2)}s`,
                }}
              />
            ))
          )}
        </>
      )}
    </div>
  );
}

/**
 * Toca a animação do bloco 2 vezes quando ele entra na tela e para no estado final (o
 * mesmo do movimento reduzido: bolinhas das raias no destino, as dos arcos escondidas).
 * Com `prefers-reduced-motion`, nunca liga. Marca invisível, sem conteúdo: põe/tira
 * `data-play` no `.pesou` em volta.
 */
export function WeighedPlayback() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const root = ref.current?.closest<HTMLElement>(".pesou");
    if (!root || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        root.setAttribute("data-play", "");
        timer = setTimeout(() => root.removeAttribute("data-play"), PLAY_MS);
      },
      { threshold: 0.4 }
    );
    io.observe(root);
    return () => {
      io.disconnect();
      if (timer) clearTimeout(timer);
      root.removeAttribute("data-play");
    };
  }, []);
  return <span ref={ref} hidden />;
}
