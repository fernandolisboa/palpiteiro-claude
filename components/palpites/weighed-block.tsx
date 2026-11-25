import type { CSSProperties } from "react";
import { Equal, Newspaper, Repeat2, Scale, UserRound } from "lucide-react";

import {
  WeighedFlows,
  WeighedPlayback,
} from "@/components/palpites/weighed-flows";
import { cn } from "@/lib/utils";
import type {
  OutcomeKey,
  PalpiteWeighedView,
  WeighedLane,
  WeighedRow,
} from "@/lib/view/palpite-weighed";

// "O que pesou" no palpite (#683, desenho v6): a balança de partida, uma linha por
// fator com a raia "CAM ──●› BOC  2 pts", a barra antes→depois com as tiras listradas e
// os arcos, e o resumo. Só renderiza: tudo vem pronto do view model (lib/view).
//
// FIREWALL (emenda da ADR 0030 §3): o único `%` do HTML é o dos rótulos da barra
// (`data-pesou-pct`). Larguras e posições vão em variáveis sem unidade (`--w`, `--l`) e
// o CSS faz a conta; as cores ficam no CSS por `data-winner`/`data-k`. Nenhuma palavra
// de valor. Acessível: a raia, a barra e os arcos são aria-hidden, com o mesmo conteúdo
// em palavras (`sr-only`).

type Variant = "hero" | "dialog";

const ALIGN: Record<OutcomeKey, string> = {
  home: "items-start text-left",
  draw: "items-center text-center",
  away: "items-end text-right",
};

function Arrow({ className }: { className?: string }) {
  return (
    <svg
      className={cn("pesou-arrow", className)}
      viewBox="0 0 12 8"
      aria-hidden="true"
    >
      <path
        d="M1 4h9.5M7.5 1l3 3-3 3"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const vars = (v: Record<string, string | number>) => v as CSSProperties;

// O nome do time nunca quebra no hífen ("Atlético-" / "MG").
function Names({ text, view }: { text: string; view: PalpiteWeighedView }) {
  const names = [view.labels.home.full, view.labels.away.full]
    .filter((n) => /[\s-]/.test(n))
    .sort((a, b) => b.length - a.length);
  if (names.length === 0) return <>{text}</>;
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = text.split(new RegExp(`(${escaped.join("|")})`));
  return (
    <>
      {parts.map((part, i) =>
        names.includes(part) ? (
          <span key={i} className="whitespace-nowrap">
            {part}
          </span>
        ) : (
          part
        )
      )}
    </>
  );
}

function Lane({ lane, view }: { lane: WeighedLane; view: PalpiteWeighedView }) {
  return (
    <>
      <span className="pesou-lane" data-to={lane.to} aria-hidden="true">
        <span className="src">{view.labels[lane.from].short}</span>
        <span className={`trk pesou-q${lane.slot}`}>
          {lane.dots.map((d, i) => (
            <i
              key={i}
              style={vars({ "--to": d.to, animationDelay: `${d.delay}s` })}
            />
          ))}
        </span>
        <span className="dst">{view.labels[lane.to].short}</span>
        <span className="num">
          <b>{lane.pts}</b> {lane.pts === 1 ? "pt" : "pts"}
        </span>
      </span>
      <span className="sr-only">{lane.sr}.</span>
    </>
  );
}

function OriginTag({ tag }: { tag: WeighedRow["tag"] }) {
  if (!tag) return null;
  const Icon = tag === "user" ? UserRound : Newspaper;
  return (
    <span className="border-palpite-border/80 text-meta text-palpite-fg mt-1 flex w-fit items-center gap-1 rounded-full border border-dashed py-px pr-2 pl-1.5 tracking-tight">
      <Icon className="size-3" aria-hidden="true" />
      {tag === "user" ? "você contou" : "notícia"}
    </span>
  );
}

function FactorRow({
  row,
  view,
  variant,
}: {
  row: WeighedRow;
  view: PalpiteWeighedView;
  variant: Variant;
}) {
  const long = variant === "dialog";
  return (
    <li className="pesou-step" data-tiny={row.tiny ? "" : undefined}>
      <span className="pesou-mark" aria-hidden="true">
        <i className="pesou-dot" />
      </span>
      <div className={cn("pesou-row", long && "pesou-row-long")}>
        <div
          className={cn(
            "text-body-sm min-w-0 leading-snug tracking-tight",
            row.tiny ? "text-muted-foreground" : "text-foreground"
          )}
        >
          <Names text={long ? row.long : row.short} view={view} />
          {long ? (
            <span
              className={cn(
                "text-meta mt-0.5 block tracking-tight",
                row.tag === "user" ? "text-palpite-fg" : "text-muted-foreground"
              )}
            >
              {row.originLine}
            </span>
          ) : (
            <OriginTag tag={row.tag} />
          )}
          {row.tiny && (
            <span className="text-meta text-muted-foreground mt-0.5 block tracking-tight">
              mexeu menos de 1 pt
            </span>
          )}
        </div>
        {row.lanes.length > 0 && (
          <div className="pesou-lanes">
            {row.lanes.map((lane, i) => (
              <Lane key={i} lane={lane} view={view} />
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

function OutcomeName({ view, k }: { view: PalpiteWeighedView; k: OutcomeKey }) {
  const { short, full } = view.labels[k];
  if (short === full) return <>{full}</>;
  return (
    <>
      <span className="sm:hidden">{short}</span>
      <span className="hidden sm:inline">{full}</span>
    </>
  );
}

function Bar({ view }: { view: PalpiteWeighedView }) {
  const { bar } = view;
  return (
    <div className="pesou-chart">
      <WeighedFlows bar={bar} />
      <div className="pesou-bar" aria-hidden="true">
        {bar.slices.map((s) => (
          <span key={s.key} data-k={s.key} style={vars({ "--w": s.pts })} />
        ))}
        {bar.hatches.map((h, i) => (
          <i
            key={i}
            data-k={h.tint}
            style={vars({ "--l": h.left, "--w": h.width, "--dir": h.dir })}
          />
        ))}
      </div>
      <div className="pesou-cols pt-1.5" aria-hidden="true">
        {bar.slices.map((s) => (
          <span
            key={s.key}
            className={ALIGN[s.key]}
            style={vars({ "--w": s.pts })}
          >
            <span className="pesou-pct">
              {s.before !== null && (
                <span className="pesou-before">
                  {s.before}
                  <Arrow />
                </span>
              )}
              <span
                data-pesou-pct=""
                className={
                  s.strong
                    ? "text-palpite-strong-fg font-medium"
                    : "text-foreground"
                }
              >
                {s.pts}%
              </span>
            </span>
            <span
              className={cn(
                "text-meta leading-tight tracking-tight whitespace-nowrap",
                s.strong ? "text-palpite-fg" : "text-muted-foreground"
              )}
            >
              <OutcomeName view={view} k={s.key} />
            </span>
          </span>
        ))}
      </div>
      <p className="sr-only">{view.sr}</p>
    </div>
  );
}

function Summary({
  view,
  variant,
}: {
  view: PalpiteWeighedView;
  variant: Variant;
}) {
  const { summary } = view;
  const Icon = summary.icon === "flip" ? Repeat2 : Equal;
  return (
    <p
      className={cn(
        "pesou-summary text-body-sm flex items-start gap-1.5 leading-snug font-medium tracking-tight",
        summary.kind === "flip" ? "text-palpite-strong-fg" : "text-foreground"
      )}
    >
      <Icon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      {variant === "dialog" ? (
        <span>
          <Names text={summary.long} view={view} />
        </span>
      ) : (
        <span>
          {summary.short.map((part, i) => (
            <span key={i}>
              {i > 0 && " "}
              <span className="whitespace-nowrap">{part}</span>
            </span>
          ))}
        </span>
      )}
    </p>
  );
}

/** O bloco "o que pesou": compacto no HERO, com as frases longas no "Ver raciocínio". */
export function WeighedBlock({
  view,
  variant,
}: {
  view: PalpiteWeighedView;
  variant: Variant;
}) {
  const dialog = variant === "dialog";
  const Root = dialog ? "section" : "div";
  return (
    <Root
      data-pesou=""
      data-winner={view.winner}
      aria-label={dialog ? "O que pesou no palpite" : undefined}
      className={cn(
        "pesou max-w-reading flex flex-col gap-3 rounded-lg border",
        dialog
          ? "pesou-dialog border-palpite-border/60 px-4 pt-4 pb-3"
          : "border-palpite-border/50 px-3 pt-3 pb-2.5"
      )}
    >
      <WeighedPlayback />
      {dialog ? (
        <p className="text-label text-foreground font-medium tracking-tight">
          O que pesou no palpite
        </p>
      ) : (
        <span className="text-label text-muted-foreground tracking-tight">
          o que pesou
        </span>
      )}
      <ol
        className="pesou-steps"
        aria-label="o que pesou no palpite"
        data-draw-lane={view.hasDrawLane ? "" : undefined}
      >
        <li className="pesou-step pesou-start">
          <span className="pesou-mark" aria-hidden="true">
            <Scale className="text-palpite-fg size-3.5" />
          </span>
          <p className="text-body-sm text-foreground leading-snug tracking-tight">
            <span className="text-muted-foreground">{view.start.prefix}</span>{" "}
            <Names text={view.start.text} view={view} />
          </p>
        </li>
        {view.rows.map((row) => (
          <FactorRow key={row.key} row={row} view={view} variant={variant} />
        ))}
      </ol>
      <Bar view={view} />
      <Summary view={view} variant={variant} />
      {dialog && view.alsoRead && (
        <p className="text-meta text-muted-foreground leading-relaxed tracking-tight">
          <span className="text-foreground">{view.alsoRead.label}</span>{" "}
          {view.alsoRead.text}
        </p>
      )}
    </Root>
  );
}
