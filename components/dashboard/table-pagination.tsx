import Link from "next/link";

// Paginação da tabela do Desempenho (#577). Server; some com uma página só. A tabela
// vem do jogo mais recente pro mais antigo, então "anterior" = mais recentes.

const LINK =
  "rounded-sm text-body-sm tracking-tight text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function TablePagination({
  page,
  pageCount,
  hrefFor,
}: {
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
}) {
  if (pageCount <= 1) return null;
  return (
    <nav
      aria-label="Páginas da tabela"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
    >
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} aria-label="Página anterior, mais recentes" className={LINK}>
          ← mais recentes
        </Link>
      ) : (
        <span aria-hidden />
      )}
      <span className="text-body-sm tabular-nums text-muted-foreground">
        Página {page} de {pageCount}
      </span>
      {page < pageCount ? (
        <Link href={hrefFor(page + 1)} aria-label="Próxima página, mais antigas" className={LINK}>
          mais antigas →
        </Link>
      ) : (
        <span aria-hidden />
      )}
    </nav>
  );
}
