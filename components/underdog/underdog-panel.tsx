"use client";

import { ChevronDown } from "lucide-react";
import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  startTransition,
} from "react";

import {
  openUnderdogView,
  type OpenUnderdogResult,
} from "@/app/actions/underdog";
import { UnderdogFacts } from "@/components/underdog/underdog-facts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { UnderdogSlotView } from "@/lib/view/underdog";

// "Chances do azarão" (#671, ADR 0073) abaixo do palpite, FORA do HERO (firewall da
// ADR 0030: o `%` não entra no cartão do palpite). Fechado: lado e chance, grátis.
// Abrir sem texto guardado chama a action (1 do limite de palpites); com texto
// guardado que vale, abre na hora. Só o matchId vai ao servidor.

export const UNDERDOG_LOADING_COPY =
  "O advogado da zebra está montando o caso…";
export const UNDERDOG_COST_NOTE = "Usa 1 do seu limite diário de palpites";
export const underdogReadyCopy = (underdogName: string, pct: string) =>
  `Chances do azarão prontas: ${underdogName} vence em ${pct}.`;

export function UnderdogPanel({
  matchId,
  slot,
}: {
  matchId: string;
  slot: UnderdogSlotView;
}) {
  const [result, formAction, pending] = useActionState<
    OpenUnderdogResult | null,
    FormData
  >(openUnderdogView, null);
  const [open, setOpen] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const panelId = useId();
  const costId = useId();

  const view = result?.ok ? result.view : slot.view;
  const teaser = result?.ok
    ? {
        underdogName: result.view.underdogName,
        pct: result.view.chances.underdog,
      }
    : slot.teaser;
  const paid = view !== null;

  // Resultado novo: foco no título do painel (o leitor de tela lê de onde chegou).
  useEffect(() => {
    if (result?.ok) titleRef.current?.focus();
  }, [result]);

  const submit = () => {
    const form = formRef.current;
    if (!form) return;
    startTransition(() => formAction(new FormData(form)));
  };

  const onHeader = () => {
    if (pending) return;
    if (paid) {
      setOpen((v) => !v);
      return;
    }
    setOpen(true);
    submit();
  };

  const expanded = open && (paid || pending);
  const error = result && !result.ok ? result.error : null;

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-2"
      aria-busy={pending}
      data-testid="underdog-panel"
    >
      <input type="hidden" name="matchId" value={matchId} />
      {/* UM cartão: o cabeçalho tingido (o botão) e, aberto, o corpo logo abaixo,
          separados por uma linha. Fechado, só a linha do cabeçalho. */}
      <div className="border-palpite-border/60 overflow-hidden rounded-lg border">
        <h2 className="m-0">
          <button
            type="button"
            onClick={onHeader}
            // Sem `disabled`: o botão focado não perde o foco enquanto carrega (o
            // clique é ignorado em onHeader).
            aria-disabled={pending || undefined}
            aria-expanded={expanded}
            aria-controls={panelId}
            aria-describedby={paid ? undefined : costId}
            className={cn(
              "flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors",
              "bg-palpite-soft/30 hover:bg-palpite-soft/60",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset",
              "aria-disabled:cursor-progress"
            )}
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-label text-foreground font-medium tracking-tight">
                Chances do azarão
              </span>
              <span className="text-body-sm text-muted-foreground truncate tracking-tight">
                {teaser.underdogName} vence · como a zebra acontece
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="text-display-sm text-palpite-strong-fg font-mono font-medium tabular-nums">
                {teaser.pct}
              </span>
              <ChevronDown
                className={cn(
                  "text-muted-foreground size-4 transition-transform",
                  expanded && "rotate-180"
                )}
                aria-hidden
              />
            </span>
          </button>
        </h2>

        <div
          ref={regionRef}
          id={panelId}
          role="region"
          aria-label="Chances do azarão"
          hidden={!expanded}
          // Recebe o foco quando "Atualizar" some (vira o esqueleto do carregando).
          tabIndex={-1}
          className="border-palpite-border/60 border-t px-4 py-4 focus-visible:outline-none"
        >
          {pending ? (
            <UnderdogSkeleton />
          ) : (
            view && (
              <UnderdogFacts
                view={view}
                titleRef={titleRef}
                refresh={
                  <Button
                    type="submit"
                    size="sm"
                    variant="outline"
                    // O botão some no carregando: o foco vai pro painel antes.
                    onClick={() => regionRef.current?.focus()}
                  >
                    Atualizar · usa 1 do limite
                  </Button>
                }
              />
            )
          )}
        </div>
      </div>

      {!paid && (
        <p
          id={costId}
          className="text-meta text-muted-foreground px-1 tracking-tight"
        >
          {UNDERDOG_COST_NOTE}
        </p>
      )}

      <div role="status" aria-live="polite">
        {/* Carregando: a frase visível fica no corpo do cartão (acima do esqueleto);
            aqui ela só é anunciada. */}
        {pending && <p className="sr-only">{UNDERDOG_LOADING_COPY}</p>}
        {error && !pending && (
          <p className="text-body-sm text-destructive px-1 tracking-tight">
            {error}
          </p>
        )}
        {result?.ok && !pending && (
          <p className="sr-only">
            {underdogReadyCopy(
              result.view.underdogName,
              result.view.chances.underdog
            )}
          </p>
        )}
      </div>
    </form>
  );
}

function UnderdogSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <p className="text-body-sm text-muted-foreground tracking-tight">
        {UNDERDOG_LOADING_COPY}
      </p>
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-4 w-64" />
      <div className="flex gap-2">
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-20" />
      </div>
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
