import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
  won: { label: "green", className: "text-emerald-500" },
  lost: { label: "red", className: "text-red-500" },
  void: { label: "anulada", className: "text-muted-fg-2" },
};

const REC_CLASS: Record<PredictionRowView["rec"], string> = {
  OVER: "text-emerald-500",
  UNDER: "text-sky-500",
  PASS: "text-muted-foreground",
};

export function PredictionsTable({ rows }: { rows: PredictionRowView[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card px-6 py-12 text-center text-[13px] text-muted-foreground">
        Nenhuma predição com esses filtros.
      </div>
    );
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
                  "font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground",
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
                    href={`/dashboard/${r.id}`}
                    className="font-medium tracking-tight hover:underline"
                  >
                    {r.home} × {r.away}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className="h-[18px] rounded-full px-2 text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground"
                  >
                    {LEAGUE_LABEL[r.league]}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-[11.5px] tabular-nums text-muted-foreground">
                  {r.when}
                </TableCell>
                <TableCell
                  className={cn("font-mono text-[11.5px] font-medium", REC_CLASS[r.rec])}
                >
                  {r.rec}
                </TableCell>
                <TableCell className="text-right font-mono text-[12px] tabular-nums">
                  {r.odd}
                </TableCell>
                <TableCell className="text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                  {r.edge ? `${r.edge}pp` : "—"}
                </TableCell>
                <TableCell className="text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                  {r.confidence}
                </TableCell>
                <TableCell className={cn("text-[11.5px]", status.className)}>
                  {status.label}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-mono text-[12px] tabular-nums",
                    r.profit === null
                      ? "text-muted-fg-2"
                      : r.profit.startsWith("-")
                        ? "text-red-500"
                        : "text-emerald-500",
                  )}
                >
                  {r.profit ?? "—"}
                </TableCell>
                <TableCell className="w-8">
                  <Link
                    href={`/dashboard/${r.id}`}
                    aria-label="Abrir predição"
                    className="text-muted-fg-2 hover:text-foreground"
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
