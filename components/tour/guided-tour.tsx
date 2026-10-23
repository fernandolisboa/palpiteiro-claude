"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { X } from "lucide-react";

import { saveTourState } from "@/app/actions/tour";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  cardPosition,
  overlayPath,
  spotlightBox,
  type Box,
  type Size,
} from "@/lib/tour/geometry";
import {
  mergeTourState,
  parseTourState,
  shouldAutoStart,
  stateAfterChapter,
  TOUR_CHAPTERS,
  TOUR_FORCE_PARAM,
  TOUR_TAB_EVENT,
  type TourChapter,
  type TourState,
  type TourStep,
} from "@/lib/tour/steps";

type Props = {
  chapter: TourChapter;
  /** Chave do valor salvo no aparelho (um aparelho pode ter mais de uma conta). */
  userId: string;
  /** `users.tour_state` lido no servidor. */
  serverState: TourState | null;
  /** `?tour=1` (link "rever o tour"): abre mesmo já concluído/pulado. */
  forceStart: boolean;
};

// Espera o layout assentar (fontes, listas client-side) antes do primeiro spotlight.
const AUTO_START_DELAY_MS = 600;

const storageKey = (userId: string) => `palpiteiro:tour:${userId}`;

function readLocalState(userId: string): TourState | null {
  try {
    return parseTourState(window.localStorage.getItem(storageKey(userId)));
  } catch {
    return null;
  }
}

function writeLocalState(userId: string, state: TourState) {
  try {
    window.localStorage.setItem(storageKey(userId), state);
  } catch {
    // Storage bloqueado (aba anônima, cookies off): o DB segue valendo.
  }
}

/** Primeiro elemento VISÍVEL com o `data-tour` — a lista de jogos (/jogos) renderiza as
 * árvores mobile e desktop juntas (uma escondida por CSS). A página do jogo tem uma
 * árvore só (#576), mas a regra vale igual. */
function findTarget(name: string): HTMLElement | null {
  const nodes = document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`);
  for (const node of nodes) {
    if (node.getClientRects().length > 0) return node;
  }
  return null;
}

/** O passo dá pra mostrar agora? Sem alvo = centralizado, sempre. Passo com aba (página
 * do jogo, #576): basta o alvo existir no DOM — está na aba inativa, escondido, e o tour
 * abre a aba antes do spotlight. */
function stepAvailable(step: TourStep): boolean {
  if (!step.target) return true;
  if (step.tab) return document.querySelector(`[data-tour="${step.target}"]`) !== null;
  return findTarget(step.target) !== null;
}

/** Índices dos passos que dá pra mostrar agora. */
function availableSteps(steps: readonly TourStep[]): number[] {
  return steps.flatMap((step, i) => (stepAvailable(step) ? [i] : []));
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function readViewport(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

function toBox(rect: DOMRect): Box {
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

/** Evita que clicar na camada escura tire o foco do cartão (Esc/Tab seguem valendo). */
const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault();

/**
 * Tour guiado com spotlight: escurece a tela, recorta o elemento do passo e mostra um
 * cartão com o que fazer ali. Componente próprio (sem biblioteca): um tour de 11
 * passos cabe em poucas centenas de linhas, casa com os tokens do app sem brigar com
 * CSS de terceiro e não pesa no bundle das outras páginas.
 *
 * Regras: abre sozinho só na primeira vez (`shouldAutoStart`); "Pular tour", o X e Esc
 * gravam "dismissed" e ele nunca mais volta sozinho; chegar ao último passo grava o fim
 * do capítulo. Passo cujo alvo não está na tela (lista vazia, jogo sem odds) é pulado.
 */
export function GuidedTour({ chapter, userId, serverState, forceStart }: Props) {
  const steps = TOUR_CHAPTERS[chapter];
  // null = fechado.
  const [index, setIndex] = useState<number | null>(null);
  // Passos com alvo na tela, recalculado a cada troca de passo (não a cada render).
  const [available, setAvailable] = useState<number[]>([]);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [hole, setHole] = useState<Box | null>(null);
  const [viewport, setViewport] = useState<Size | null>(null);
  const [cardSize, setCardSize] = useState<Size | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const bodyId = useId();

  const persist = useCallback(
    (state: TourState) => {
      writeLocalState(userId, state);
      // Fire-and-forget: o valor local já segura o tour fechado neste aparelho.
      void saveTourState(state).catch(() => {});
    },
    [userId],
  );

  const close = useCallback(
    (state: TourState | null) => {
      // null = fecha sem gravar (o fim do capítulo já foi gravado no último passo).
      if (state) persist(state);
      setIndex(null);
      setTarget(null);
      setHole(null);
      setCardSize(null);
      returnFocusRef.current?.focus?.();
    },
    [persist],
  );

  // Muda de passo. Passo com aba: primeiro pede a aba (o MatchTabs troca com flushSync,
  // então o painel já está visível quando o efeito de troca de passo procura o alvo).
  // Chamado só de clique e timer, nunca de dentro de um efeito: lá o flushSync do
  // ouvinte não é garantido.
  const goTo = useCallback(
    (i: number) => {
      const tab = steps[i]?.tab;
      if (tab) window.dispatchEvent(new CustomEvent(TOUR_TAB_EVENT, { detail: tab }));
      setIndex(i);
    },
    [steps],
  );

  // Partida: automática (primeira vez) ou forçada pelo link "rever o tour". O link
  // vive no menu (#553; no celular, no "mais", #633), então pode ser clicado já nesta página: o efeito
  // reage ao `?tour=1` aparecendo na URL, sem precisar remontar o componente.
  const forcedParam = useSearchParams().get(TOUR_FORCE_PARAM);
  const startCheckedRef = useRef(false);
  const startTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (startTimerRef.current !== null) window.clearTimeout(startTimerRef.current);
    },
    [],
  );
  useEffect(() => {
    const firstRun = !startCheckedRef.current;
    startCheckedRef.current = true;
    // O `?tour=1` vale só enquanto está na URL: o Back pode restaurar este render do
    // cache do router com a prop antiga, depois de a URL já ter sido limpa.
    const url = new URL(window.location.href);
    const forced =
      forceStart &&
      forcedParam === "1" &&
      url.searchParams.get(TOUR_FORCE_PARAM) === "1";
    if (forced) {
      // Tira o param (um refresh não reabre). Estado null = o router do Next
      // sincroniza a URL nova (e este efeito roda de novo, sem forçar nada).
      url.searchParams.delete(TOUR_FORCE_PARAM);
      window.history.replaceState(null, "", url);
    } else {
      // Fora do "rever o tour", só a montagem decide: o estado do servidor é o do
      // render inicial, e um re-render no meio do tour não pode reabri-lo.
      if (!firstRun) return;
      const effective = mergeTourState(serverState, readLocalState(userId));
      if (!shouldAutoStart(chapter, effective)) return;
    }
    // O timer não é limpo quando o param sai da URL (re-execução logo acima); só na
    // desmontagem.
    if (startTimerRef.current !== null) window.clearTimeout(startTimerRef.current);
    startTimerRef.current = window.setTimeout(() => {
      startTimerRef.current = null;
      const first = availableSteps(steps)[0];
      if (first === undefined) return;
      returnFocusRef.current = document.activeElement as HTMLElement | null;
      goTo(first);
    }, AUTO_START_DELAY_MS);
    // Reage só ao param e à prop de força; capítulo, usuário e estado são do render inicial.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forcedParam, forceStart]);

  // Troca de passo: acha o alvo, rola até ele e grava o fim do capítulo no último passo
  // (antes do clique — no capítulo da lista, o clique num jogo já navega).
  useEffect(() => {
    if (index === null) return;
    const step = steps[index]!;
    const nextAvailable = availableSteps(steps);
    setAvailable(nextAvailable);
    const el = step.target ? findTarget(step.target) : null;
    setTarget(el);
    if (el) {
      const tall = el.getBoundingClientRect().height > window.innerHeight * 0.5;
      el.scrollIntoView({
        block: tall ? "start" : "center",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    }
    if (index === nextAvailable[nextAvailable.length - 1]) {
      persist(stateAfterChapter(chapter));
    }
  }, [index, steps, chapter, persist]);

  // Acompanha o alvo enquanto a página rola/redimensiona (inclusive a rolagem suave).
  useEffect(() => {
    if (index === null) return;
    const step = steps[index]!;
    const padding = step.interactive ? 0 : undefined;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Cruzou o breakpoint (ex.: girou o tablet): o alvo antigo está na árvore que
        // o CSS escondeu — procura o gêmeo visível.
        if (target && step.target && target.getClientRects().length === 0) {
          setTarget(findTarget(step.target));
          return;
        }
        const vp = readViewport();
        setViewport(vp);
        setHole(
          target ? spotlightBox(toBox(target.getBoundingClientRect()), vp, padding) : null,
        );
      });
    };
    measure();
    window.addEventListener("scroll", measure, { capture: true, passive: true });
    window.addEventListener("resize", measure);
    const observer = new ResizeObserver(measure);
    if (target) observer.observe(target);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", measure, { capture: true });
      window.removeEventListener("resize", measure);
      observer.disconnect();
    };
  }, [index, steps, target]);

  // Mede o cartão (altura varia com o texto) pra posicioná-lo sem cobrir o alvo. A tela
  // é medida junto, síncrona, pra não pintar um quadro com o cartão fora do lugar.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (index === null || !card) return;
    const update = () => {
      setViewport((vp) => vp ?? readViewport());
      setCardSize({ width: card.offsetWidth, height: card.offsetHeight });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(card);
    return () => observer.disconnect();
  }, [index]);

  const ready = index !== null && cardSize !== null && viewport !== null;

  // Foco no botão principal assim que o cartão está medido e posicionado.
  useEffect(() => {
    if (ready) primaryRef.current?.focus({ preventScroll: true });
  }, [ready, index]);

  // Teclado no documento inteiro (não só no cartão): Esc fecha e o Tab fica preso no
  // cartão mesmo que o foco tenha escapado.
  useEffect(() => {
    if (index === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close("dismissed");
        return;
      }
      const card = cardRef.current;
      if (event.key !== "Tab" || !card) return;
      const focusable = [...card.querySelectorAll<HTMLElement>("button")];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (!card.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [index, close]);

  if (index === null) return null;

  const step = steps[index]!;
  const position = available.indexOf(index);
  const prevIndex = position > 0 ? available[position - 1]! : null;
  const isLast = position === available.length - 1;
  const spot = step.target ? hole : null;
  const cardAt =
    cardSize && viewport ? cardPosition(spot, cardSize, viewport) : null;
  const overlaySize = viewport ?? { width: 0, height: 0 };

  const next = () => {
    if (isLast) {
      close(null);
      return;
    }
    // Recalcula: o alvo do próximo passo pode ter aparecido/sumido desde a última troca.
    const nextIndex = availableSteps(steps).find((i) => i > index);
    if (nextIndex === undefined) close(stateAfterChapter(chapter));
    else goTo(nextIndex);
  };

  // Passo interativo (abrir um jogo): o botão principal faz o clique por quem usa
  // teclado/leitor de tela, e "Agora não" fecha sem dispensar — o capítulo seguinte
  // ainda abre no primeiro jogo que a pessoa abrir.
  const interactive = step.interactive === true && target !== null;

  return createPortal(
    // O casco não captura clique (pointer-events-none): quem bloqueia a página é a
    // camada escura pintada, e o recorte fica livre no passo interativo.
    // Até medir, fica transparente (opacity, não visibility: elemento com
    // visibility:hidden não aceita foco, e o foco vai pro botão no mesmo ciclo).
    <div
      className={cn(
        "pointer-events-none fixed inset-0 z-[60]",
        !ready && "opacity-0",
      )}
    >
      <svg
        aria-hidden="true"
        className="absolute inset-0 size-full"
        width={overlaySize.width}
        height={overlaySize.height}
      >
        <path
          d={overlayPath(overlaySize, spot)}
          fillRule="evenodd"
          onMouseDown={keepFocus}
          className="pointer-events-auto fill-black/60 dark:fill-black/70"
        />
      </svg>

      {spot && (
        <div
          aria-hidden="true"
          onMouseDown={interactive ? undefined : keepFocus}
          className={
            interactive
              ? "absolute rounded-lg ring-2 ring-ring transition-all duration-200 ease-out"
              : "pointer-events-auto absolute rounded-lg ring-2 ring-ring transition-all duration-200 ease-out"
          }
          style={{
            top: spot.top,
            left: spot.left,
            width: spot.width,
            height: spot.height,
          }}
        />
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="pointer-events-auto absolute flex w-[min(22rem,calc(100vw-24px))] flex-col gap-3 rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-lg"
        style={{ top: cardAt?.top ?? 0, left: cardAt?.left ?? 0 }}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-meta uppercase tracking-label text-muted-foreground">
            tour · {position + 1} de {available.length}
          </p>
          <button
            type="button"
            aria-label="Fechar o tour"
            onClick={() => close("dismissed")}
            className="-m-1 rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <X className="size-4" />
          </button>
        </div>
        <h2 id={titleId} className="text-display-sm font-medium tracking-tight">
          {step.title}
        </h2>
        <p
          id={bodyId}
          className="text-body leading-relaxed tracking-tight text-muted-foreground"
        >
          {step.body}
        </p>
        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2 text-muted-foreground"
            onClick={() => close(interactive && isLast ? null : "dismissed")}
          >
            {interactive && isLast ? "Agora não" : "Pular tour"}
          </Button>
          <div className="flex items-center gap-2">
            {prevIndex !== null && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => goTo(prevIndex)}
              >
                Voltar
              </Button>
            )}
            <Button
              ref={primaryRef}
              type="button"
              size="sm"
              onClick={interactive ? () => target.click() : next}
            >
              {interactive ? "Abrir jogo" : isLast ? "Concluir" : "Próximo"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
