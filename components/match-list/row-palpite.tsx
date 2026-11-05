"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight, EllipsisVertical, RefreshCw } from "lucide-react";

import { IntentLink } from "@/components/intent-link";
import {
  ROW_FOCUS,
  ROW_TOUR_HIDDEN,
} from "@/components/match-list/row-analyze";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ListPalpiteView } from "@/lib/view/types";

// O palpite já feito, na linha de /jogos: o resumo no meio da linha (desktop) e o menu
// do "analisado" (celular), com "ver palpite" e "reanalisar".

function scoreLabel(p: ListPalpiteView): string | null {
  return p.probableScore
    ? `${p.probableScore.home}–${p.probableScore.away}`
    : null;
}

type Edge = "top" | "middle" | "end";

const MASK: Record<Edge, string> = {
  top: "[mask-image:linear-gradient(to_bottom,black_50%,transparent)]",
  middle:
    "[mask-image:linear-gradient(to_bottom,transparent,black_30%,black_70%,transparent)]",
  end: "[mask-image:linear-gradient(to_bottom,transparent,black_45%)]",
};

// Velocidade de leitura do texto que desce sozinho (ms por pixel) e a espera antes de
// começar: passar o mouse de raspão não mexe no texto.
const READ_MS_PER_PX = 60;
const HOVER_DELAY_MS = 350;

/**
 * Desktop: o palpite no meio da linha, entre os times e as odds. Três linhas (veredito
 * com o placar provável e o começo do resumo) que somem embaixo num degradê. Com o mouse
 * em cima do texto, ele desce devagar até o fim (barra invisível), e volta ao sair.
 * É um link pro jogo, como o resto da linha.
 */
export function RowPalpiteSummary({
  palpite,
  href,
  className,
}: {
  palpite: ListPalpiteView;
  href: string;
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [edge, setEdge] = useState<Edge>("top");
  const [overflows, setOverflows] = useState(true);

  // Mede de novo quando a caixa muda de tamanho (a árvore do desktop nasce escondida
  // abaixo de lg, a largura encolhe com a linha, a fonte troca) e quando o texto muda.
  const content = `${palpite.verdict}|${scoreLabel(palpite)}|${palpite.narrative}`;
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [content]);

  function edgeOf(el: HTMLDivElement): Edge {
    if (el.scrollTop <= 1) return "top";
    if (el.scrollTop >= el.scrollHeight - el.clientHeight - 1) return "end";
    return "middle";
  }

  function glide(to: "end" | "top") {
    const el = boxRef.current;
    if (!el) return;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    const from = el.scrollTop;
    const target = to === "end" ? el.scrollHeight - el.clientHeight : 0;
    const distance = target - from;
    if (Math.abs(distance) < 1) return;
    // Desce no ritmo de leitura; volta rápido.
    const duration =
      to === "end"
        ? Math.abs(distance) * READ_MS_PER_PX
        : Math.min(450, Math.abs(distance) * 6);
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = to === "end" ? t : 1 - (1 - t) * (1 - t);
      el.scrollTop = from + distance * eased;
      setEdge(edgeOf(el));
      frame.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    frame.current = requestAnimationFrame(step);
  }

  const score = scoreLabel(palpite);
  return (
    <IntentLink
      href={href}
      tabIndex={-1}
      onMouseEnter={() => {
        if (!overflows) return;
        timer.current = setTimeout(() => glide("end"), HOVER_DELAY_MS);
      }}
      onMouseLeave={() => {
        if (timer.current !== null) clearTimeout(timer.current);
        glide("top");
      }}
      className={cn("relative z-10 block min-w-0", className)}
    >
      <div
        ref={boxRef}
        // Caixa que rola sem filho focável vira parada de Tab no Chrome; o link já leva
        // ao jogo e a linha tem o link principal.
        tabIndex={-1}
        onScroll={(e) => setEdge(edgeOf(e.currentTarget))}
        className={cn(
          "h-[54px] [scrollbar-width:none] overflow-y-auto [&::-webkit-scrollbar]:hidden",
          overflows && MASK[edge]
        )}
      >
        <p className="text-label text-foreground leading-[18px] font-medium tracking-tight">
          {palpite.verdict}
          {score && (
            <span className="text-meta text-palpite-strong-fg ml-1.5 font-mono tabular-nums">
              {score}
            </span>
          )}
        </p>
        <p className="text-meta text-muted-foreground leading-[18px] tracking-tight">
          {palpite.narrative}
        </p>
      </div>
    </IntentLink>
  );
}

/**
 * Celular, jogo já analisado: a pílula "analisado" inteira em azul, com ⋮ no canto. O
 * toque abre um menu com o palpite, "ver palpite" e "reanalisar" (que gasta análise do
 * limite: dois toques, sem disparo por engano).
 */
export function AnalyzedMenu({
  palpite,
  href,
  onReanalyze,
}: {
  palpite: ListPalpiteView | null;
  href: string;
  onReanalyze: () => void;
}) {
  const score = palpite ? scoreLabel(palpite) : null;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label="Analisado: ver palpite ou reanalisar"
        className={cn(
          "border-accent-border bg-accent-soft text-meta text-accent-fg relative z-10 inline-flex h-6 shrink-0 cursor-pointer items-center gap-0.5 rounded-full border pr-1 pl-2.5 font-medium whitespace-nowrap transition-colors hover:brightness-110 data-[state=open]:brightness-110",
          // Toque de ~44px sem crescer a pílula.
          "before:absolute before:-inset-x-1 before:-inset-y-2.5 before:content-['']",
          ROW_TOUR_HIDDEN,
          ROW_FOCUS
        )}
      >
        analisado
        <EllipsisVertical aria-hidden="true" className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {palpite && (
          <>
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="text-meta text-muted-foreground tracking-tight">
                Seu palpite
              </span>
              <span className="text-body-sm text-foreground font-medium tracking-tight">
                {palpite.verdict}
                {score && (
                  <span className="text-meta text-palpite-strong-fg ml-1.5 font-mono tabular-nums">
                    {score}
                  </span>
                )}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem asChild>
          <IntentLink href={href} className="justify-between">
            Ver palpite
            <ChevronRight aria-hidden="true" className="size-3.5" />
          </IntentLink>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={onReanalyze}
          className="flex-col items-start gap-0.5"
        >
          <span className="text-foreground inline-flex items-center gap-1.5">
            <RefreshCw aria-hidden="true" className="size-3.5" />
            Reanalisar
          </span>
          <span className="text-meta text-muted-foreground">
            Usa 1 análise do seu limite do dia.
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
