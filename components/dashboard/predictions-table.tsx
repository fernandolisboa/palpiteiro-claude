import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { ResultBadge } from "@/components/result-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { appendBackParam } from "@/lib/view/back-href";
import { LEAGUE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PredictionRowView } from "@/lib/view/dashboard";

// Cor pelo TIPO da recomendação (recKind, derivado do valor cru), nunca pelo rótulo
// de tela. Seleções de outros mercados ("Casa", "Sim", nome do jogador) ficam neutras.
const REC_CLASS: Record<PredictionRowView["recKind"], string> = {
  over: "text-edge-fg",
  under: "text-accent-fg",
  pass: "text-muted-foreground",
  other: "text-foreground",
};

export function PredictionsTable({
  rows,
  basePath = "/dashboard",
  listHref,
}: {
  rows: PredictionRowView[];
  basePath?: string;
  // URL filtrada do dashboard (/dashboard?…) → preserva o estado de busca ao abrir
  // uma predição e voltar. Ausente → link de detalhe limpo.
  listHref?: string;
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
              "vantagem",
              "conf",
              "status",
              "lucro",
              "",
            ].map((h, i) => (
              <TableHead
                key={h || `c${i}`}
                className={cn(
                  "text-meta uppercase tracking-label text-muted-foreground",
                  ["odd", "vantagem", "conf", "lucro"].includes(h) && "text-right",
                )}
              >
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            return (
              <TableRow key={r.id} className="border-border-subtle">
                <TableCell className="max-w-[220px]">
                  {/* A célula é whitespace-nowrap: sem o truncate no próprio link o
                      nome do jogo vaza por cima do selo da liga (#574 linha 8). */}
                  <Link
                    href={appendBackParam(`${basePath}/${r.id}`, listHref, basePath)}
                    title={`${r.home} × ${r.away}`}
                    className="block max-w-[220px] truncate rounded-sm font-medium tracking-tight hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
                <TableCell>
                  <div
                    className={cn("text-meta font-medium", REC_CLASS[r.recKind])}
                  >
                    {r.rec}
                  </div>
                  <div className="text-meta text-muted-foreground">
                    {r.market}
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono text-body-sm tabular-nums">
                  {r.odd}
                </TableCell>
                <TableCell className="text-right font-mono text-body-sm tabular-nums text-muted-foreground">
                  {r.edge ?? "—"}
                </TableCell>
                <TableCell className="text-right font-mono text-body-sm tabular-nums text-muted-foreground">
                  {r.confidence}
                </TableCell>
                <TableCell>
                  <ResultBadge result={r.status} />
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
                    href={appendBackParam(`${basePath}/${r.id}`, listHref, basePath)}
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
