import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LEAGUE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PredictionRowView } from "@/lib/view/dashboard";

const STATUS_META: Record<
  PredictionRowView["status"],
  { label: string; className: string }
> = {
  pending: { label: "pendente", className: "text-muted-foreground" },
  won: { label: "green", className: "text-edge-fg" },
  lost: { label: "red", className: "text-destructive" },
  void: { label: "anulada", className: "text-muted-fg-2" },
  // push só aparece quando o settlement plugável (Fase 2 #166) o emitir; em Phase 1
  // nenhuma row é push. Estilo neutro como void (no-action, stake devolvido — ADR 0016).
  push: { label: "push", className: "text-muted-fg-2" },
};

// Cor por token de recomendação. over/under/pass têm cor pinada; tokens de
// mercado novo (1X2, #173 — ex.: "Casa"/"HOME") caem no neutro via recClass().
const REC_CLASS: Record<string, string> = {
  OVER: "text-edge-fg",
  UNDER: "text-accent-fg",
  PASS: "text-muted-foreground",
};

function recClass(rec: PredictionRowView["rec"]): string {
  return REC_CLASS[rec] ?? "text-foreground";
}

export function PredictionsTable({
  rows,
  basePath = "/dashboard",
}: {
  rows: PredictionRowView[];
  basePath?: string;
}) {
  if (rows.length === 0) {
    return <EmptyState title="Nenhuma predição com esses filtros." />;
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            {[
              "jogo",
              "liga",
              "data",
              "rec",
              "odd",
              "edge",
              "conf",
              "status",
              "lucro",
              "",
            ].map((h, i) => (
              <TableHead
                key={h || `c${i}`}
                className={cn(
                  "font-mono text-eyebrow-xs uppercase tracking-label text-muted-foreground",
                  ["odd", "edge", "conf", "lucro"].includes(h) && "text-right",
                )}
              >
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const status = STATUS_META[r.status];
            return (
              <TableRow key={r.id} className="border-border-subtle">
                <TableCell className="max-w-[220px]">
                  <Link
                    href={`${basePath}/${r.id}`}
                    className="rounded-sm font-medium tracking-tight hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {r.home} × {r.away}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    size="xs"
                    className="uppercase tracking-label text-muted-foreground"
                  >
                    {LEAGUE_LABEL[r.league]}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-meta tabular-nums text-muted-foreground">
                  {r.when}
                </TableCell>
                <TableCell
                  className={cn("font-mono text-meta font-medium", recClass(r.rec))}
                >
                  {r.rec}
                </TableCell>
                <TableCell className="text-right font-mono text-body-sm tabular-nums">
                  {r.odd}
                </TableCell>
                <TableCell className="text-right font-mono text-body-sm tabular-nums text-muted-foreground">
                  {r.edge ? `${r.edge}pp` : "—"}
                </TableCell>
                <TableCell className="text-right font-mono text-body-sm tabular-nums text-muted-foreground">
                  {r.confidence}
                </TableCell>
                <TableCell className={cn("text-meta", status.className)}>
                  {status.label}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-mono text-body-sm tabular-nums",
                    r.profit === null
                      ? "text-muted-fg-2"
                      : r.profit.startsWith("-")
                        ? "text-destructive"
                        : "text-edge-fg",
                  )}
                >
                  {r.profit ?? "—"}
                </TableCell>
                <TableCell className="w-8">
                  <Link
                    href={`${basePath}/${r.id}`}
                    aria-label="Abrir predição"
                    className="rounded-sm text-muted-fg-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <ChevronRight className="size-3.5" />
                  </Link>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
