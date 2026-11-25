import { cn } from "@/lib/utils";
import {
  REVIEWER_LABEL,
  UNDERDOG_STALE_CHANGED,
  UNDERDOG_STALE_REFRESH,
  UNDERDOG_TEMPLATE_NOTE,
  type UnderdogPanelView,
} from "@/lib/view/underdog";
import type { Ref, ReactNode } from "react";

// O painel aberto das chances do azarão (#671, ADR 0073), só apresentação. Os números
// são código; só o bloco de fundo `muted` do fim é texto da IA. Sem odd, stake, cor de
// edge nem aviso de risco (um aviso por tela, ADR 0057).

const NUM = "font-mono tabular-nums";

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-meta tracking-eyebrow text-muted-foreground uppercase">
      {children}
    </h3>
  );
}

function cutLabel(n: number): string {
  return n === 1 ? "1 frase cortada" : `${n} frases cortadas`;
}

export function UnderdogFacts({
  view,
  titleRef,
  refresh,
}: {
  view: UnderdogPanelView;
  titleRef?: Ref<HTMLHeadingElement>;
  // O botão "Atualizar" (submit do form do painel); só na base mudada de forma material.
  refresh?: ReactNode;
}) {
  const { narrative } = view;
  const template = narrative.source === "template";
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h3
          ref={titleRef}
          tabIndex={-1}
          className="text-foreground flex items-baseline gap-2 tracking-tight focus-visible:outline-none"
        >
          <span
            className={cn(
              NUM,
              "text-display-md text-palpite-strong-fg font-medium"
            )}
          >
            {view.chances.underdog}
          </span>
          <span className="text-label font-medium">
            {view.underdogName} vence
          </span>
        </h3>
        <p className="text-body-sm text-muted-foreground tracking-tight">
          {view.oneInN !== null && (
            <>Mais ou menos 1 jogo em cada {view.oneInN} assim. </>
          )}
          Empate <span className={NUM}>{view.chances.draw}</span>,{" "}
          {view.favoriteName}{" "}
          <span className={NUM}>{view.chances.favorite}</span>.
        </p>
      </div>

      {view.scorelines.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionTitle>Placares de zebra mais prováveis</SectionTitle>
          <ul className="flex flex-wrap gap-2">
            {view.scorelines.map((s) => (
              <li
                key={s.label}
                className="border-border-subtle bg-surface-2 text-body-sm text-foreground inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 tracking-tight"
              >
                <span className={cn(NUM, "font-medium")}>{s.label}</span>
                <span className="text-muted-foreground" aria-hidden>
                  ·
                </span>
                <span className={cn(NUM, "text-muted-foreground")}>
                  {s.pct}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {view.scenarios.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionTitle>Se acontecer…</SectionTitle>
          <ul className="divide-border-subtle flex flex-col divide-y">
            {view.scenarios.map((c) => (
              <li
                key={c.label}
                className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline sm:gap-4"
              >
                <span className="text-body-sm text-foreground tracking-tight">
                  {c.label}
                </span>
                <span
                  className={cn(
                    NUM,
                    "text-body-sm text-muted-foreground self-end sm:self-auto sm:text-right"
                  )}
                >
                  {c.before} <span aria-hidden>→</span>
                  <span className="sr-only"> vai a </span>{" "}
                  <span className="text-foreground font-medium">{c.after}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <SectionTitle>Sinais a favor hoje</SectionTitle>
        {view.signals.length === 0 ? (
          <p className="text-body-sm text-muted-foreground tracking-tight">
            Nenhum sinal claro a favor hoje.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {view.signals.map((s) => (
              <li
                key={s.label}
                className="text-body-sm text-foreground flex items-baseline gap-2 tracking-tight"
              >
                {/* A etiqueta "dados"/"modelo"/"notícia" só no desktop; no celular fica só
                    pro leitor de tela. */}
                <span className="sm:border-border sm:text-meta sm:text-muted-foreground sr-only sm:not-sr-only sm:shrink-0 sm:rounded-sm sm:border sm:px-1.5 sm:tracking-tight">
                  {s.origin}
                  <span className="sr-only">: </span>
                </span>
                <span>
                  {s.label}
                  {s.note && (
                    <span className="text-muted-foreground"> ({s.note})</span>
                  )}
                  {s.link && (
                    <>
                      {" "}
                      <a
                        href={s.link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground underline underline-offset-2"
                      >
                        {s.link.title}
                        <span className="sr-only"> (abre em nova aba)</span>
                      </a>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-muted flex flex-col gap-3 rounded-lg px-4 py-3.5">
        <p className="max-w-reading text-body text-foreground leading-relaxed tracking-tight">
          {narrative.sentences.join(" ")}
        </p>
        {!template && narrative.family && (
          <p className="text-meta text-muted-foreground tracking-tight">
            Advogado da zebra · {narrative.family}
          </p>
        )}
        <p className="max-w-reading text-body-sm text-foreground leading-relaxed tracking-tight">
          <span className="font-medium">Contraponto.</span>{" "}
          {narrative.counterpoint}
        </p>
        <p className="text-meta text-muted-foreground leading-relaxed tracking-tight">
          {template
            ? UNDERDOG_TEMPLATE_NOTE
            : `Revisor adversarial · ${REVIEWER_LABEL} · ${cutLabel(narrative.cut)} · usou 1 do limite de palpites`}
        </p>
        {view.freshness !== "current" && (
          <div className="border-border flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-3">
            <p className="text-body-sm text-muted-foreground tracking-tight">
              {view.freshness === "changed"
                ? UNDERDOG_STALE_CHANGED
                : UNDERDOG_STALE_REFRESH}
            </p>
            {view.freshness === "refresh" && refresh}
          </div>
        )}
      </div>
    </div>
  );
}
